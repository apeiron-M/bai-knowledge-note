import type { ChatMessage, LlmClient, ToolSchema, Usage } from "./llm.js";

/**
 * The agent loop: send the job and its tools, run each tool call, return the
 * result to the model, repeat until the model answers without calling a tool
 * or a budget runs out. The harness owns every budget; the model never decides
 * when to stop spending.
 */

export type AgentTool = {
  schema: ToolSchema;
  /** Returns what the model sees. Throwing is caught and shown to the model as an error it can correct. */
  run(args: Record<string, unknown>): Promise<unknown>;
};

export type TraceEntry = { step: number; tool: string; args: string; result: string; ok: boolean; ms: number };

export type StopReason = "finished" | "max_steps" | "max_cost" | "deadline" | "no_progress";

export type AgentRun = {
  final: string | null;
  stoppedBecause: StopReason;
  steps: number;
  calls: number;
  usage: Usage;
  trace: TraceEntry[];
};

export type AgentBudget = { maxSteps: number; maxCostUsd: number; deadlineMs: number };

const PREVIEW = 240;
const preview = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
};

export async function runAgent(options: {
  llm: LlmClient;
  model: string;
  system: string;
  task: string;
  tools: Record<string, AgentTool>;
  budget: AgentBudget;
  now?: () => number;
  /** Called with the running totals after every model call. */
  onUsage?: (usage: Usage) => void;
}): Promise<AgentRun> {
  const now = options.now ?? Date.now;
  const started = now();
  const messages: ChatMessage[] = [
    { role: "system", content: options.system },
    { role: "user", content: options.task },
  ];
  const schemas = Object.values(options.tools).map((t) => t.schema);
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const trace: TraceEntry[] = [];
  let calls = 0;
  let steps = 0;
  let idle = 0;

  const done = (stoppedBecause: StopReason, final: string | null): AgentRun => ({ final, stoppedBecause, steps, calls, usage, trace });

  for (;;) {
    if (steps >= options.budget.maxSteps) return done("max_steps", null);
    if (usage.cost >= options.budget.maxCostUsd) return done("max_cost", null);
    if (now() - started >= options.budget.deadlineMs) return done("deadline", null);

    const reply = await options.llm.chat({ model: options.model, messages, tools: schemas });
    calls++;
    usage.prompt_tokens += reply.usage.prompt_tokens;
    usage.completion_tokens += reply.usage.completion_tokens;
    usage.cost += reply.usage.cost;
    options.onUsage?.(usage);
    messages.push(reply.message);

    const toolCalls = reply.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // A turn with neither a tool call nor text is a stall; nudge once, then stop.
      if (!reply.message.content?.trim()) {
        if (++idle >= 2) return done("no_progress", null);
        messages.push({ role: "user", content: "Continue with the next tool call, or give your final summary if the job is done." });
        continue;
      }
      return done("finished", reply.message.content);
    }
    idle = 0;

    for (const call of toolCalls) {
      steps++;
      const t0 = now();
      const tool = options.tools[call.function.name];
      let result: unknown;
      let ok = true;
      let args: Record<string, unknown> = {};
      try {
        if (!tool) throw new Error(`Unknown tool "${call.function.name}". Use one of: ${Object.keys(options.tools).join(", ")}`);
        args = parseArgs(call.function.arguments);
        result = await tool.run(args);
      } catch (error) {
        ok = false;
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      trace.push({ step: steps, tool: call.function.name, args: preview(args), result: preview(result), ok, ms: now() - t0 });
      messages.push({ role: "tool", tool_call_id: call.id, content: typeof result === "string" ? result : JSON.stringify(result) });
    }
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Tool arguments must be a JSON object");
  return parsed as Record<string, unknown>;
}
