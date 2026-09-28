import { describe, expect, it } from "vitest";
import { extractCandidatesAction, extractCheckAction, extractDraftAction, extractReadAction, extractReportAction } from "../lib/actions/extract-steps.js";
import { completeJson, LlmClient, parseJsonAnswer } from "../lib/agent/llm.js";
import { asObject, candidatesStage, checkVaultStage, containsVerbatim, draftStage, readSourceStage, reportStage } from "../lib/agent/staged.js";
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
        { claim: "Spending more always helps", disagreement: "" },
        { claim: "Capital is not the primary constraint on technology value", disagreement: "x" },
        { claim: "  " },
        "junk",
      ],
      skipped: [{ candidate: "A heading", gate: "sentence", reason: "label" }, { candidate: "Odd", gate: "vibes", reason: "?" }, { candidate: "" }],
    };
    const m = modelSays(JSON.stringify(answer));
    const out = await candidatesStage(m.llm, "m", bundle, m.fetchImpl);
    expect(out.kept).toEqual([{ id: "c1", claim: "Budget stops separating organizations once spend is routine", locus: "p1", evidence: "e" }]);
    expect(out.skipped.map((s) => s.gate)).toEqual(["falsifiability", "falsifiability", "sentence", "sentence", "coherence"]);
    expect(out.summary).toBe("6 candidates: 1 pass all six gates, 5 struck (2 falsifiability, 2 sentence, 1 coherence).");
    expect(m.calls[0].user).toMatch(/Source title: Tech/);
  });
  it("reports zero survivors plainly", async () => {
    const m = modelSays("{}");
    expect((await candidatesStage(m.llm, "m", {}, m.fetchImpl)).summary).toBe("0 candidates: 0 pass all six gates, 0 struck.");
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
    const m = modelSays(JSON.stringify({ notes: [note("c2", "One", { topics: ["operations"] }), note("c3", "Two", { topics: ["operations"] })] }));
    const out = await draftStage(m.llm, "m", bundle, { candidates: [{ id: "c2" }, { id: "c3" }] }, m.fetchImpl);
    expect(out.summary).toBe("Drafted 2 notes.");
    expect(m.calls).toHaveLength(1);
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
    expect(out.summary).toBe("1 notes proposed, 1 skipped, 1 already in the vault, skip rate 25%, $0.0150.");
    expect(out.report).toMatch(/1 failed the rules/);
    expect(out.report).toMatch(/a \\\| b \| sentence/);
    expect(out.report).toMatch(/New topics not in the vault's vocabulary: x/);
    expect(out.proposed).toEqual([{ title: "T", description: "D", note_type: "PATTERN", topics: ["x"] }]);
    expect(reportStage("", {}, {}, {}, {})).toMatchObject({ skip_rate: 0, proposed_count: 0, cost_usd: 0 });
  });
});

describe("the five step actions", () => {
  const auth = (llm = true) => ({ props: { base_url: "http://127.0.0.1:1", token: "t", ...(llm ? { llm_api_key: "k", llm_base_url: "https://llm.test/v1", llm_default_model: "m/default" } : {}) } });
  const run = (a: unknown, propsValue: Record<string, unknown>, llm = true) => (a as { run(c: unknown): Promise<Record<string, unknown>> }).run({ auth: auth(llm), propsValue });
  it("chain through their outputs", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.startsWith("https://llm.test")) {
        const content = u && JSON.stringify({ kept: [{ claim: "Budget stops separating organizations", disagreement: "d" }], notes: [{ candidate_id: "c1", title: "Budget no longer separates organizations", description: "why", note_type: "concept", content: "c".repeat(90), topics: ["t"], confidence: "grounded", locus: "p" }] });
        return json({ choices: [{ message: { content } }], usage: { cost: 0.001 } });
      }
      if (u.includes("/topics")) return json([]);
      if (u.includes("/search")) return json({ hits: [] });
      return json({ name: "s1", state: { global: { title: "Src", content: SOURCE } } });
    }) as typeof fetch;
    try {
      const read = await run(extractReadAction, { drive: "d", source: "s1" });
      const cand = await run(extractCandidatesAction, { source: read });
      expect(cand).toMatchObject({ kept_count: 1, model: "m/default" });
      const check = await run(extractCheckAction, { drive: "d", candidates: JSON.stringify(cand), threshold: 7 });
      expect(check.threshold).toBe(0.9);
      expect((await run(extractCheckAction, { drive: "d", candidates: cand, threshold: 0.5 })).threshold).toBe(0.5);
      const draft = await run(extractDraftAction, { model: "m/x", source: read, checked: check });
      expect(draft).toMatchObject({ proposed_count: 1, model: "m/x" });
      const report = await run(extractReportAction, { source: read, candidates: cand, checked: check, draft });
      expect(report.summary).toMatch(/^1 notes proposed/);
      expect(String(report.report)).toMatch(/`m\/x`/);
      expect((await run(extractReportAction, { source: read, candidates: cand, checked: check, draft: { ...draft, model: 3 } })).report).toMatch(/Model ``/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("need an LLM key and a model", async () => {
    await expect(run(extractCandidatesAction, { source: {} }, false)).rejects.toMatchObject({ category: "credential" });
    const noDefault = { props: { base_url: "http://127.0.0.1:1", token: "t", llm_api_key: "k" } };
    await expect((extractDraftAction as unknown as { run(c: unknown): Promise<unknown> }).run({ auth: noDefault, propsValue: { model: "" } })).rejects.toMatchObject({ category: "validation" });
  });
});
