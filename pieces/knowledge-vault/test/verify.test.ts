import { describe, expect, it } from "vitest";
import { verifyNotesAction } from "../lib/actions/verify-notes.js";
import { LlmClient } from "../lib/agent/llm.js";
import { checkNote, duplicateCandidates, judgeStage, planRetirements, readVerifyNotes, retireStage, type NoteVerdict, type VerifyNote } from "../lib/agent/verify.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function vault(routes: Record<string, unknown>) {
  const requests: RequestOptions[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      const key = keys.find((k) => o.path === k || o.path.startsWith(k));
      if (!key) throw new Error(`no route ${o.path}`);
      const v = routes[key];
      return typeof v === "function" ? (v as (o: RequestOptions) => unknown)(o) : v;
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
function modelSays(...answers: string[]) {
  let i = 0;
  const users: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    users.push((JSON.parse(init?.body as string) as { messages: { content: string }[] }).messages[1].content);
    return json({ choices: [{ message: { content: answers[Math.min(i++, answers.length - 1)] } }], usage: { cost: 0.001 } });
  }) as typeof fetch;
  return { llm: new LlmClient({ baseUrl: "https://llm.test/v1", apiKey: "k" }, fetchImpl), fetchImpl, users };
}
const good = (id: string, extra: Partial<VerifyNote> = {}): VerifyNote => ({
  id, title: `Claim ${id} holds under load`, description: "Why it holds and what it changes", note_type: "CONCEPT", content: "c".repeat(100), topics: ["ops"], status: "IN_REVIEW", origin: "DERIVED",
  edges: [
    { direction: "out", linkType: "BUILDS_ON", reason: "r" }, { direction: "in", linkType: "RELATES_TO", reason: "r" },
    { direction: "out", linkType: "DERIVED_FROM", documentId: "src" }, { direction: "in", linkType: "CORE_IDEA" },
  ],
  ...extra,
});

describe("the verify checks", () => {
  it("pass a complete note and name each missing piece", () => {
    expect(checkNote(good("n1"), "src")).toEqual([]);
    const bare = checkNote(good("n2", { description: "", origin: null, edges: [{ direction: "out", linkType: "RELATES_TO", reason: " " }] }), "src");
    expect(bare).toEqual([
      "description is required",
      "only 1 link to other notes; the vault wants at least 2",
      "no other note links to it (orphan)",
      "1 link has no reason",
      "no DERIVED_FROM link to its source",
      "not in any MoC",
      "provenance is not DERIVED",
    ]);
    expect(checkNote(good("n3", { edges: [] }), "src")).toContain("only 0 links to other notes; the vault wants at least 2");
    expect(checkNote(good("n4", { edges: [{ direction: "out", linkType: "RELATES_TO" }, { direction: "in", linkType: "BUILDS_ON" }] }), "src")).toContain("2 links have no reason");
  });
  it("read a source's notes without the archived ones", async () => {
    const v = vault({
      "notes/src": { name: "src", state: { global: { title: "Tech", status: "EXTRACTED", extractedClaims: ["n1", { claimRef: "n2" }] } } },
      "notes/n1": { state: { global: { title: "T1", status: "IN_REVIEW", topics: [{ name: "ops" }, {}], provenance: { sourceOrigin: "DERIVED" }, noteType: "CONCEPT" } }, edges: [{ linkType: "CORE_IDEA", direction: "in" }] },
      "notes/n2": { name: "n2", state: { global: { status: "ARCHIVED" } } },
    });
    const r = await readVerifyNotes(v.client, "d", "src");
    expect(r.notes.map((n) => [n.id, n.title, n.topics, n.origin])).toEqual([["n1", "T1", ["ops"], "DERIVED"]]);
    const plain = await readVerifyNotes(vault({ "notes/s2": { name: "s2" } }).client, "d", "s2");
    expect(plain).toMatchObject({ sourceTitle: "s2", sourceStatus: null, notes: [] });
    const unnamed = await readVerifyNotes(vault({ "notes/s3": { name: "s3", state: { global: { extractedClaims: ["n9"] } } }, "notes/n9": {} }).client, "d", "s3");
    expect(unnamed.notes[0]).toMatchObject({ title: "n9", origin: null, edges: [] });
  });
});

describe("duplicates", () => {
  it("offer only close neighbours, marking the source's own notes", async () => {
    const v = vault({
      "notes/n1/similar": [{ similarity: 0.9123, node: { documentId: "x1", title: "Old", description: "d" } }, { similarity: 0.85, node: { documentId: "n2" } }, { similarity: 0.95, node: { documentId: "m1", status: "MOC" } }, { similarity: 0.6, node: { documentId: "x2" } }, { node: { documentId: "x3" } }, { similarity: 0.99, node: { documentId: "n1" } }, {}],
      "notes/n2/similar": () => { throw new Error("not indexed"); },
    });
    const c = await duplicateCandidates(v.client, "d", [good("n1"), good("n2")]);
    expect(c.n1).toEqual([{ id: "x1", title: "Old", description: "d", similarity: 0.912, sibling: false }, { id: "n2", title: "", description: "", similarity: 0.85, sibling: true }]);
    expect(c.n2).toEqual([]);
  });
  it("judge in batches, trusting only duplicates it was shown", async () => {
    const notes = [good("n1"), good("n2"), good("n3"), good("n4")];
    const m = modelSays(
      JSON.stringify({ notes: [{ id: "n1", verdict: "flag", problems: ["a restated figure", ""], duplicate_of: "x1", duplicate_reason: "same finding" }, { id: "n2", verdict: "pass", duplicate_of: "zz" }, { id: "nope" }] }),
      JSON.stringify({ notes: [{ id: "n4", verdict: "maybe" }] }),
    );
    const { verdicts, cost } = await judgeStage(m.llm, "m", notes, { n1: [{ id: "x1", title: "Old", description: "d", similarity: 0.9, sibling: false }] }, m.fetchImpl);
    expect(verdicts.get("n1")).toEqual({ id: "n1", verdict: "flag", problems: ["a restated figure"], duplicate_of: "x1", duplicate_reason: "same finding" });
    expect(verdicts.get("n2")?.duplicate_of).toBeNull();
    expect(verdicts.get("n4")?.verdict).toBe("pass");
    expect(m.users).toHaveLength(2);
    expect(m.users[0]).toMatch(/- x1 \(0\.9\): Old — d/);
    expect(m.users[1]).toMatch(/\(none\)/);
    expect(cost).toBeCloseTo(0.002);
    const untyped = modelSays("{}");
    await judgeStage(untyped.llm, "m", [good("n1", { note_type: "" })], {}, untyped.fetchImpl);
    expect(untyped.users[0]).toMatch(/NOTE n1 \(no type\)/);
  });
  it("retire the newer note, keep the vault's, and never retire both of a pair", () => {
    const notes = [good("n1"), good("n2"), good("n3")];
    const v = (id: string, dup: string | null): NoteVerdict => ({ id, verdict: "pass", problems: [], duplicate_of: dup, duplicate_reason: dup ? "same" : "" });
    const cands = {
      n1: [{ id: "n2", title: "Claim n2", description: "", similarity: 0.9, sibling: true }],
      n2: [{ id: "n1", title: "Claim n1", description: "", similarity: 0.9, sibling: true }],
      n3: [{ id: "x1", title: "Old vault note", description: "", similarity: 0.95, sibling: false }],
    };
    const plan = planRetirements(notes, new Map([["n1", v("n1", "n2")], ["n2", v("n2", "n1")], ["n3", v("n3", "x1")]]), cands);
    expect(plan).toEqual([
      { duplicate: "n2", survivor: "n1", survivor_title: "Claim n1 holds under load", reason: "same" },
      { duplicate: "n3", survivor: "x1", survivor_title: "Old vault note", reason: "same" },
    ]);
    const unexplained = planRetirements([good("n3")], new Map([["n3", { ...v("n3", "x1"), duplicate_reason: "" }]]), cands);
    expect(unexplained[0].reason).toBe("the same assertion");
    expect(planRetirements([good("n9")], new Map([["n9", v("n9", "gone")]]), {})).toEqual([]);
  });
  it("retire with SUPERSEDES from the survivor and a rejection that says why", async () => {
    const v = vault({
      relationships: {},
      actions: (o: RequestOptions) => ((o.json as { documentId: string }).documentId === "bad" ? { operations: [{ type: "REJECT_NOTE", error: "Can only reject from IN_REVIEW status" }] } : { operations: [] }),
    });
    const titles = new Map([["n3", "New claim"], ["bad", "Bad"]]);
    const out = await retireStage(v.client, {
      retirements: [{ duplicate: "n3", survivor: "x1", survivor_title: "Old", reason: "same finding" }, { duplicate: "bad", survivor: "x1", survivor_title: "Old", reason: "r" }, { duplicate: "gone", survivor: "x2", survivor_title: "O", reason: "r" }],
      titles, actor: "verify-notes · m", now: () => new Date("2026-09-28T12:00:00Z"),
    });
    expect(v.requests[0].json).toEqual({ source: "x1", target: "n3", type: "SUPERSEDES", reason: '"Old" already makes this claim: same finding', confidence: "established" });
    expect((v.requests[1].json as { actions: { input: Record<string, unknown> }[] }).actions[0].input).toMatchObject({ actor: "verify-notes · m", timestamp: "2026-09-28T12:00:00.000Z", comment: 'Duplicate of "Old" (x1): same finding' });
    expect(out.retired.map((r) => r.duplicate)).toEqual(["n3", "gone"]);
    expect(out.problems).toEqual(['"Bad": Can only reject from IN_REVIEW status']);
    expect(out.summary).toBe("Retired 2 duplicates (SUPERSEDES from the surviving note, rejected back to DRAFT with a comment); 1 could not be retired.");
    const failing = vault({ relationships: () => { throw new Error("down"); } });
    const f = await retireStage(failing.client, { retirements: [{ duplicate: "n3", survivor: "x1", survivor_title: "Old", reason: "r" }, { duplicate: "u", survivor: "x1", survivor_title: "Old", reason: "r" }], titles, actor: "a" });
    expect(f.problems).toEqual(['"New claim": down', '"u": down']);
    expect(f.summary).toBe("Retired 0 duplicates (SUPERSEDES from the surviving note, rejected back to DRAFT with a comment); 2 could not be retired.");
    expect((await retireStage(vault({ relationships: {}, actions: { operations: [] } }).client, { retirements: [{ duplicate: "a", survivor: "b", survivor_title: "B", reason: "r" }], titles, actor: "a" })).summary).toMatch(/^Retired 1 duplicate \(/);
  });
});

describe("the verify-notes action", () => {
  const auth = { props: { base_url: "http://127.0.0.1:1", token: "t", llm_api_key: "k", llm_base_url: "https://llm.test/v1", llm_default_model: "m/default" } };
  let claims = ["n1", "n2", "n3"];
  let answer: unknown[] = [{ id: "n1", verdict: "pass" }, { id: "n2", verdict: "flag", problems: ["a restated figure"] }, { id: "n3", verdict: "pass", duplicate_of: "x1", duplicate_reason: "same finding" }];
  let rejectFails = false;
  const serve = (u: string, init?: RequestInit) => {
    if (u.startsWith("https://llm.test")) {
      return json({ choices: [{ message: { content: JSON.stringify({ notes: answer }) } }], usage: { cost: 0.002 } });
    }
    if (u.includes("/actions") && rejectFails) return json({ operations: [{ type: "REJECT_NOTE", error: "Can only reject from IN_REVIEW status" }] });
    if (u.includes("/n3/similar")) return json([{ similarity: 0.93, node: { documentId: "x1", title: "Old", description: "d" } }]);
    if (u.includes("/similar")) return json([]);
    if (u.includes("/notes/src")) return json({ name: "src", state: { global: { title: "Tech", status: "EXTRACTED", extractedClaims: claims } } });
    if (u.match(/\/notes\/n\d/)) {
      const id = /\/notes\/(n\d)/.exec(u)?.[1] ?? "";
      const n = good(id);
      return json({ state: { global: { title: n.title, description: n.description, noteType: n.note_type, content: n.content, topics: [{ name: "ops" }], status: "IN_REVIEW", provenance: { sourceOrigin: "DERIVED" } } }, edges: n.edges });
    }
    void init;
    return json({ operations: [] });
  };
  const withFetch = async (body: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => serve(String(url), init)) as typeof fetch;
    try {
      await body();
    } finally {
      globalThis.fetch = real;
    }
  };
  const run = (propsValue: Record<string, unknown>) => (verifyNotesAction as unknown as { run(c: unknown): Promise<Record<string, unknown>> }).run({ auth, propsValue });

  it("reports pass, check and duplicate per note; write retires the duplicate", async () => {
    await withFetch(async () => {
      const dry = await run({ drive: "d", source: "src", mode: "dry_run" });
      expect(String(dry.summary)).toMatch(/^Dry run: 1 note ready to approve, 1 to check, 1 duplicate would be retired\. The task waits at verify for your review\./);
      expect((dry.notes as { result: string }[]).map((n) => n.result)).toEqual(["pass", "check", "duplicate (would retire)"]);
      expect(dry.flagged_count).toBe(1);
      const wrote = await run({ drive: "d", source: "src", mode: "write" });
      expect(String(wrote.summary)).toMatch(/^1 note ready to approve, 1 to check, 1 duplicate retired\./);
      expect((wrote.notes as { result: string; duplicate_of?: string }[])[2]).toMatchObject({ result: "retired as duplicate", duplicate_of: "Old" });
    });
  });
  it("says so when a source has nothing to verify", async () => {
    await withFetch(async () => {
      claims = [];
      expect(String((await run({ drive: "d", source: "src", mode: "write" })).summary)).toMatch(/^"Tech" has no notes to verify\./);
      claims = ["n1", "n2", "n3"];
    });
  });

  it("words the other outcomes: nothing to retire, several to check, a retirement refused", async () => {
    await withFetch(async () => {
      answer = [{ id: "n1", verdict: "flag", problems: ["x"] }, { id: "n2", verdict: "flag", problems: ["y"] }, { id: "n3", verdict: "flag", problems: ["z"] }];
      const none = await run({ drive: "d", source: "src", mode: "write" });
      expect(String(none.summary)).toMatch(/^0 notes ready to approve, 3 to check, 0 duplicates retired\./);
      expect((none.stages as string[]).some((st) => st.startsWith("retire"))).toBe(false);
      const dryNone = await run({ drive: "d", source: "src", mode: "dry_run" });
      expect(String(dryNone.summary)).toMatch(/0 duplicates would be retired/);
      answer = [{ id: "n1", verdict: "pass" }, { id: "n2", verdict: "pass" }, { id: "n3", verdict: "pass", duplicate_of: "x1" }];
      rejectFails = true;
      const refused = await run({ drive: "d", source: "src", mode: "write" });
      expect((refused.notes as { result: string }[])[2].result).toBe("duplicate (not retired)");
      expect(refused.problems).toEqual(['"Claim n3 holds under load": Can only reject from IN_REVIEW status']);
      claims = ["n1"];
      answer = [{ id: "n1", verdict: "pass" }];
      rejectFails = false;
      expect(String((await run({ drive: "d", source: "src", mode: "dry_run" })).summary)).toMatch(/^Dry run: 1 note ready to approve, 0 to check, 0 duplicates would be retired\./);
      claims = ["n1", "n2", "n3"];
    });
  });
});
