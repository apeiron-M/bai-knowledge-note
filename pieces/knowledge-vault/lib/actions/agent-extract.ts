import { createAction, Property } from "@powerhousedao/pieces-framework";
import { extractTools, EXTRACT_SYSTEM, type ExtractState } from "../agent/extract.js";
import { runAgent, type AgentRun, type TraceEntry } from "../agent/harness.js";
import { LlmClient } from "../agent/llm.js";
import { knowledgeVaultAuth } from "../auth.js";
import { readAuth } from "../common/auth-value.js";
import { clientForContext } from "../common/context.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { driveProp, modelProp, sourceProp } from "../common/props.js";

/**
 * agent-extract, dry run: an LLM reads one source, runs the extract skill's
 * gates and PROPOSES atomic notes. Nothing is written. The step reports live
 * progress while it runs and ends with a markdown report plus flat counts,
 * so Studio's step panel shows what happened without opening raw JSON.
 */

type Progress = { phase: string; steps: number; proposed: number; skipped: number; existing: number; cost_usd: number; last_tool: string | null };

/** ctx.output.update throws when the host did not enable live output: progress is best-effort. */
async function pushProgress(context: unknown, progress: Progress): Promise<void> {
  const output = (context as { output?: { update?: (o: unknown) => Promise<void> } }).output;
  try {
    await output?.update?.(progress);
  } catch {
    // no live output on this host
  }
}

export function buildReport(state: ExtractState, run: AgentRun, model: string): string {
  const candidates = state.proposed.length + state.skipped.length + state.existing.length;
  const skipRate = candidates ? Math.round((state.skipped.length / candidates) * 100) : 0;
  const lines = [
    `## agent-extract (dry run) — ${state.source?.title ?? "source"}`,
    "",
    `**${state.proposed.length} proposed** · ${state.skipped.length} skipped · ${state.existing.length} already in the vault · skip rate ${skipRate}%`,
    "",
    `Model \`${model}\` · ${run.calls} calls · ${run.steps} tool steps · ${run.usage.prompt_tokens + run.usage.completion_tokens} tokens · $${run.usage.cost.toFixed(4)} · stopped: ${run.stoppedBecause}`,
    state.source ? `Read ${state.source.read.toLocaleString("en")} of ${state.source.chars.toLocaleString("en")} characters.` : "The source was never read.",
    "",
  ];
  if (state.proposed.length) {
    lines.push("### Proposed notes", "");
    state.proposed.forEach((n, i) => {
      lines.push(`${i + 1}. **${n.title}** — _${n.note_type.toLowerCase()}, ${n.confidence}_`, `   ${n.description}`, `   Topics: ${n.topics.join(", ")} · From: ${n.locus}`);
    });
    lines.push("");
  }
  if (state.existing.length) {
    lines.push("### Already in the vault", "");
    for (const e of state.existing) lines.push(`- ${e.title} (\`${e.note_id}\`) — ${e.reason}`);
    lines.push("");
  }
  if (state.skipped.length) {
    lines.push("### Skipped", "", "| Candidate | Gate | Why |", "|---|---|---|");
    for (const s of state.skipped) lines.push(`| ${cell(s.candidate)} | ${s.gate} | ${cell(s.reason)} |`);
    lines.push("");
  }
  if (state.rejectedProposals) lines.push(`${state.rejectedProposals} proposal(s) were sent back for fixes before being accepted or dropped.`, "");
  if (run.final) lines.push("### Model's summary", "", run.final.trim(), "");
  return lines.join("\n");
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);

export const agentExtractAction = createAction({
  auth: knowledgeVaultAuth,
  name: "agent-extract",
  displayName: "Agent: extract claims (dry run)",
  description:
    "An LLM reads one source and proposes atomic notes following the vault's extract method: six gates, duplicate search, honest skip rate. Dry run: nothing is written. Needs an LLM key on the connection.",
  audience: "both",
  props: {
    drive: driveProp,
    source: sourceProp,
    model: modelProp,
    max_steps: Property.Number({ displayName: "Max tool steps", description: "Hard stop, default 60", required: false, defaultValue: 60 }),
    max_cost_usd: Property.Number({ displayName: "Max cost (USD)", description: "Hard stop on the provider's reported cost, default 0.50", required: false, defaultValue: 0.5 }),
  },
  outputSchema: {
    fields: [
      { key: "report", label: "Report (markdown)" },
      { key: "proposed_count", label: "Notes proposed" },
      { key: "skipped_count", label: "Candidates skipped" },
      { key: "existing_count", label: "Already in the vault" },
      { key: "skip_rate", label: "Skip rate (0–1)" },
      { key: "cost_usd", label: "Cost (USD)" },
      { key: "stopped_because", label: "Why the run stopped" },
      { key: "proposed", label: "Proposed notes" },
      { key: "skipped", label: "Skipped candidates" },
      { key: "trace", label: "Tool trace" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const credentials = readAuth(context.auth);
    if (!credentials.llm) {
      throw new KnowledgeVaultApiError("This connection has no LLM API key. Add one to the Knowledge Vault connection to use the agent actions.", { category: "credential" });
    }
    const model = (typeof p.model === "string" && p.model.trim()) || credentials.llm.defaultModel;
    if (!model) throw new KnowledgeVaultApiError("Choose a model, or set a default model on the connection.", { category: "validation" });

    const client = clientForContext(context);
    const state: ExtractState = { source: null, proposed: [], skipped: [], existing: [], rejectedProposals: 0 };
    const tools = extractTools(client, String(p.drive), String(p.source), state);
    const progress = (phase: string, trace: TraceEntry[], cost: number): Progress => ({
      phase, steps: trace.length, proposed: state.proposed.length, skipped: state.skipped.length, existing: state.existing.length,
      cost_usd: Math.round(cost * 10000) / 10000, last_tool: trace.at(-1)?.tool ?? null,
    });

    // Wrap every tool so each call pushes a live progress update.
    const trace: TraceEntry[] = [];
    let cost = 0;
    const live = Object.fromEntries(Object.entries(tools).map(([name, t]) => [name, {
      schema: t.schema,
      run: async (args: Record<string, unknown>) => {
        const result = await t.run(args);
        trace.push({ step: trace.length + 1, tool: name, args: "", result: "", ok: true, ms: 0 });
        await pushProgress(context, progress("extracting", trace, cost));
        return result;
      },
    }]));

    await pushProgress(context, progress("starting", trace, 0));
    const run = await runAgent({
      llm: new LlmClient(credentials.llm),
      model,
      system: EXTRACT_SYSTEM,
      task: `Extract atomic claims from the source with id ${String(p.source)}. Start with read_source.`,
      tools: live,
      budget: { maxSteps: num(p.max_steps, 60), maxCostUsd: num(p.max_cost_usd, 0.5), deadlineMs: 12 * 60_000 },
      onUsage: (u) => { cost = u.cost; },
    });

    const candidates = state.proposed.length + state.skipped.length + state.existing.length;
    const report = buildReport(state, run, model);
    await pushProgress(context, progress("done", run.trace, run.usage.cost));
    return {
      report,
      dry_run: true,
      source_id: String(p.source),
      source_title: state.source?.title ?? null,
      model,
      proposed_count: state.proposed.length,
      skipped_count: state.skipped.length,
      existing_count: state.existing.length,
      skip_rate: candidates ? Math.round((state.skipped.length / candidates) * 100) / 100 : 0,
      cost_usd: Math.round(run.usage.cost * 10000) / 10000,
      tokens: run.usage.prompt_tokens + run.usage.completion_tokens,
      calls: run.calls,
      stopped_because: run.stoppedBecause,
      proposed: state.proposed,
      skipped: state.skipped,
      existing: state.existing,
      trace: run.trace,
      summary: run.final,
    };
  },
});

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
