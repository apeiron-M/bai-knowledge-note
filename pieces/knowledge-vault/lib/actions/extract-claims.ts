import { createAction, Property } from "@powerhousedao/pieces-framework";
import { advancePipeline, catchUp, claimPhase, passThrough, taskPosition } from "../agent/pipeline.js";
import { llmFor, stageRunner } from "../agent/runner.js";
import { candidatesStage, checkVaultStage, draftStage, readSourceStage, reportStage } from "../agent/staged.js";
import { assertWritable, writeStage } from "../agent/write.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp, modelProp, resolveSource, sourceIdProp, sourceProp } from "../common/props.js";
import { modeProp } from "./modes.js";

/**
 * Extract claims in one step: read → candidates → vault check → draft →
 * report, run in order inside the step. Two model calls (plus one repair
 * round), the searches done deterministically. The output leads with a
 * per-stage breakdown; each stage is also pushed through ctx.output.update,
 * so a host that shows live output (not Studio on dev.28) shows it tick by.
 * Dry run: nothing is written.
 */

export const extractClaimsAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-claims",
  displayName: "Extract claims",
  description:
    "Reads one source and turns it into atomic notes, following the vault's extract method: six gates, a vault check for duplicates, drafts checked against the vault's rules. Dry run proposes only; Write creates the notes, submits them for review, links each to the source and marks the source EXTRACTED. About 1-2 minutes: set the step's timeout (under When it fails) to 300 s, or 600 s for a slow model. Needs an LLM key on the connection.",
  audience: "both",
  props: {
    drive: driveProp,
    source: sourceProp,
    source_id: sourceIdProp,
    model: modelProp,
    mode: modeProp("Write: create notes for review"),
    threshold: Property.Number({
      displayName: "Duplicate threshold",
      description: "Similarity at or above which a claim counts as already in the vault, 0–1 (default 0.9)",
      required: false,
      defaultValue: 0.9,
    }),
  },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "stages", label: "Stages (name, seconds, what each did)" },
      { key: "report", label: "Report (markdown)" },
      { key: "note_ids", label: "Written note ids (write mode)" },
      { key: "proposed_count", label: "Notes proposed" },
      { key: "skipped_count", label: "Candidates struck" },
      { key: "existing_count", label: "Already in the vault" },
      { key: "skip_rate", label: "Skip rate (0–1)" },
      { key: "cost_usd", label: "Cost (USD)" },
      { key: "new_topics", label: "Topics new to the vault" },
      { key: "proposed", label: "Proposed notes" },
      { key: "skipped", label: "Struck candidates, with gate and reason" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const { llm, model } = llmFor(context, p.model);
    const t = Number(p.threshold);
    const threshold = Number.isFinite(t) && t > 0 && t <= 1 ? t : 0.9;
    const client = clientForContext(context);
    const drive = String(p.drive);
    const { stage, finish } = stageRunner(context);

    const write = p.mode === "write";
    const read = await stage("read", () => readSourceStage(client, drive, resolveSource(p)));
    if (write) {
      // Checked before any model call: a rerun would duplicate the notes. A source the vault already
      // holds the extraction of is the queue lagging, not a request to extract again: the task is
      // caught up from the vault and, once it is past create, this step passes through.
      const existing = Math.max(read.extracted_claims, read.derived_notes);
      const ranEmpty = existing === 0 && read.status === "EXTRACTED" && read.stats_recorded === true;
      if (existing > 0 || ranEmpty) {
        const checked = await stage("pipeline check", async () => {
          const caught = await catchUp(client, { drive, sourceId: read.source_id, by: "extract-claims" });
          const position = await taskPosition(client, { drive, sourceId: read.source_id, phase: "create" });
          const past = position.position === "ahead" || position.position === "done";
          // Not past create: refused as before, unless the earlier extraction found nothing (that may be tried again).
          if (!past && existing > 0) assertWritable(read);
          return { past, position, summary: past ? `${caught.summary} ${passThrough(position, "create")}` : caught.summary };
        });
        if (checked.past) {
          const { stages, seconds } = await finish();
          const what = existing > 0 ? `${existing} note${existing === 1 ? "" : "s"}` : "no claims found";
          return {
            summary: `"${read.title}" is already extracted (${what}); nothing was written. ${checked.summary} ${seconds} s.`,
            stages,
            pipeline: { task_id: checked.position.task_id, from: null, to: checked.position.phase ?? "done", summary: checked.summary },
            passed_through: true,
            report: "",
            dry_run: false,
            written: [],
            note_ids: [],
            source_updated: false,
            source_id: read.source_id,
            source_title: read.title,
            model,
            proposed_count: 0,
            skipped_count: 0,
            existing_count: existing,
            skip_rate: 0,
            cost_usd: 0,
            seconds,
            new_topics: [],
            proposed: [],
            skipped: [],
            existing: [],
            rejected: [],
            overlaps: [],
            restatement_count: 0,
            non_claim_count: 0,
          };
        }
      } else {
        assertWritable(read);
      }
    }
    // Taken before the model runs, so nobody else starts on this source meanwhile.
    if (write) await stage("claim", () => claimPhase(client, { drive, sourceId: read.source_id, phase: "create" }));
    const candidates = await stage("candidates", () => candidatesStage(llm, model, read));
    const checked = await stage("check", () => checkVaultStage(client, drive, candidates, threshold));
    const draft = await stage("draft", () => draftStage(llm, model, read, checked));
    const report = await stage("report", () => reportStage(model, read, candidates, checked, draft));
    const written = write
      ? await stage("write", () =>
          writeStage(client, {
            drive,
            sourceId: read.source_id,
            sourceTitle: read.title,
            sourceStatus: read.status,
            model,
            notes: draft.proposed,
            rejectedCount: report.skipped_count,
            skipRate: report.skip_rate,
          }),
        )
      : null;
    const pipeline = written
      ? await stage("pipeline", () =>
          advancePipeline(client, {
            drive,
            sourceId: read.source_id,
            phase: "create",
            workDone: `Extracted ${written.written.length} notes, submitted for review (${report.skipped_count} candidates rejected on a gate, skip rate ${Math.round(report.skip_rate * 100)}%) with ${model}.`,
            filesModified: written.note_ids,
            completedBy: `extract-claims · ${model}`,
            incomplete: written.incomplete,
          }),
        )
      : null;
    const { stages, seconds } = await finish();
    return {
      summary: written ? `${written.summary}${pipeline ? ` ${pipeline.summary}` : ""} ${report.summary.replace(/\.$/, "")}, ${seconds} s.` : `Dry run: ${report.summary.replace(/\.$/, "")}, ${seconds} s.`,
      stages,
      pipeline,
      report: report.report,
      dry_run: !write,
      written: written?.written ?? [],
      note_ids: written?.note_ids ?? [],
      source_updated: written?.source_updated ?? false,
      source_id: read.source_id,
      source_title: read.title,
      model,
      proposed_count: report.proposed_count,
      skipped_count: report.skipped_count,
      existing_count: report.existing_count,
      skip_rate: report.skip_rate,
      cost_usd: report.cost_usd,
      seconds,
      new_topics: report.new_topics,
      proposed: draft.proposed,
      skipped: candidates.skipped,
      existing: draft.existing,
      rejected: draft.rejected,
      overlaps: draft.overlaps,
      restatement_count: report.restatement_count,
      non_claim_count: report.non_claim_count,
    };
  },
});
