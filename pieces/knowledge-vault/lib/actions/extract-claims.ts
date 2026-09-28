import { createAction, Property } from "@powerhousedao/pieces-framework";
import { LlmClient } from "../agent/llm.js";
import { candidatesStage, checkVaultStage, draftStage, readSourceStage, reportStage } from "../agent/staged.js";
import { knowledgeVaultAuth } from "../auth.js";
import { readAuth } from "../common/auth-value.js";
import { clientForContext } from "../common/context.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { driveProp, modelProp, sourceProp } from "../common/props.js";

/**
 * Extract claims in one step: read → candidates → vault check → draft →
 * report, run in order inside the step. Two model calls (plus one repair
 * round), the searches done deterministically. The output leads with a
 * per-stage breakdown; each stage is also pushed through ctx.output.update,
 * so a host that shows live output (not Studio on dev.28) shows it tick by.
 * Dry run: nothing is written.
 */

export type StageLine = { stage: string; seconds: number; summary: string };

async function pushLive(context: unknown, stages: StageLine[], running: string | null): Promise<void> {
  const output = (context as { output?: { update?: (o: unknown) => Promise<void> } }).output;
  try {
    await output?.update?.({ running, stages });
  } catch {
    // this host shows no live output
  }
}

export const extractClaimsAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-claims",
  displayName: "Extract claims (dry run)",
  description:
    "Reads one source and proposes atomic notes, following the vault's extract method: six gates, a vault check for duplicates, drafts checked against the vault's rules. About a minute and two model calls. Dry run: nothing is written. Needs an LLM key on the connection.",
  audience: "both",
  props: {
    drive: driveProp,
    source: sourceProp,
    model: modelProp,
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
    const credentials = readAuth(context.auth);
    if (!credentials.llm) {
      throw new KnowledgeVaultApiError("This connection has no LLM API key. Add one to the Knowledge Vault connection to extract claims.", { category: "credential" });
    }
    const model = (typeof p.model === "string" && p.model.trim()) || credentials.llm.defaultModel;
    if (!model) throw new KnowledgeVaultApiError("Choose a model, or set a default model on the connection.", { category: "validation" });
    const t = Number(p.threshold);
    const threshold = Number.isFinite(t) && t > 0 && t <= 1 ? t : 0.9;
    const client = clientForContext(context);
    const llm = new LlmClient(credentials.llm);
    const drive = String(p.drive);
    const started = Date.now();
    const stages: StageLine[] = [];

    async function stage<T extends { summary: string }>(name: string, work: () => Promise<T> | T): Promise<T> {
      await pushLive(context, stages, name);
      const t0 = Date.now();
      try {
        const out = await work();
        stages.push({ stage: name, seconds: Math.round((Date.now() - t0) / 100) / 10, summary: out.summary });
        return out;
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        const done = stages.map((s) => `${s.stage}: ${s.summary}`).join(" | ");
        throw new KnowledgeVaultApiError(`Stage "${name}" failed: ${why}${done ? ` (done before it: ${done})` : ""}`, {
          category: error instanceof KnowledgeVaultApiError ? error.category : "server",
          retryable: error instanceof KnowledgeVaultApiError ? error.retryable : false,
        });
      }
    }

    const read = await stage("read", () => readSourceStage(client, drive, String(p.source)));
    const candidates = await stage("candidates", () => candidatesStage(llm, model, read));
    const checked = await stage("check", () => checkVaultStage(client, drive, candidates, threshold));
    const draft = await stage("draft", () => draftStage(llm, model, read, checked));
    const report = await stage("report", () => reportStage(model, read, candidates, checked, draft));
    await pushLive(context, stages, null);

    const seconds = Math.round((Date.now() - started) / 1000);
    return {
      summary: `${report.summary.replace(/\.$/, "")}, ${seconds} s.`,
      stages: stages.map((s) => `${s.stage} · ${s.seconds} s · ${s.summary}`),
      report: report.report,
      dry_run: true,
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
    };
  },
});
