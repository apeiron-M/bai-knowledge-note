import { readAuth } from "../common/auth-value.js";
import { errorMessage, KnowledgeVaultApiError } from "../common/errors.js";
import { LlmClient } from "./llm.js";

/**
 * What every model-backed action shares: the LLM from the connection, and
 * stages that are timed, reported as "stage · seconds · what it did",
 * pushed through ctx.output.update, and named when they fail.
 */

export type StageLine = { stage: string; seconds: number; summary: string };

export function llmFor(context: { auth?: unknown }, model: unknown): { llm: LlmClient; model: string } {
  const credentials = readAuth(context.auth);
  if (!credentials.llm) {
    throw new KnowledgeVaultApiError("This connection has no LLM API key. Add one to the Knowledge Vault connection to use this action.", { category: "credential" });
  }
  const chosen = (typeof model === "string" && model.trim()) || credentials.llm.defaultModel;
  if (!chosen) throw new KnowledgeVaultApiError("Choose a model, or set a default model on the connection.", { category: "validation" });
  return { llm: new LlmClient(credentials.llm), model: chosen };
}

async function pushLive(context: unknown, stages: StageLine[], running: string | null): Promise<void> {
  const output = (context as { output?: { update?: (o: unknown) => Promise<void> } }).output;
  try {
    await output?.update?.({ running, stages });
  } catch {
    // this host shows no live output
  }
}

export function stageRunner(context: unknown) {
  const stages: StageLine[] = [];
  const started = Date.now();
  async function stage<T extends { summary: string }>(name: string, work: () => Promise<T> | T): Promise<T> {
    await pushLive(context, stages, name);
    const t0 = Date.now();
    try {
      const out = await work();
      stages.push({ stage: name, seconds: Math.round((Date.now() - t0) / 100) / 10, summary: out.summary });
      return out;
    } catch (error) {
      const done = stages.map((s) => `${s.stage}: ${s.summary}`).join(" | ");
      throw new KnowledgeVaultApiError(`Stage "${name}" failed: ${errorMessage(error)}${done ? ` (done before it: ${done})` : ""}`, {
        category: error instanceof KnowledgeVaultApiError ? error.category : "server",
        retryable: error instanceof KnowledgeVaultApiError ? error.retryable : false,
      });
    }
  }
  return {
    stage,
    finish: async () => {
      await pushLive(context, stages, null);
      return { stages: stages.map((s) => `${s.stage} · ${s.seconds} s · ${s.summary}`), seconds: Math.round((Date.now() - started) / 1000) };
    },
  };
}
