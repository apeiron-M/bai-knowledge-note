import { describe, expect, it, vi } from "vitest";
import { extractClaimsAction } from "../lib/actions/extract-claims.js";
import { callTimeoutFor, completeJson, isLocalModel, isLocalModelEndpoint, JSON_CALL_TIMEOUT_MS, LlmClient, LOCAL_CALL_TIMEOUT_MS, parseJsonAnswer, retryDelayMs } from "../lib/agent/llm.js";
import { asObject, CANDIDATES_SYSTEM, candidatesStage, checkVaultStage, containsVerbatim, draftStage, mapLimit, readSourceStage, reportStage } from "../lib/agent/staged.js";
import type { KnowledgeVaultClient } from "../lib/common/client.js";

const LLM = { baseUrl: "https://llm.test/v1", apiKey: "k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Answers each model call with the next scripted content string. */
function modelSays(...answers: (string | { content: string; finish?: string })[]) {
  let i = 0;
  const calls: { max_tokens: number; user: string }[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    if (_u.endsWith("/active")) return new Response("no gateway", { status: 404 });
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
    expect(out.kept).toEqual([{ id: "c1", claim: "Budget stops separating organizations once spend is routine", locus: "p1", evidence: "e", window: "w1" }]);
    // Rejected on a gate: the claim nobody could dispute, the copied sentence, the unknown gate.
    expect(out.skipped.map((s) => s.gate)).toEqual(["falsifiability", "sentence", "other"]);
    // Set aside: the bare statistic and the heading are not claims.
    expect(out.non_claims.map((s) => s.candidate)).toEqual(["74 percent of firms invest over $50m", "A heading"]);
    expect(out.summary).toBe("4 distinct claims: 1 kept, 3 rejected on a gate (1 for a reason outside the gates); 4 non-claims (headings, captions, bare statistics).");
    expect(m.calls[0].user).toMatch(/Source title: Tech/);
  });
  /** A gateway that says which model is live (`live`), and answers each chat call with the next answer. */
  function gateway(answers: string[], live: { locality: string; model: string; contextTokens?: number | null } = { locality: "local", model: "local-20b" }) {
    let i = 0;
    let running = 0;
    const seen: { user: string }[] = [];
    const peak = { n: 0 };
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      if (u.endsWith("/active")) return json({ contextTokens: null, ...live });
      const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
      seen.push({ user: body.messages[1].content });
      peak.n = Math.max(peak.n, ++running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return json({ choices: [{ message: { content: answers[Math.min(i++, answers.length - 1)] } }] });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" }, fetchImpl);
    return { llm, fetchImpl, seen, peak, live };
  }
  const claimAnswer = (claim: string) => JSON.stringify({ source_kind: "knowledge", non_claims: 0, kept: [{ claim, locus: "p", evidence: "e", disagreement: "someone would argue otherwise" }], skipped: [] });
  const section = (name: string, n: number) => [`# ${name}`, ...Array.from({ length: n }, (_, k) => `${name} paragraph ${k} ${"z".repeat(980)}.`)].join("\n\n");

  it("reads a long source window by window, with each window's heading, and numbers the claims across them", async () => {
    const text = [section("Hardware", 6), section("Memory", 6)].join("\n\n");
    const g = gateway([claimAnswer("GPUs set the cost of inference"), claimAnswer("Bandwidth limits decoding speed")]);
    const out = await candidatesStage(g.llm, "m", { title: "Book", text }, g.fetchImpl, { windowChars: 7_000 });
    expect(out.window_count).toBe(2);
    expect(out.kept.map((c) => [c.id, c.window])).toEqual([["c1", "w1"], ["c2", "w2"]]);
    expect(g.seen[0].user).toMatch(/^Source title: Book\nSection: Hardware\n\n# Hardware/);
    expect(g.seen[1].user).toMatch(/Section: Memory/);
    expect(out.summary).toMatch(/^2 distinct claims from 2 parts: 2 kept, 0 rejected on a gate\.$/);
  });
  it("runs one window at a time on a local model, and three at once on a hosted one", async () => {
    const text = section("A", 30);
    const local = gateway([claimAnswer("x claim one")]);
    await candidatesStage(local.llm, "m", { title: "T", text }, local.fetchImpl, { windowChars: 4_000 });
    expect(local.peak.n).toBe(1);
    const hosted = gateway([claimAnswer("x claim one")], { locality: "hosted", model: "gpt-6.1-sol" });
    await candidatesStage(hosted.llm, "m", { title: "T", text }, hosted.fetchImpl, { windowChars: 4_000 });
    expect(hosted.peak.n).toBe(3);
  });
  it("sizes the windows still to come for a model switched mid-source", async () => {
    const text = section("A", 120); // about 120,000 characters: three hosted windows, then more
    const g = gateway([claimAnswer("x claim one")], { locality: "hosted", model: "gpt-6.1-sol" });
    const sizes: number[] = [];
    const watching = (async (u: string, init?: RequestInit) => {
      const r = await g.fetchImpl(u, init);
      if (!u.endsWith("/active")) {
        sizes.push((JSON.parse(init?.body as string) as { messages: { content: string }[] }).messages[1].content.length);
        // After the first batch of three, the user switches to this computer's model.
        if (sizes.length === 3) Object.assign(g.live, { locality: "local", model: "local-20b" });
      }
      return r;
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" }, watching);
    await candidatesStage(llm, "m", { title: "T", text }, watching);
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.max(...sizes.slice(0, 3))).toBeGreaterThan(9_000);
    expect(Math.max(...sizes.slice(3))).toBeLessThanOrEqual(8_100);
  });
  it("asks once more after an empty answer, then splits the window in two", async () => {
    const text = section("A", 6); // one window of about 6,000 characters
    const g = gateway(["{}", "{}", claimAnswer("first half claim"), claimAnswer("second half claim")]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl);
    expect(g.seen).toHaveLength(4);
    expect(out.kept.map((c) => c.window)).toEqual(["w1.1", "w1.2"]);
    expect(out.empty_parts).toEqual([]);
  });
  it("reports a part that stays empty at the smallest size", async () => {
    const text = section("A", 3); // about 3,000 characters: too small to split
    const g = gateway(["{}", "{}"]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl);
    expect(out.empty_parts).toEqual(['"A" (w1)']);
    expect(out.summary).toMatch(/1 part yielded nothing/);
  });
  it("splits a window the model cannot answer in JSON, and fails the stage when nothing could be read", async () => {
    const text = section("A", 6);
    const g = gateway(["not json", "not json", claimAnswer("half one"), claimAnswer("half two")]);
    expect((await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl)).kept).toHaveLength(2);
    const never = gateway(["not json"]);
    await expect(candidatesStage(never.llm, "m", { title: "T", text: section("A", 3) }, never.fetchImpl)).rejects.toThrow(/did not answer with JSON/);
  });
  it("says a source holds no knowledge only when every part says so, and never when the model leaves it out", async () => {
    const references = JSON.stringify({ source_kind: "not_knowledge", source_kind_reason: "a list of references", kept: [], skipped: [], non_claims: 0 });
    const g = gateway([references]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text: section("Further reading", 3) }, g.fetchImpl);
    expect([out.source_kind, out.source_kind_reason]).toEqual(["not_knowledge", "a list of references"]);
    expect(g.seen).toHaveLength(1); // a not-knowledge answer is an answer, not an empty one
    const silent = gateway([JSON.stringify({ kept: [], skipped: [{ candidate: "A heading", gate: "sentence", reason: "label" }], non_claims: 0 })]);
    expect((await candidatesStage(silent.llm, "m", { title: "T", text: section("A", 3) }, silent.fetchImpl)).source_kind).toBe("knowledge");
    const mixed = gateway([references, claimAnswer("a real claim here")]);
    expect((await candidatesStage(mixed.llm, "m", { title: "T", text: [section("Refs", 6), section("Body", 6)].join("\n\n") }, mixed.fetchImpl, { windowChars: 7_000 })).source_kind).toBe("knowledge");
  });
  it("offers the model only the six gates and duplicate, and tells it every subject is in scope", () => {
    expect(CANDIDATES_SYSTEM).not.toMatch(/out_of_scope/);
    expect(CANDIDATES_SYSTEM).toMatch(/"gate":"sentence\|transclusion\|falsifiability\|coherence\|independence\|non_attribution\|duplicate"/);
    expect(CANDIDATES_SYSTEM).toMatch(/Every subject the source covers is in scope/);
    expect(CANDIDATES_SYSTEM).toMatch(/Never strike a statement only because it is descriptive, practical or technical/);
    expect(CANDIDATES_SYSTEM).toMatch(/"source_kind":"knowledge"/);
  });
  it("reports zero survivors plainly", async () => {
    const m = modelSays("{}");
    expect((await candidatesStage(m.llm, "m", {}, m.fetchImpl)).summary).toBe("0 distinct claims: 0 kept, 0 rejected on a gate.");
  });

  it("never calls a source 'not knowledge' when a part stayed empty, could not be read, or kept a claim", async () => {
    const references = JSON.stringify({ source_kind: "not_knowledge", source_kind_reason: "a list of references", kept: [], skipped: [], non_claims: 0 });
    const text = [section("Refs", 6), section("Body", 6)].join("\n\n");
    const withEmpty = gateway([references, "{}", "{}"]);
    const a = await candidatesStage(withEmpty.llm, "m", { title: "T", text }, withEmpty.fetchImpl, { windowChars: 7_000 });
    expect(a.empty_parts.length + a.windows.length).toBeGreaterThan(1);
    expect(a.source_kind).toBe("knowledge");
    const withUnreadable = gateway([references, "not json"]);
    expect((await candidatesStage(withUnreadable.llm, "m", { title: "T", text }, withUnreadable.fetchImpl, { windowChars: 7_000 })).source_kind).toBe("knowledge");
    const keptOne = gateway([JSON.stringify({ source_kind: "not_knowledge", source_kind_reason: "an index", kept: [{ claim: "Indexes hide the argument they point to", locus: "p", evidence: "e", disagreement: "an index is a map" }], skipped: [], non_claims: 0 })]);
    expect((await candidatesStage(keptOne.llm, "m", { title: "T", text: section("Index", 3) }, keptOne.fetchImpl)).source_kind).toBe("knowledge");
  });
});

describe("3. vault check", () => {
  const search = (q: { q: string }) => ({ hits: q.q.startsWith("dup") ? [{ node: { documentId: "n1", title: "Old", status: "CANONICAL" }, similarity: 0.934 }, { node: { status: "MOC" }, similarity: 0.9 }] : [] });
  it("flags candidates the vault already holds", async () => {
    const out = await checkVaultStage(vault({ search, "notes/n1": { edges: [] } }), "d", { kept: [{ id: "c1", claim: "dup claim" }, { id: "c2", claim: "new claim" }] });
    expect(out.candidates.map((c) => c.likely_duplicate)).toEqual([true, false]);
    expect(out.candidates[0].matches).toEqual([{ id: "n1", title: "Old", similarity: 0.934, eligible: true }]);
    expect(out.summary).toBe("Searched the vault for 2 candidates: 1 likely already there (similarity ≥ 0.9); best match 0.934.");
    const none = await checkVaultStage(vault({ search, "notes/n1": { edges: [] } }), "d", { kept: [{ id: "c1", claim: "x" }] }, 0.95);
    expect(none.summary).toBe("Searched the vault for 1 candidate: none already there; best match 0.");
    expect((await checkVaultStage(vault({ search, "notes/n1": { edges: [] } }), "d", {})).summary).toBe("Searched the vault for 0 candidates: none already there.");
  });
  it("marks the matches a claim may converge on: close enough, live, and not replaced by another note", async () => {
    const search = () => ({ hits: [
      { node: { documentId: "live", title: "Live", status: "IN_REVIEW" }, similarity: 0.81 },
      { node: { documentId: "replaced", title: "Replaced", status: "CANONICAL" }, similarity: 0.9 },
      { node: { documentId: "far", title: "Far", status: "CANONICAL" }, similarity: 0.7 },
    ] });
    const reads: string[] = [];
    const v = vault({
      search,
      "notes/live": () => { reads.push("live"); return { edges: [{ direction: "out", linkType: "DERIVED_FROM" }] }; },
      "notes/replaced": () => { reads.push("replaced"); return { edges: [{ direction: "in", linkType: "SUPERSEDES" }] }; },
    });
    const out = await checkVaultStage(v, "d", { kept: [{ id: "c1", claim: "a claim", window: "w2" }] });
    expect(out.candidates[0].matches.map((m) => [m.id, m.eligible])).toEqual([["live", true], ["replaced", false], ["far", false]]);
    expect(out.candidates[0].window).toBe("w2");
    expect(reads.sort()).toEqual(["live", "replaced"]); // nothing is read for a match below the floor
  });
});

describe("4. draft", () => {
  const checked = { candidates: [
    { id: "c1", claim: "A", locus: "p1", evidence: "e", matches: [{ id: "n9", title: "Old", similarity: 0.95, eligible: true }] },
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
    expect(out.existing).toEqual([{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same", locus: "p1", evidence: "e" }]);
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
  it("drafts each window's claims from that window's text alone, at most 8 to a call on a local model", async () => {
    const m = modelSays(JSON.stringify({ notes: [] }), JSON.stringify({ notes: [] }), JSON.stringify({ notes: [] }));
    const local = new LlmClient({ ...LLM, locality: "local" }, m.fetchImpl);
    const windows = [{ id: "w1", heading: "Alpha", text: "ALPHA text about GPUs" }, { id: "w2", heading: null, text: "BETA text about memory" }];
    const many = { candidates: [...Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, claim: `claim ${i}`, window: "w1" })), { id: "c11", claim: "beta claim", window: "w2" }] };
    await draftStage(local, "m", bundle, many, m.fetchImpl, windows);
    const drafts = m.calls.map((c) => c.user);
    expect(drafts.map((u) => (u.match(/^- c\d+:/gm) ?? []).length)).toEqual([8, 2, 1]);
    expect(drafts[0]).toMatch(/Section: Alpha\nALPHA text about GPUs$/);
    expect(drafts[0]).not.toMatch(/BETA/);
    expect(drafts[2]).toMatch(/BETA text about memory$/);
  });
  it("links a claim to an existing note only when that note was a close, live match; otherwise writes it", async () => {
    const m = modelSays(
      JSON.stringify({ existing: [
        { candidate_id: "c1", note_id: "n9", title: "Old", reason: "same" },
        { candidate_id: "c2", note_id: "n8", title: "Replaced", reason: "same" },
        { candidate_id: "c3", note_id: "invented", title: "?", reason: "same" },
      ] }),
      JSON.stringify({ notes: [note("c2", "Bandwidth limits decoding at small batches", { topics: ["operations"] }), note("c3", "Kernels decide throughput on one GPU", { topics: ["operations"] })] }),
      '{"same":[]}',
    );
    const out = await draftStage(m.llm, "m", bundle, { candidates: [
      { id: "c1", claim: "A", locus: "p1", evidence: "the passage", matches: [{ id: "n9", title: "Old", similarity: 0.82, eligible: true }] },
      { id: "c2", claim: "B", matches: [{ id: "n8", title: "Replaced", similarity: 0.95, eligible: false }] },
      { id: "c3", claim: "C", matches: [] },
    ] }, m.fetchImpl);
    expect(out.existing).toEqual([{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same", locus: "p1", evidence: "the passage" }]);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c2", "c3"]);
    expect(m.calls[1].user).toMatch(/c2: the note you named is not one of this claim's close matches/);
  });
  it("keeps one note when two windows found the same claim", async () => {
    const m = modelSays(
      JSON.stringify({ notes: [note("c1", "Memory bandwidth limits decoding speed", { topics: ["operations"] })] }),
      JSON.stringify({ notes: [note("c2", "Decoding speed is bound by memory bandwidth", { topics: ["operations"] })] }),
      JSON.stringify({ same: [{ keep: "c1", drop: "c2", reason: "one assertion" }] }),
    );
    const windows = [{ id: "w1", heading: null, text: "first part" }, { id: "w2", heading: null, text: "second part" }];
    const out = await draftStage(m.llm, "m", bundle, { candidates: [{ id: "c1", claim: "x", window: "w1" }, { id: "c2", claim: "y", window: "w2" }] }, m.fetchImpl, windows);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c1"]);
    expect(out.overlaps).toEqual([{ kept: "c1", dropped: "c2", reason: "one assertion" }]);
  });
  it("reports a claim the model left out instead of counting it as merged", async () => {
    const m = modelSays(JSON.stringify({ notes: [note("c1", "Memory bandwidth limits decoding speed", { topics: ["operations"] })] }));
    const out = await draftStage(m.llm, "m", bundle, { candidates: [{ id: "c1", claim: "x" }, { id: "c2", claim: "y" }] }, m.fetchImpl);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c1"]);
    expect(out.rejected).toEqual([{ candidate_id: "c2", issues: ["the model did not draft it"] }]);
    expect(out.summary).not.toMatch(/merged/);
  });
  it("never writes a claim it also linked to an existing note, and ignores claims from outside the batch", async () => {
    const m = modelSays(JSON.stringify({
      existing: [{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same" }],
      notes: [
        note("c1", "Written anyway although it is in the vault", { topics: ["operations"] }),
        note("c2", "Kernels decide throughput on one GPU", { topics: ["operations"], merged_ids: ["c7"] }),
        note("c9", "A claim nobody asked about", { topics: ["operations"] }),
      ],
    }));
    const out = await draftStage(m.llm, "m", bundle, { candidates: [
      { id: "c1", claim: "A", matches: [{ id: "n9", title: "Old", similarity: 0.9, eligible: true }] },
      { id: "c2", claim: "B" },
    ] }, m.fetchImpl);
    expect(out.existing.map((e) => e.candidate_id)).toEqual(["c1"]);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c2"]);
    expect(out.rejected).toEqual([]);
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

  it("archives a source with no knowledge, and names the parts that yielded nothing or could not be read", () => {
    const out = reportStage("m", { title: "Reading list" }, {
      source_kind: "not_knowledge", source_kind_reason: "a list of references", window_count: 3,
      empty_parts: ['"Notes" (w2)'], unreadable_parts: ["w3"], other_gate_count: 2,
      skipped: [{ candidate: "x", gate: "other", reason: "?" }, { candidate: "y", gate: "other", reason: "?" }],
    }, {}, {});
    expect(out.archive_reason).toBe("a list of references");
    expect(out.summary).toMatch(/ Archived: a list of references\.$/);
    expect(out.report).toMatch(/\*\*Not knowledge:\*\* a list of references/);
    expect(out.report).toMatch(/2 rejected on a gate \(2 for a reason outside the gates\)/);
    expect(out.report).toMatch(/read in 3 parts/);
    expect(out.report).toMatch(/Parts that yielded nothing: "Notes" \(w2\)\./);
    expect(out.report).toMatch(/Parts the model could not read: w3\./);
    // A claim kept, or one found in the vault, means the source holds knowledge after all.
    expect(reportStage("m", {}, { source_kind: "not_knowledge" }, {}, { existing: [{ title: "Old", note_id: "n1" }] }).archive_reason).toBeNull();
    expect(reportStage("m", {}, {}, {}, {}).archive_reason).toBeNull();
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

describe("the model in charge", () => {
  const GATEWAY = { baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" as const, defaultModel: "local-20b" };
  it("asks the desktop gateway which model is live, and keeps the answer for a few seconds", async () => {
    let asks = 0;
    const f = (async () => { asks++; return json({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null }); }) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect(await llm.active()).toEqual({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null, fromGateway: true });
    await llm.active();
    expect(asks).toBe(1);
    await llm.active(undefined, true);
    expect(asks).toBe(2);
  });
  it("uses the connection's settings without a gateway, and never asks for a connection the app did not set up", async () => {
    let asks = 0;
    const f = (async () => { asks++; return new Response("no", { status: 404 }); }) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect(await llm.active()).toEqual({ model: "local-20b", locality: "local", contextTokens: null, fromGateway: false });
    await llm.active(undefined, true);
    expect(asks).toBe(1); // a 404 means no gateway for the rest of the run
    const plain = new LlmClient({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" }, f);
    expect((await plain.active()).locality).toBe("hosted");
    expect(asks).toBe(1);
  });
  it("reads a hosted model's context from OpenRouter's model list, once", async () => {
    let lists = 0;
    const f = (async (u: string) => {
      if (u.includes("/models")) { lists++; return json({ data: [{ id: "deepseek/v4", name: "DeepSeek V4", context_length: 16_000 }] }); }
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", defaultModel: "deepseek/v4" }, f);
    expect(await llm.active()).toEqual({ model: "deepseek/v4", locality: "hosted", contextTokens: 16_000, fromGateway: false });
    await llm.active(undefined, true);
    expect(lists).toBe(1);
  });
  it("keeps following the gateway through a restart: a failed ask after an answer reuses the last answer", async () => {
    const answers: Response[] = [
      json({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null }),
      new Response("restarting", { status: 404 }),
      new Response("busy", { status: 503 }),
      json({ model: "local-20b", locality: "local", contextTokens: 32_768 }),
    ];
    let asks = 0;
    const f = (async () => answers[asks++]) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect((await llm.active(undefined, true)).model).toBe("gpt-6.1-sol");
    expect(await llm.active(undefined, true)).toEqual({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null, fromGateway: true });
    expect((await llm.active(undefined, true)).model).toBe("gpt-6.1-sol");
    expect(await llm.active(undefined, true)).toEqual({ model: "local-20b", locality: "local", contextTokens: 32_768, fromGateway: true });
    expect(asks).toBe(4); // the 404 after an answer did not switch the gateway off
  });
  it("treats only a missing route before any answer as no gateway; other refusals are tried again", async () => {
    let asks = 0;
    const f = (async () => { asks++; return new Response("slow down", { status: 429 }); }) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect(await llm.active(undefined, true)).toMatchObject({ locality: "local", fromGateway: false });
    await llm.active(undefined, true);
    expect(asks).toBe(2);
  });
  it("carries on with the connection's settings when the gateway stops answering", async () => {
    const llm = new LlmClient(GATEWAY, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    expect(await llm.active()).toMatchObject({ locality: "local", fromGateway: false });
  });
  it("gives each call the live model's timeout, and sends a call again once when the model changed while it hung", async () => {
    let live = { model: "gpt-6.1-sol", locality: "hosted" };
    let chats = 0;
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const f = (async (u: string) => {
      if (u.endsWith("/active")) return json({ ...live, contextTokens: null });
      chats++;
      if (chats === 1) {
        live = { model: "local-20b", locality: "local" };
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }
      return json({ choices: [{ message: { content: '{"ok":1}' } }] });
    }) as unknown as typeof fetch;
    const out = await completeJson(new LlmClient(GATEWAY, f), { model: "m", system: "s", user: "u" }, f);
    expect(out.value).toEqual({ ok: 1 });
    expect(chats).toBe(2);
    expect(timeouts.mock.calls.map((c) => c[0]).filter((ms) => ms !== 5_000)).toEqual([JSON_CALL_TIMEOUT_MS, LOCAL_CALL_TIMEOUT_MS]);
    timeouts.mockRestore();
  });
});
