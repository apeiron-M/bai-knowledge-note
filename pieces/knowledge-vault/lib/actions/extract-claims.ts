import { createAction, Property } from "@powerhousedao/pieces-framework";
import { advancePipeline } from "../agent/pipeline.js";
import { llmFor, stageRunner } from "../agent/runner.js";
import { candidatesStage, checkVaultStage, draftStage, readSourceStage, reportStage } from "../agent/staged.js";
import { assertWritable, writeStage } from "../agent/write.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp, modelProp, sourceProp } from "../common/props.js";
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
    "Reads one source and turns it into atomic notes, following the vault's extract method: six gates, a vault check for duplicates, drafts checked against the vault's rules. Dry run proposes only; Write creates the notes as DRAFT, links each to the source and marks the source EXTRACTED. About 1-2 minutes: set the step's timeout (under When it fails) to 300 s. Needs an LLM key on the connection.",
  audience: "both",
  props: {
    drive: driveProp,
    source: sourceProp,
    model: modelProp,
    mode: modeProp("Write: create DRAFT notes"),
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
    const read = await stage("read", async () => {
      const bundle = await readSourceStage(client, drive, String(p.source));
      // Checked before any model call: a rerun would duplicate the notes.
      if (write) assertWritable(bundle);
      return bundle;
    });
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
            workDone: `Extracted ${written.written.length} DRAFT notes (${report.skipped_count} candidates rejected on a gate, skip rate ${Math.round(report.skip_rate * 100)}%) with ${model}.`,
            filesModified: written.note_ids,
            completedBy: `extract-claims · ${model}`,
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
