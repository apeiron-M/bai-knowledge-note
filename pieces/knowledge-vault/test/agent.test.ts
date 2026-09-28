import { describe, expect, it } from "vitest";
import { agentExtractAction, buildReport } from "../lib/actions/agent-extract.js";
import { checkProposal, extractTools, GATES, NOTE_TYPES, type ExtractState } from "../lib/agent/extract.js";
import { runAgent, type AgentTool } from "../lib/agent/harness.js";
import { LlmClient, modelLabel, type ToolCall } from "../lib/agent/llm.js";
import { checkLlm } from "../lib/auth.js";
import type { KnowledgeVaultClient } from "../lib/common/client.js";
import { readAuth } from "../lib/common/auth-value.js";
import { modelProp, sourceProp } from "../lib/common/props.js";

const LLM = { baseUrl: "https://llm.test/v1", apiKey: "k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const call = (name: string, args: unknown, id = name): ToolCall => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

/** A scripted model: each chat() returns the next reply. */
function scriptedLlm(replies: { content?: string | null; tool_calls?: ToolCall[]; cost?: number }[]) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    const r = replies[Math.min(i++, replies.length - 1)];
    return json({ choices: [{ message: { content: r.content ?? null, tool_calls: r.tool_calls }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: r.cost ?? 0.001 } });
  }) as typeof fetch;
  return { llm: new LlmClient(LLM, fetchImpl), bodies };
}

const echo: Record<string, AgentTool> = {
  echo: { schema: { type: "function", function: { name: "echo", description: "", parameters: {} } }, run: async (a) => a },
  boom: { schema: { type: "function", function: { name: "boom", description: "", parameters: {} } }, run: async () => { throw new Error("nope"); } },
};
const budget = { maxSteps: 10, maxCostUsd: 1, deadlineMs: 60_000 };

describe("the agent harness", () => {
  it("runs tool calls, feeds results back, and stops when the model answers", async () => {
    const { llm, bodies } = scriptedLlm([{ tool_calls: [call("echo", { a: 1 }), call("boom", {}), call("nosuch", {}), call("echo", "[1]", "bad")] }, { content: "done" }]);
    const usages: number[] = [];
    const run = await runAgent({ llm, model: "m", system: "s", task: "t", tools: echo, budget, onUsage: (u) => usages.push(u.cost) });
    expect(run.stoppedBecause).toBe("finished");
    expect(run.final).toBe("done");
    expect(run.steps).toBe(4);
    expect(run.trace.map((t) => t.ok)).toEqual([true, false, false, false]);
    expect(run.trace[2].result).toMatch(/Unknown tool/);
    expect(run.trace[3].result).toMatch(/JSON object/);
    expect(usages).toHaveLength(2);
    const second = bodies[1].messages as { role: string; content: string }[];
    expect(second.filter((m) => m.role === "tool")).toHaveLength(4);
  });

  it("treats empty arguments as no arguments", async () => {
    const { llm } = scriptedLlm([{ tool_calls: [call("echo", "  ")] }, { content: "ok" }]);
    const run = await runAgent({ llm, model: "m", system: "s", task: "t", tools: echo, budget });
    expect(run.trace[0].ok).toBe(true);
  });

  it("owns every budget", async () => {
    const loop = [{ tool_calls: [call("echo", {})] }];
    expect((await runAgent({ llm: scriptedLlm(loop).llm, model: "m", system: "s", task: "t", tools: echo, budget: { ...budget, maxSteps: 3 } })).stoppedBecause).toBe("max_steps");
    expect((await runAgent({ llm: scriptedLlm([{ ...loop[0], cost: 0.6 }]).llm, model: "m", system: "s", task: "t", tools: echo, budget })).stoppedBecause).toBe("max_cost");
    let t = 0;
    expect((await runAgent({ llm: scriptedLlm(loop).llm, model: "m", system: "s", task: "t", tools: echo, budget: { ...budget, deadlineMs: 5 }, now: () => (t += 3) })).stoppedBecause).toBe("deadline");
  });

  it("nudges a silent model once, then stops as no progress", async () => {
    const { llm, bodies } = scriptedLlm([{ content: "" }, { content: "  " }]);
    const run = await runAgent({ llm, model: "m", system: "s", task: "t", tools: echo, budget });
    expect(run.stoppedBecause).toBe("no_progress");
    expect(JSON.stringify(bodies[1].messages)).toMatch(/Continue with the next tool call/);
  });
});

describe("the LLM client", () => {
  const models = { data: [
    { id: "b/tools", name: "B", context_length: 128000, pricing: { prompt: "0.0000003", completion: "0.0000012" }, supported_parameters: ["tools"] },
    { id: "a/plain", name: "A", pricing: { prompt: "x" }, supported_parameters: [] },
    { id: 3 }, null,
  ] };
  it("lists tool-capable models with prices, and keeps all when the provider reports no parameters", async () => {
    const urls: string[] = [];
    const client = new LlmClient(LLM, (async (u: string) => { urls.push(u); return json(models); }) as typeof fetch);
    const tools = await client.listModels();
    expect(tools.map((m) => m.id)).toEqual(["b/tools"]);
    expect(modelLabel(tools[0])).toBe("B — $0.30 / $1.20 per M · 128k ctx");
    expect(urls[0]).toMatch(/supported_parameters=tools/);
    expect((await client.listModels(false)).map((m) => m.id)).toEqual(["a/plain", "b/tools"]);
    const bare = new LlmClient(LLM, (async () => json({ data: [{ id: "x" }] })) as typeof fetch);
    expect((await bare.listModels()).map((m) => modelLabel(m))).toEqual(["x"]);
    expect(await new LlmClient(LLM, (async () => json({})) as typeof fetch).listModels()).toEqual([]);
  });
  it("classifies provider errors", async () => {
    const fail = (status: number, body: string) => new LlmClient(LLM, (async () => new Response(body, { status })) as typeof fetch);
    await expect(fail(401, JSON.stringify({ error: { message: "bad key" } })).listModels()).rejects.toMatchObject({ category: "credential", message: /bad key/ });
    await expect(fail(402, JSON.stringify({ error: "no credit" })).listModels()).rejects.toMatchObject({ category: "rate_limit", message: /no credit/ });
    await expect(fail(429, "slow").chat({ model: "m", messages: [], tools: [] })).rejects.toMatchObject({ retryable: true });
    await expect(fail(503, "{}").listModels()).rejects.toMatchObject({ category: "server" });
    await expect(fail(400, "not json").listModels()).rejects.toMatchObject({ category: "validation", message: /not json/ });
    const refused = new LlmClient(LLM, (async () => json({ error: {} })) as typeof fetch);
    await expect(refused.chat({ model: "m", messages: [], tools: [] })).rejects.toThrow(/unknown error/);
    const empty = await new LlmClient(LLM, (async () => json({})) as typeof fetch).chat({ model: "m", messages: [], tools: [], temperature: 0 });
    expect(empty).toEqual({ message: { role: "assistant", content: null }, usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 }, finishReason: null });
  });
});

describe("proposal checks", () => {
  const good = { title: "Legacy caps returns", description: "Why it matters", note_type: "PATTERN", content: "x".repeat(90), topics: ["ops"], confidence: "grounded", locus: "§2" };
  it("accepts a complete proposal", () => expect(checkProposal(good, [])).toEqual([]));
  it("names every broken rule", () => {
    expect(checkProposal({}, [])).toHaveLength(7);
    const issues = checkProposal({ ...good, title: "Is it?", description: "Is it?", content: `${"y".repeat(90)}\\n`, topics: [" "] }, []);
    expect(issues.join(" ")).toMatch(/question.*repeats.*backslash.*topic/s);
    expect(checkProposal({ ...good, description: "d".repeat(201) }, [])[0]).toMatch(/201 characters/);
    expect(checkProposal({ ...good, topics: "ops" }, [])).toEqual(["at least one topic is required"]);
    expect(checkProposal(good, [good as never])).toEqual(["a note with this title is already proposed in this run"]);
  });
  it("mirrors the v2 NoteType enum", async () => {
    const { z } = await import("zod");
    void z;
    const zod = await import("../../../document-models/knowledge-note/v2/gen/schema/zod.js");
    expect([...NOTE_TYPES].sort()).toEqual([...(zod as { NoteTypeSchema: { options: string[] } }).NoteTypeSchema.options].sort());
  });
});

function fakeVault(routes: Record<string, unknown>): KnowledgeVaultClient {
  return { request: async ({ path }: { path: string }) => {
    const hit = Object.entries(routes).find(([k]) => path.startsWith(k));
    if (!hit) throw new Error(`no route ${path}`);
    return typeof hit[1] === "function" ? (hit[1] as () => unknown)() : hit[1];
  } } as unknown as KnowledgeVaultClient;
}
const fresh = (): ExtractState => ({ source: null, proposed: [], skipped: [], existing: [], rejectedProposals: 0 });

describe("the extract tools", () => {
  const body = "a".repeat(15_000);
  const vault = fakeVault({
    "notes/s1": { name: "s1", state: { global: { title: "Tech", content: body, sourceType: "PAPER", status: "EXTRACTING" } } },
    "notes/bare": { name: "bare" },
    "notes/n1.md": "m".repeat(7000),
    topics: { topics: [{ name: "b", noteCount: 1 }, { name: "a", noteCount: 5 }] },
    search: { hits: [{ node: { documentId: "n1", title: "T", status: "CANONICAL" }, similarity: 0.87654 }, { node: { status: "MOC" }, similarity: 0.5 }] },
  });
  it("pages the source, lists topics, searches and reads notes", async () => {
    const state = fresh();
    const t = extractTools(vault, "d", "s1", state);
    const first = (await t.read_source.run({})) as { more: boolean; text: string };
    expect(first.more).toBe(true);
    expect(first.text).toHaveLength(12_000);
    expect(((await t.read_source.run({ offset: 12_000 })) as { more: boolean }).more).toBe(false);
    expect(state.source).toMatchObject({ title: "Tech", chars: 15_000, read: 15_000 });
    expect(await t.list_topics.run({})).toEqual(["a (5)", "b (1)"]);
    expect(await t.search_vault.run({ query: "q", limit: 99 })).toEqual([{ id: "n1", title: "T", description: undefined, similarity: 0.877 }]);
    expect(String(await t.read_note.run({ note_id: "n1" }))).toMatch(/truncated/);
    const bare = extractTools(vault, "d", "bare", fresh());
    expect(await bare.read_source.run({ offset: -5 })).toMatchObject({ title: "bare", total_chars: 0, more: false });
    const array = extractTools(fakeVault({ topics: [{ name: "z", noteCount: 2 }], "notes/n2.md": "short" }), "d", "s", fresh());
    expect(await array.list_topics.run({})).toEqual(["z (2)"]);
    expect(await array.read_note.run({ note_id: "n2" })).toBe("short");
    expect(await extractTools(fakeVault({ topics: {} }), "d", "s", fresh()).list_topics.run({})).toEqual([]);
  });
  it("records proposals, existing notes and skips, and sends bad ones back", async () => {
    const state = fresh();
    const t = extractTools(vault, "d", "s1", state);
    expect(await t.propose_note.run({ title: "x" })).toMatchObject({ accepted: false });
    expect(await t.propose_note.run({ title: "Claim holds", description: "because", note_type: "CONCEPT", content: "c".repeat(90), topics: ["a"], confidence: "grounded", locus: "p1" })).toEqual({ accepted: true, proposed_so_far: 1 });
    expect(await t.note_existing_evidence.run({ note_id: "n1", title: "T", locus: "p2", reason: "same" })).toEqual({ recorded: true });
    expect(await t.skip_candidate.run({ candidate: "c", gate: "sentence", reason: "r" })).toEqual({ recorded: true, skipped_so_far: 1 });
    expect(await t.skip_candidate.run({ candidate: "c", gate: "vibes", reason: "r" })).toMatchObject({ recorded: false });
    expect(state).toMatchObject({ rejectedProposals: 1, existing: [{ note_id: "n1" }], skipped: [{ gate: "sentence" }] });
    expect(GATES).toContain("duplicate");
  });
});

describe("the report", () => {
  const run = { final: " all done ", stoppedBecause: "finished" as const, steps: 3, calls: 2, usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0123 }, trace: [] };
  it("reads as a report", () => {
    const state: ExtractState = {
      source: { id: "s", title: "Tech", chars: 1200, read: 1200 },
      proposed: [{ title: "T1", description: "D1", note_type: "PATTERN", content: "c", topics: ["a", "b"], confidence: "grounded", locus: "§1" }],
      skipped: [{ candidate: "a | b", gate: "sentence", reason: "bare\nnumber" }],
      existing: [{ note_id: "n1", title: "Old", locus: "§2", reason: "same" }],
      rejectedProposals: 2,
    };
    const md = buildReport(state, run, "m/x");
    expect(md).toMatch(/\*\*1 proposed\*\* · 1 skipped · 1 already in the vault · skip rate 33%/);
    expect(md).toMatch(/\$0\.0123/);
    expect(md).toMatch(/a \\\| b \| sentence \| bare number/);
    expect(md).toMatch(/2 proposal\(s\) were sent back/);
    expect(md).toMatch(/### Model's summary\n\nall done/);
  });
  it("says when nothing was read", () => {
    const md = buildReport(fresh(), { ...run, final: null }, "m");
    expect(md).toMatch(/skip rate 0%/);
    expect(md).toMatch(/never read/);
    expect(md).not.toMatch(/Proposed notes|Skipped|summary/);
  });
});

describe("the agent-extract action", () => {
  const ctx = (props: Record<string, unknown>, llm = true) => ({
    auth: { props: { base_url: "http://127.0.0.1:1", token: "t", ...(llm ? { llm_api_key: "k", llm_base_url: "https://llm.test/v1/" } : {}) } },
    propsValue: { drive: "d", source: "s1", ...props },
  });
  const run = (c: unknown) => (agentExtractAction as unknown as { run(c: unknown): Promise<Record<string, unknown>> }).run(c);
  it("needs an LLM key and a model", async () => {
    await expect(run(ctx({}, false))).rejects.toMatchObject({ category: "credential" });
    await expect(run(ctx({ model: " " }))).rejects.toMatchObject({ category: "validation" });
  });
  it("reads the LLM fields from the connection", () => {
    expect(readAuth({ props: { base_url: "https://v.test", token: "t", llm_api_key: " k ", llm_default_model: "m/x" } }).llm).toEqual({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", defaultModel: "m/x" });
    expect(readAuth({ props: { base_url: "https://v.test", token: "t" } }).llm).toBeUndefined();
  });
  it("runs end to end, pushes live progress, and survives a host without live output", async () => {
    const realFetch = globalThis.fetch;
    let turn = 0;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.startsWith("https://llm.test")) {
        turn++;
        const tool_calls = turn === 1 ? [call("read_source", {})] : turn === 2 ? [call("skip_candidate", { candidate: "c", gate: "sentence", reason: "r" })] : undefined;
        return json({ choices: [{ message: { content: turn > 2 ? "summary" : null, tool_calls } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.002 } });
      }
      return json({ name: "s1", state: { global: { title: "Src", content: "body" } } });
    }) as typeof fetch;
    try {
      const updates: { phase: string }[] = [];
      const out = await run({ ...ctx({ model: "m/x", max_steps: "x", max_cost_usd: 0.4 }), output: { update: async (o: { phase: string }) => { updates.push(o); } } });
      expect(out).toMatchObject({ dry_run: true, model: "m/x", source_title: "Src", skipped_count: 1, proposed_count: 0, skip_rate: 1, stopped_because: "finished", summary: "summary" });
      expect(updates.map((u) => u.phase)).toEqual(["starting", "extracting", "extracting", "done"]);
      turn = 0;
      const noLive = await run({ ...ctx({ model: "m/x" }), output: { update: async () => { throw new Error("no live output"); } } });
      expect(noLive.stopped_because).toBe("finished");
      turn = 2;
      expect((await run(ctx({ model: "m/x" }))).skip_rate).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the dropdowns and the LLM check", () => {
  it("turns anything thrown into text", async () => {
    const { errorMessage } = await import("../lib/common/errors.js");
    expect([errorMessage(new Error("a")), errorMessage("b")]).toEqual(["a", "b"]);
  });
  const options = (prop: unknown, input: Record<string, unknown>, search?: string) =>
    (prop as { options(i: unknown, c: unknown): Promise<{ disabled: boolean; placeholder: string; options: { label: string; value: string }[] }> }).options(input, { searchValue: search });
  const authWith = (extra: Record<string, unknown> = {}) => ({ base_url: "http://127.0.0.1:1", token: "t", ...extra });
  it("the model dropdown explains what is missing and lists models", async () => {
    expect((await options(modelProp, {})).placeholder).toMatch(/Connect/);
    expect((await options(modelProp, { auth: { base_url: "" } })).disabled).toBe(true);
    expect((await options(modelProp, { auth: authWith() })).placeholder).toMatch(/LLM API key/);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => json({ data: [{ id: "deepseek/v", name: "DeepSeek", supported_parameters: ["tools"] }, { id: "o/x", name: "Other", supported_parameters: ["tools"] }] })) as typeof fetch;
    try {
      const listed = await options(modelProp, { auth: authWith({ llm_api_key: "k", llm_default_model: "deepseek/v" }) }, "deep");
      expect(listed).toMatchObject({ disabled: false, placeholder: "Default: deepseek/v", options: [{ value: "deepseek/v" }] });
      expect((await options(modelProp, { auth: authWith({ llm_api_key: "k" }) })).placeholder).toBe("Choose a model");
      globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch;
      expect((await options(modelProp, { auth: authWith({ llm_api_key: "k" }) })).placeholder).toMatch(/Could not list models/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("the source dropdown lists sources with their folder", async () => {
    expect((await options(sourceProp, {})).disabled).toBe(true);
    expect((await options(sourceProp, { auth: authWith() })).placeholder).toMatch(/vault first/);
    const realFetch = globalThis.fetch;
    const nodes = [
      { id: "f1", name: "Report" }, { id: "f0", name: "sources" },
      { id: "s2", name: "Tech", documentType: "bai/source", parentFolder: "f1" },
      { id: "s1", name: "Alpha", documentType: "bai/source", parentFolder: "f0" },
      { id: "s3", name: "Loose", documentType: "bai/source" },
      { id: "n1", name: "Note", documentType: "bai/knowledge-note" },
    ];
    globalThis.fetch = (async () => json({ state: { global: { nodes } } })) as typeof fetch;
    try {
      expect((await options(sourceProp, { auth: authWith(), drive: "d" })).options).toEqual([{ label: "Alpha", value: "s1" }, { label: "Loose", value: "s3" }, { label: "Report / Tech", value: "s2" }]);
      expect((await options(sourceProp, { auth: authWith(), drive: "d" }, "tech")).options).toHaveLength(1);
      globalThis.fetch = (async () => json({})) as typeof fetch;
      expect((await options(sourceProp, { auth: authWith(), drive: "d" })).placeholder).toMatch(/no sources/);
      globalThis.fetch = (async () => json({ error: "gone" }, 404)) as typeof fetch;
      expect((await options(sourceProp, { auth: authWith(), drive: "d" })).placeholder).toMatch(/Could not list sources/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("checks the LLM key and says whether it has a spending limit", async () => {
    const or = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" };
    expect(await checkLlm(or, (async () => json({ data: { limit: 5, limit_remaining: 3.5 } })) as typeof fetch)).toBe("LLM: openrouter.ai (limit $5, $3.50 left)");
    expect(await checkLlm(or, (async () => json({ data: { limit: 5 } })) as typeof fetch)).toMatch(/\$0\.00 left/);
    expect(await checkLlm(or, (async () => json({})) as typeof fetch)).toBe("LLM: openrouter.ai (no spending limit)");
    await expect(checkLlm(or, (async () => json({}, 401)) as typeof fetch)).rejects.toMatchObject({ category: "credential" });
    await expect(checkLlm(or, (async () => json({}, 500)) as typeof fetch)).rejects.toMatchObject({ category: "server" });
    expect(await checkLlm(LLM, (async () => json({ data: [{ id: "a", supported_parameters: ["tools"] }] })) as typeof fetch)).toBe("LLM: llm.test (1 tool models)");
  });
});
