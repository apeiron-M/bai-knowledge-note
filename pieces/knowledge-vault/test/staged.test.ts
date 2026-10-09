import { describe, expect, it } from "vitest";
import { extractClaimsAction } from "../lib/actions/extract-claims.js";
import { callTimeoutFor, completeJson, isLocalModel, isLocalModelEndpoint, JSON_CALL_TIMEOUT_MS, LlmClient, LOCAL_CALL_TIMEOUT_MS, parseJsonAnswer, retryDelayMs } from "../lib/agent/llm.js";
import { asObject, candidatesStage, checkVaultStage, containsVerbatim, draftStage, mapLimit, readSourceStage, reportStage } from "../lib/agent/staged.js";
import type { KnowledgeVaultClient } from "../lib/common/client.js";

const LLM = { baseUrl: "https://llm.test/v1", apiKey: "k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Answers each model call with the next scripted content string. */
function modelSays(...answers: (string | { content: string; finish?: string })[]) {
  let i = 0;
  const calls: { max_tokens: number; user: string }[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { max_tokens: number; messages: { content: string }[] };
    calls.push({ max_tokens: body.max_tokens, user: body.messages[1].content });
    const a = answers[Math.min(i++, answers.length - 1)];
    const { content, finish } = typeof a === "string" ? { content: a, finish: "stop" } : a;
    return json({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 } });
  }) as typeof fetch;
  return { fetchImpl, calls, llm: new LlmClient(LLM, fetchImpl) };
}
function vault(routes: Record<string, unknown>): KnowledgeVaultClient {
  return { request: async ({ path, query }: { path: string; query?: Record<string, unknown> }) => {
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) throw new Error(`no route ${path}`);
    const v = routes[key];
    return typeof v === "function" ? (v as (q: unknown) => unknown)(query) : v;
  } } as unknown as KnowledgeVaultClient;
}
const SOURCE = "Capital is not the primary constraint on technology value today. Returns lag because legacy systems drag.";
const bundle = { source_id: "s1", title: "Tech", text: SOURCE, topics: ["operations", "strategy"] };

describe("waiting out a rate limit", () => {
  const busy = (status: number) => new Response("busy", { status, headers: { "retry-after": "0" } });
  const answer = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":5}' } }] }), { status: 200 });
  it("retries a 429 or 5xx once, then reports it", async () => {
    let calls = 0;
    const once = (async () => (++calls === 1 ? busy(429) : answer())) as typeof fetch;
    expect((await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, once)).value).toEqual({ ok: 5 });
    const down = (async () => busy(503)) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, down)).rejects.toMatchObject({ status: 503, category: "server" });
    const refused = (async () => new Response('{"error":"bad model"}', { status: 400 })) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, refused)).rejects.toMatchObject({ status: 400 });
  });
  it("uses Retry-After, within 30 s", () => {
    const h = (v: string | null) => ({ headers: { get: () => v } });
    expect(retryDelayMs(h("2"))).toBe(2000);
    expect(retryDelayMs(h("600"))).toBe(30_000);
    expect(retryDelayMs(h(null))).toBe(5000);
    expect(retryDelayMs(h("soon"))).toBe(5000);
  });
  it("runs work a few at a time, in order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => { peak = Math.max(peak, ++running); await new Promise((r) => setTimeout(r, 2)); running--; return n * 10; });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("JSON completions", () => {
  it("takes the outermost object and says when there is none", () => {
    expect(parseJsonAnswer('```json\n{"a":{"b":1}}\n```')).toEqual({ a: { b: 1 } });
    expect(() => parseJsonAnswer("no")).toThrow(/did not answer with JSON/);
    expect(() => parseJsonAnswer("{nope}")).toThrow(/malformed/);
  });
  it("retries an empty answer once with double the budget, then explains", async () => {
    const ok = modelSays({ content: "", finish: "length" }, '{"x":1}');
    const out = await completeJson(ok.llm, { model: "m", system: "s", user: "u", maxTokens: 100 }, ok.fetchImpl);
    expect(out.value).toEqual({ x: 1 });
    expect(ok.calls.map((c) => c.max_tokens)).toEqual([100, 200]);
    expect(out.usage.cost).toBeCloseTo(0.002);
    const cut = modelSays({ content: "", finish: "length" });
    await expect(completeJson(cut.llm, { model: "m", system: "s", user: "u" }, cut.fetchImpl)).rejects.toThrow(/64000-token budget/);
    const empty = modelSays({ content: " " });
    await expect(completeJson(empty.llm, { model: "m", system: "s", user: "u" }, empty.fetchImpl)).rejects.toThrow(/empty answer \(finish reason: none\)/);
  });
  it("retries once when the connection drops mid-answer, then gives up", async () => {
    const { isDroppedConnection } = await import("../lib/agent/llm.js");
    let n = 0;
    const flaky = (async () => {
      if (n++ === 0) throw new TypeError("terminated");
      return json({ choices: [{ message: { content: '{"ok":1}' } }] });
    }) as typeof fetch;
    expect((await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, flaky)).value).toEqual({ ok: 1 });
    const dead = (async () => { throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") }); }) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, dead)).rejects.toThrow(/fetch failed/);
    let m = 0;
    const cutBody = (async () => (m++ === 0 ? ({ ok: true, json: async () => { throw new TypeError("terminated"); } } as unknown as Response) : json({ choices: [{ message: { content: '{"ok":2}' } }] }))) as typeof fetch;
    expect((await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, cutBody)).value).toEqual({ ok: 2 });
    const badBody = (async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } }) as unknown as Response) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, badBody)).rejects.toThrow(/Unexpected token/);
    expect([isDroppedConnection("text"), isDroppedConnection(new Error("socket hang up")), isDroppedConnection(new Error("nope"))]).toEqual([false, true, false]);
  });
  it("retries once when a call hangs, on the request or while the answer is read, then says so plainly", async () => {
    const { isTimeout } = await import("../lib/agent/llm.js");
    const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    let a = 0;
    const slowOnce = (async () => { if (a++ === 0) throw timeout(); return json({ choices: [{ message: { content: '{"ok":3}' } }] }); }) as typeof fetch;
    expect((await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, slowOnce)).value).toEqual({ ok: 3 });
    let b = 0;
    const slowBody = (async () => (b++ === 0 ? ({ ok: true, json: async () => { throw timeout(); } } as unknown as Response) : json({ choices: [{ message: { content: '{"ok":4}' } }] }))) as typeof fetch;
    expect((await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, slowBody)).value).toEqual({ ok: 4 });
    const hung = (async () => { throw timeout(); }) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "slow/m", system: "s", user: "u", timeoutMs: 5000 }, hung)).rejects.toMatchObject({ category: "timeout", retryable: true, message: "slow/m did not answer within 5 s, twice. Run the step again, or choose a faster model." });
    const hungBody = (async () => ({ ok: true, json: async () => { throw timeout(); } }) as unknown as Response) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, hungBody)).rejects.toMatchObject({ category: "timeout", message: /within 120 s, twice/ });
    const nullBody = (async () => json(null)) as typeof fetch;
    await expect(completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, nullBody)).rejects.toThrow("m returned an empty response twice");
    expect([isTimeout(new Error("x")), isTimeout(Object.assign(new Error("x"), { name: "AbortError" })), isTimeout("text")]).toEqual([false, true, false]);
  });
  it("surfaces provider errors", async () => {
    const llm = new LlmClient(LLM);
    await expect(completeJson(llm, { model: "m", system: "s", user: "u" }, (async () => new Response("{}", { status: 401 })) as typeof fetch)).rejects.toMatchObject({ category: "credential" });
    await expect(completeJson(llm, { model: "m", system: "s", user: "u" }, (async () => json({ error: {} })) as typeof fetch)).rejects.toThrow(/unknown error/);
    const bare = await completeJson(llm, { model: "m", system: "s", user: "u" }, (async () => json({ choices: [{ message: { content: "{}" } }] })) as typeof fetch);
    expect(bare.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, cost: 0 });
  });
});

describe("step inputs", () => {
  it("accept an object or its JSON, and name what is missing", () => {
    expect(asObject('{"a":1}', "X")).toEqual({ a: 1 });
    expect(asObject({ a: 1 }, "X")).toEqual({ a: 1 });
    expect(() => asObject("not json", "Source")).toThrow(/Source is missing.*steps\.read\.output/);
    expect(() => asObject([1], "X")).toThrow();
  });
  it("spot a sentence copied from the source, but not a short phrase", () => {
    expect(containsVerbatim(SOURCE, "capital is NOT the primary constraint on technology value")).toBe(true);
    expect(containsVerbatim(SOURCE, "legacy systems drag")).toBe(false);
  });
});

describe("1. read", () => {
  it("bundles text, figures and the topic vocabulary", async () => {
    const out = await readSourceStage(vault({ "notes/s1": { name: "s1", state: { global: { title: "Tech", content: "x".repeat(70_000), sourceType: "PAPER", attachments: [{}, {}] } } }, topics: [{ name: "b", noteCount: 1 }, { name: "a", noteCount: 9 }] }), "d", "s1");
    expect(out).toMatchObject({ title: "Tech", chars: 70_000, figures: 2, topics: ["a", "b"], source_type: "PAPER" });
    expect(out.text).toHaveLength(60_000);
    expect(out.summary).toMatch(/70,000 characters \(first 60,000 used\), 2 figures/);
    const one = await readSourceStage(vault({ "notes/s2": { name: "s2", state: { global: { content: "text", attachments: [{}] } } }, topics: {} }), "d", "s2");
    expect(one.summary).toMatch(/"s2": 4 characters, 1 figure \(/);
    expect(one.source_type).toBeNull();
    await expect(readSourceStage(vault({ "notes/s3": { name: "s3" }, topics: { topics: [] } }), "d", "s3")).rejects.toThrow(/no text/);
  });
});

describe("2. candidates", () => {
  it("keeps real claims and strikes what the model waved through", async () => {
    const answer = {
      kept: [
        { claim: "Budget stops separating organizations once spend is routine", locus: "p1", evidence: "e", disagreement: "budget still buys talent" },
        { claim: "74 percent of firms invest over $50m", disagreement: "x" },
        { claim: "Spending more on technology always helps outcomes", disagreement: "" },
        { claim: "Capital is not the primary constraint on technology value", disagreement: "x" },
        { claim: "  " },
        "junk",
      ],
      skipped: [{ candidate: "A heading", gate: "sentence", reason: "label" }, { candidate: "An odd candidate with no gate", gate: "vibes", reason: "?" }, { candidate: "" }],
      non_claims: 2,
    };
    const m = modelSays(JSON.stringify(answer));
    const out = await candidatesStage(m.llm, "m", bundle, m.fetchImpl);
    expect(out.kept).toEqual([{ id: "c1", claim: "Budget stops separating organizations once spend is routine", locus: "p1", evidence: "e" }]);
    // Rejected on a gate: the claim nobody could dispute, the copied sentence, the unknown gate.
    expect(out.skipped.map((s) => s.gate)).toEqual(["falsifiability", "sentence", "coherence"]);
    // Set aside: the bare statistic and the heading are not claims.
    expect(out.non_claims.map((s) => s.candidate)).toEqual(["74 percent of firms invest over $50m", "A heading"]);
    expect(out.summary).toBe("4 distinct claims: 1 kept, 3 rejected on a gate; 4 non-claims (headings, captions, bare statistics).");
    expect(m.calls[0].user).toMatch(/Source title: Tech/);
  });
  it("reports zero survivors plainly", async () => {
    const m = modelSays("{}");
    expect((await candidatesStage(m.llm, "m", {}, m.fetchImpl)).summary).toBe("0 distinct claims: 0 kept, 0 rejected on a gate.");
  });
});

describe("3. vault check", () => {
  const search = (q: { q: string }) => ({ hits: q.q.startsWith("dup") ? [{ node: { documentId: "n1", title: "Old", status: "CANONICAL" }, similarity: 0.934 }, { node: { status: "MOC" }, similarity: 0.9 }] : [] });
  it("flags candidates the vault already holds", async () => {
    const out = await checkVaultStage(vault({ search }), "d", { kept: [{ id: "c1", claim: "dup claim" }, { id: "c2", claim: "new claim" }] });
    expect(out.candidates.map((c) => c.likely_duplicate)).toEqual([true, false]);
    expect(out.candidates[0].matches).toEqual([{ id: "n1", title: "Old", similarity: 0.934 }]);
    expect(out.summary).toBe("Searched the vault for 2 candidates: 1 likely already there (similarity ≥ 0.9); best match 0.934.");
    const none = await checkVaultStage(vault({ search }), "d", { kept: [{ id: "c1", claim: "x" }] }, 0.95);
    expect(none.summary).toBe("Searched the vault for 1 candidate: none already there; best match 0.");
    expect((await checkVaultStage(vault({ search }), "d", {})).summary).toBe("Searched the vault for 0 candidates: none already there.");
  });
});

describe("4. draft", () => {
  const checked = { candidates: [
    { id: "c1", claim: "A", locus: "p1", evidence: "e", matches: [{ id: "n9", title: "Old", similarity: 0.95 }] },
    { id: "c2", claim: "B", matches: [] },
    { id: "c3", claim: "C" },
    { id: "c4", claim: "D" },
  ] };
  const note = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ candidate_id: id, title, description: "Why it holds and what it changes", note_type: "pattern", content: "c".repeat(100), topics: ["operations", "fresh"], confidence: "grounded", locus: "p", ...extra });
  it("writes notes, merges, points at existing ones, and sends bad drafts back once with the issues", async () => {
    const m = modelSays(
      JSON.stringify({
        notes: [
          note("c2", "Budget no longer separates organizations", { merged_ids: ["c3"] }),
          note("c4", "Capital is not the primary constraint on technology value"),
        ],
        existing: [{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same" }],
      }),
      JSON.stringify({ notes: [note("c4", "Over 74% invest heavily")] }),
    );
    const out = await draftStage(m.llm, "m", bundle, checked, m.fetchImpl);
    expect(out.proposed.map((n) => n.title)).toEqual(["Budget no longer separates organizations"]);
    expect(out.proposed[0]).toMatchObject({ note_type: "PATTERN", new_topics: ["fresh"] });
    expect(out.existing).toEqual([{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same" }]);
    expect(out.rejected.map((r) => r.candidate_id)).toEqual(["c4"]);
    expect(out.rejected[0].issues.join(" ")).toMatch(/statistic/);
    expect(m.calls[1].user).toMatch(/c4: the title repeats a sentence from the source/);
    expect(m.calls[0].user).toMatch(/n9 "Old" \(0\.95\)/);
    expect(out.summary).toBe("Drafted 1 note, 1 already in the vault, 1 merged into others, 1 still failing the vault's rules after 2 rounds; new topics: fresh.");
    expect(out.repair_rounds).toBe(1);
  });
  it("stops after one round when every draft passes, and skips the model with nothing to draft", async () => {
    const m = modelSays(JSON.stringify({ notes: [note("c2", "One", { topics: ["operations"] }), note("c3", "Two", { topics: ["operations"] })] }), '{"same":[]}');
    const out = await draftStage(m.llm, "m", bundle, { candidates: [{ id: "c2" }, { id: "c3" }] }, m.fetchImpl);
    expect(out.summary).toBe("Drafted 2 notes.");
    expect(out.overlap_check).toBe("done");
    expect(m.calls).toHaveLength(2); // one draft round, one overlap check
    const none = await draftStage(m.llm, "m", bundle, {}, m.fetchImpl);
    expect(none).toMatchObject({ proposed_count: 0, cost_usd: 0 });
    expect(none.summary).toMatch(/No candidates/);
  });
});

describe("5. report", () => {
  it("puts the steps together", () => {
    const out = reportStage("m/x", { title: "Tech", source_id: "s1" }, { skipped: [{ candidate: "a | b", gate: "sentence", reason: "r" }], cost_usd: 0.01 }, { checked_count: 3 }, {
      proposed: [{ title: "T", description: "D", note_type: "PATTERN", confidence: "grounded", topics: ["x"], locus: "p" }],
      existing: [{ title: "Old", note_id: "n1", reason: "same" }], rejected: [{}], new_topics: ["x"], cost_usd: 0.005,
    });
    expect(out.summary).toBe("1 notes proposed, 1 rejected, 1 already in the vault, skip rate 25% (plus 0 restatements and 0 non-claims set aside), $0.0150.");
    expect(out.report).toMatch(/1 failed the rules/);
    expect(out.report).toMatch(/a \\\| b \| sentence/);
    const withAside = reportStage("m", {}, { restatement_count: 1, non_claim_count: 2 }, {}, { overlaps: [{}] });
    expect(withAside.report).toMatch(/1 dropped as duplicates of another draft/);
    expect(withAside.report).toMatch(/1 restatement of kept claims, 2 non-claims/);
    expect(out.report).toMatch(/New topics not in the vault's vocabulary: x/);
    expect(out.proposed).toEqual([{ title: "T", description: "D", note_type: "PATTERN", topics: ["x"] }]);
    expect(reportStage("", {}, {}, {}, {})).toMatchObject({ skip_rate: 0, proposed_count: 0, cost_usd: 0 });
  });
});

describe("the extract-claims action", () => {
  const auth = (extra: Record<string, unknown> = {}) => ({ props: { base_url: "http://127.0.0.1:1", token: "t", llm_api_key: "k", llm_base_url: "https://llm.test/v1", llm_default_model: "m/default", ...extra } });
  const run = (c: unknown) => (extractClaimsAction as unknown as { run(c: unknown): Promise<Record<string, unknown>> }).run(c);
  const withFetch = async (fake: (u: string, body: string) => Response, body: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => fake(String(url), (init?.body as string | undefined) ?? "")) as typeof fetch;
    try {
      await body();
    } finally {
      globalThis.fetch = real;
    }
  };
  const vaultAnswers = (u: string) => (u.includes("/topics") ? json([]) : u.includes("/search") ? json({ hits: [] }) : json({ name: "s1", state: { global: { title: "Src", content: SOURCE } } }));
  const model = JSON.stringify({ kept: [{ claim: "Budget stops separating organizations", disagreement: "d" }], notes: [{ candidate_id: "c1", title: "Budget no longer separates organizations", description: "why", note_type: "concept", content: "c".repeat(90), topics: ["t"], confidence: "grounded", locus: "p" }] });

  it("runs the five stages in one step and reports each", async () => {
    await withFetch((u) => (u.startsWith("https://llm.test") ? json({ choices: [{ message: { content: model } }], usage: { cost: 0.001 } }) : vaultAnswers(u)), async () => {
      const live: { running: string | null }[] = [];
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", threshold: 5 }, output: { update: async (o: { running: string | null }) => { live.push(o); } } });
      expect(out).toMatchObject({ dry_run: true, model: "m/default", proposed_count: 1, source_title: "Src" });
      expect((out.stages as string[]).map((s) => s.split(" · ")[0])).toEqual(["read", "candidates", "check", "draft", "report"]);
      expect(String(out.summary)).toMatch(/^Dry run: 1 notes proposed.*, \d+ s\.$/);
      expect(live.map((l) => l.running)).toEqual(["read", "candidates", "check", "draft", "report", null]);
      const noLive = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", model: "m/x", threshold: 0.5 }, output: { update: async () => { throw new Error("no live output"); } } });
      expect(noLive.model).toBe("m/x");
    });
  });
  it("names the stage that failed and what finished before it", async () => {
    await withFetch((u) => (u.startsWith("https://llm.test") ? new Response("down", { status: 503, headers: { "retry-after": "0" } }) : vaultAnswers(u)), async () => {
      await expect(run({ auth: auth(), propsValue: { drive: "d", source: "s1" } })).rejects.toMatchObject({ category: "server", retryable: true, message: expect.stringMatching(/^Stage "candidates" failed: .*\(done before it: read: Read "Src"/) as unknown as string });
    });
    await withFetch(() => { throw new Error("plain"); }, async () => {
      await expect(run({ auth: auth(), propsValue: { drive: "d", source: "s1" } })).rejects.toThrow(/^Stage "read" failed: .*plain/);
    });
  });
  it("writes in write mode, and refuses a source already extracted before any model call", async () => {
    let posted = 0;
    let modelCalls = 0;
    const answers = (u: string) => {
      if (u.startsWith("https://llm.test")) {
        modelCalls++;
        return json({ choices: [{ message: { content: model } }], usage: { cost: 0.001 } });
      }
      if (u.includes("/notes") && !u.includes("/notes/")) {
        posted++;
        return json({ notes: [{ id: "new1", name: "x", readBack: "confirmed", operations: [] }] }, 201);
      }
      if (u.includes("/relationships") || u.includes("/actions")) return json({ operations: [] });
      return vaultAnswers(u);
    };
    await withFetch(answers, async () => {
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(out).toMatchObject({ dry_run: false, note_ids: ["new1"], source_updated: true });
      expect(String(out.summary)).toMatch(/^Wrote 1 note to \/knowledge\/notes, submitted for review, 1 linked to the source; the source is marked EXTRACTED\. /);
      expect((out.stages as string[]).slice(-2).map((x) => x.split(" · ")[0])).toEqual(["write", "pipeline"]);
      expect(posted).toBe(1);
    });
    modelCalls = 0;
    const extracted = (u: string) => (u.includes("/notes/s1") ? json({ name: "s1", state: { global: { title: "Src", content: SOURCE, extractedClaims: ["n1", "n2"] } } }) : answers(u));
    await withFetch(extracted, async () => {
      await expect(run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } })).rejects.toThrow(/Stage "pipeline check" failed: "Src" already has 2 extracted notes/);
      expect(modelCalls).toBe(0);
      const dry = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "dry_run" } });
      expect(String(dry.summary)).toMatch(/^Dry run: /);
    });
  });
  it("passes through a source the vault already holds the extraction of, once the queue has caught up, without a model call", async () => {
    let modelCalls = 0;
    let task: Record<string, unknown> = { id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "create" };
    let source: Record<string, unknown> = { title: "Src", content: SOURCE, status: "EXTRACTED", extractedClaims: ["n1", "n2"], extractionStats: { claimCount: 2 } };
    let caughtUpTo: Record<string, unknown> = { currentPhase: "reflect" };
    let queue = true;
    const serve = (u: string) => {
      if (u.startsWith("https://llm.test")) {
        modelCalls++;
        return json({ choices: [{ message: { content: model } }], usage: { cost: 0.001 } });
      }
      if (u.includes("/tasks/reconcile")) {
        task = { ...task, ...caughtUpTo };
        return json({ advanced: [{ taskId: "t1", phases: ["create"], to: "reflect", status: task.status, phase: task.currentPhase }] });
      }
      if (u.includes("/notes/d")) return json({ state: { global: { nodes: queue ? [{ id: "q1", documentType: "bai/pipeline-queue" }] : [] } } });
      if (u.includes("/notes/q1")) return json({ state: { global: { tasks: [task] } } });
      if (u.includes("/notes/s1")) return json({ name: "s1", state: { global: source } });
      if (u.includes("/notes") && !u.includes("/notes/")) return json({ notes: [{ id: "new1", name: "x", readBack: "confirmed", operations: [] }] }, 201);
      if (u.includes("/relationships") || u.includes("/actions")) return json({ operations: [] });
      return vaultAnswers(u);
    };
    await withFetch(serve, async () => {
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(out).toMatchObject({ passed_through: true, note_ids: [], existing_count: 2, pipeline: { task_id: "t1", to: "reflect" } });
      expect(String(out.summary)).toMatch(/^"Src" is already extracted \(2 notes\); nothing was written\. Caught the pipeline task up from the vault: create recorded, now at reflect\. The source's pipeline task is already past create \(at reflect\); this step has nothing left to do\. \d+ s\.$/);
      expect((out.stages as string[]).map((x) => x.split(" · ")[0])).toEqual(["read", "pipeline check"]);
      expect(modelCalls).toBe(0);

      // an extraction that found nothing, its task closed by the catch-up: passes through too
      task = { id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "reflect" };
      source = { title: "Contacts", content: SOURCE, status: "EXTRACTED", extractedClaims: [], extractionStats: { claimCount: 0 } };
      caughtUpTo = { status: "DONE", currentPhase: null };
      const empty = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(String(empty.summary)).toMatch(/^"Contacts" is already extracted \(no claims found\); nothing was written\. .* The source's pipeline task is already complete; create has nothing left to do\./);
      expect(modelCalls).toBe(0);

      // ...but with no pipeline around it, an empty extraction may be tried again (a better model, say)
      queue = false;
      const again = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(again.passed_through).toBeUndefined();
      expect(modelCalls).toBeGreaterThan(0);
    });
  });
  it("needs an LLM key and a model", async () => {
    await expect(run({ auth: { props: { base_url: "http://127.0.0.1:1", token: "t" } }, propsValue: {} })).rejects.toMatchObject({ category: "credential" });
    await expect(run({ auth: auth({ llm_default_model: "" }), propsValue: { model: " " } })).rejects.toMatchObject({ category: "validation" });
  });
});

describe("the quality fixes", () => {
  it("sort struck candidates into rejected, restatements and non-claims", async () => {
    const { classifySkips } = await import("../lib/agent/staged.js");
    const out = classifySkips([
      { candidate: "Budget always wins over process in practice", gate: "falsifiability", reason: "truism" },
      { candidate: "Same as the kept claim, said again", gate: "duplicate", reason: "restates c1" },
      { candidate: "What do you think of legacy?", gate: "sentence", reason: "a question" },
      { candidate: "Annual investment", gate: "sentence", reason: "label" },
      { candidate: "Chad Seiler, Head of Technology, KPMG in the US", gate: "sentence", reason: "Attribution line, not a claim" },
      { candidate: "60% say legacy slows them down a lot", gate: "sentence", reason: "stat" },
    ]);
    expect([out.rejected.length, out.restatement.length, out.not_a_claim.length]).toEqual([1, 1, 4]);
  });
  it("drop a draft that makes the same assertion as another, and survive a failed check", async () => {
    const drafts = { notes: [1, 2, 3].map((i) => ({ candidate_id: `c${i}`, title: `Claim number ${i} holds`, description: "why", note_type: "CONCEPT", content: "c".repeat(90), topics: ["operations"], confidence: "grounded", locus: "p" })) };
    const checked = { candidates: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] };
    const same = JSON.stringify({ same: [{ keep: "c1", drop: "c3", reason: "one assertion" }, { keep: "c3", drop: "c2" }, { keep: "c9", drop: "c1" }, { keep: "c2", drop: "c2" }] });
    const m = modelSays(JSON.stringify(drafts), same);
    const out = await draftStage(m.llm, "m", bundle, checked, m.fetchImpl);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c1", "c2"]);
    expect(out.overlaps).toEqual([{ kept: "c1", dropped: "c3", reason: "one assertion" }]);
    expect(out.summary).toBe("Drafted 2 notes, 1 dropped as the same assertion as another.");
    const broken = modelSays(JSON.stringify(drafts), "not json", "still not json");
    const kept = await draftStage(broken.llm, "m", bundle, checked, broken.fetchImpl);
    expect(kept.proposed).toHaveLength(3);
    expect(kept.overlap_check).toBe("failed");
    expect(kept.summary).toMatch(/duplicate check between drafts did not run/);
  });
  it("show the model each topic with an example, and what it covers", async () => {
    const out = await readSourceStage(vault({
      "notes/s1": { name: "s1", state: { global: { title: "T", content: "text", status: "EXTRACTING", extractedClaims: ["n1"] } } },
      "topics/conversion": [{ status: "MOC", title: "Sales MoC" }, { title: "Downsells raise full-price sales" }],
      "topics/lonely": () => { throw new Error("gone"); },
      "topics/nested": { nodes: [{ title: "Nested example" }] },
      topics: [{ name: "conversion", noteCount: 21 }, { name: "lonely", noteCount: 1 }, { name: "nested", noteCount: 2 }],
    }), "d", "s1");
    expect(out.topic_examples).toEqual([
      { name: "conversion", notes: 21, example: "Downsells raise full-price sales" },
      { name: "nested", notes: 2, example: "Nested example" },
      { name: "lonely", notes: 1, example: null },
    ]);
    expect(out).toMatchObject({ status: "EXTRACTING", extracted_claims: 1, derived_notes: 0 });
    // Notes a stopped step created but never recorded on the source still count; archived ones do not.
    const stopped = await readSourceStage(vault({
      "notes/s1": { name: "s1", edges: [{ direction: "in", linkType: "DERIVED_FROM", documentId: "n1" }, { direction: "in", linkType: "DERIVED_FROM", documentId: "n1" }, { direction: "in", linkType: "DERIVED_FROM", documentId: "n2" }, { direction: "in", linkType: "DERIVED_FROM", documentId: "n3" }, { direction: "out", linkType: "DERIVED_FROM", documentId: "n4" }, { direction: "in", linkType: "RELATES_TO", documentId: "n5" }], state: { global: { content: "text" } } },
      "notes/n1": { state: { global: { status: "IN_REVIEW" } } },
      "notes/n2": { state: { global: { status: "ARCHIVED" } } },
      "notes/n3": () => { throw new Error("gone"); },
      topics: [],
    }), "d", "s1");
    expect(stopped.derived_notes).toBe(1);
    const m = modelSays(JSON.stringify({ notes: [] }));
    await draftStage(m.llm, "m", { ...out, topics: ["conversion", "nested", "lonely", "extra"] }, { candidates: [{ id: "c1", claim: "x" }] }, m.fetchImpl);
    expect(m.calls[0].user).toMatch(/- conversion \(21\): e\.g\. "Downsells raise full-price sales"/);
    expect(m.calls[0].user).toMatch(/- lonely \(1\)\n/);
    expect(m.calls[0].user).toMatch(/- also: extra/);
  });
  it("retry a reply that is not JSON, and bound the model's reasoning when asked", async () => {
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      return json({ choices: [{ message: { content: n++ === 0 ? "Sure! Here you go" : '{"ok":true}' } }] });
    }) as typeof fetch;
    const out = await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u", reasoningEffort: "low" }, fetchImpl);
    expect(out.value).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    await completeJson(new LlmClient(LLM), { model: "m", system: "s", user: "u" }, fetchImpl);
    expect(bodies[2].reasoning).toBeUndefined();
  });
});

describe("how long a model call may take", () => {
  it("a gateway on loopback that says hosted gets the hosted limits", () => {
    const gw = { baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k" };
    expect(isLocalModel({ ...gw, locality: "hosted" })).toBe(false);
    expect(callTimeoutFor({ ...gw, locality: "hosted" })).toBe(JSON_CALL_TIMEOUT_MS);
    expect(callTimeoutFor({ ...gw, locality: "local" })).toBe(LOCAL_CALL_TIMEOUT_MS);
    expect(isLocalModel(gw)).toBe(true); // no locality: decided from the address, as before
  });

  it("gives a model on this computer or the local network ten minutes, a hosted provider 120 s", () => {
    for (const u of ["http://127.0.0.1:8083/v1", "http://localhost:11434/v1", "http://[::1]:8080/v1", "http://192.168.1.20:11434/v1", "http://10.0.0.5:1234/v1"]) {
      expect(isLocalModelEndpoint(u)).toBe(true);
      expect(callTimeoutFor({ baseUrl: u })).toBe(600_000);
    }
    for (const u of ["https://openrouter.ai/api/v1", "https://api.openai.com/v1", "not a url"]) {
      expect(isLocalModelEndpoint(u)).toBe(false);
      expect(callTimeoutFor({ baseUrl: u })).toBe(120_000);
    }
  });
});
