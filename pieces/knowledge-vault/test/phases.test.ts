import { describe, expect, it } from "vitest";
import { connectNotesAction } from "../lib/actions/connect-notes.js";
import { placeInMocsAction } from "../lib/actions/place-in-mocs.js";
import { checkLink, gatherCandidates, proposeLinksStage, sourceNotes, writeLinksStage } from "../lib/agent/connect.js";
import { LlmClient } from "../lib/agent/llm.js";
import { advancePipeline, claimPhase, findQueue } from "../lib/agent/pipeline.js";
import { llmFor, stageRunner } from "../lib/agent/runner.js";
import { checkPlan, planStage, readMocs, writePlacementsStage, type MocInfo } from "../lib/agent/synthesize.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";
import { KnowledgeVaultApiError } from "../lib/common/errors.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LLM = { baseUrl: "https://llm.test/v1", apiKey: "k" };
function modelSays(...answers: string[]) {
  let i = 0;
  const users: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    users.push((JSON.parse(init?.body as string) as { messages: { content: string }[] }).messages[1].content);
    return json({ choices: [{ message: { content: answers[Math.min(i++, answers.length - 1)] } }], usage: { cost: 0.001 } });
  }) as typeof fetch;
  return { llm: new LlmClient(LLM, fetchImpl), fetchImpl, users };
}
/** A fake vault: routes by path prefix (longest first), recording every request. */
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
const at = () => new Date("2026-09-28T12:00:00Z");

describe("the pipeline helper", () => {
  const drive = (queue = true) => ({ state: { global: { nodes: queue ? [{ id: "q1", documentType: "bai/pipeline-queue" }] : [] } } });
  const queue = (tasks: unknown[]) => ({ state: { global: { tasks } } });
  const task = (extra: Record<string, unknown>) => ({ id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "create", ...extra });
  const args = { drive: "d", sourceId: "s1", phase: "create" as const, workDone: "did it", filesModified: ["n1"], completedBy: "me", now: at };

  it("claims a pending task and advances it with a handoff", async () => {
    const v = vault({ "notes/d": drive(), "notes/q1": queue([task({ documentRef: "other" }), task({})]), "tasks/t1/claim": {}, actions: { operations: [] } });
    const out = await advancePipeline(v.client, args);
    expect(out).toEqual({ task_id: "t1", from: "create", to: "reflect", summary: "Pipeline task advanced create → reflect." });
    expect(v.requests.map((r) => r.path)).toEqual(["notes/d", "notes/q1", "tasks/t1/claim", "actions"]);
    const handoff = (v.requests[3].json as { actions: { input: { handoff: Record<string, unknown> } }[] }).actions[0].input.handoff;
    expect(handoff).toMatchObject({ phase: "create", workDone: "did it", filesModified: ["n1"], completedBy: "me", completedAt: "2026-09-28T12:00:00.000Z" });
  });
  it("does not claim a task already in progress, and leaves a task at another phase alone", async () => {
    const going = vault({ "notes/d": drive(), "notes/q1": queue([task({ status: "IN_PROGRESS", currentPhase: "reflect", assignedTo: "0xME" })]), ping: { ok: true, user: "0xme" }, actions: { operations: [] } });
    expect((await advancePipeline(going.client, { ...args, phase: "reflect" })).to).toBe("reweave");
    expect(going.requests.some((r) => r.path.includes("claim"))).toBe(false);
    const elsewhere = vault({ "notes/d": drive(), "notes/q1": queue([task({ currentPhase: "reflect" })]) });
    expect((await advancePipeline(elsewhere.client, args)).summary).toBe('The pipeline task is at "reflect", not "create"; left as it is.');
    const nullPhase = vault({ "notes/d": drive(), "notes/q1": queue([task({ currentPhase: null })]) });
    expect(await advancePipeline(nullPhase.client, args)).toMatchObject({ from: null });
  });
  it("says why nothing moved, and never throws", async () => {
    expect((await advancePipeline(vault({ "notes/d": drive(false) }).client, args)).summary).toMatch(/No pipeline queue/);
    expect((await advancePipeline(vault({ "notes/d": drive(), "notes/q1": queue([task({ status: "DONE" })]) }).client, args)).summary).toMatch(/no open pipeline task/);
    expect((await advancePipeline(vault({ "notes/d": drive(), "notes/q1": {} }).client, args)).summary).toMatch(/no open pipeline task/);
    const refused = vault({ "notes/d": drive(), "notes/q1": queue([task({})]), "tasks/t1/claim": {}, actions: { operations: [{ type: "ADVANCE_PHASE", error: "Phase mismatch" }] } });
    expect((await advancePipeline(refused.client, args)).summary).toBe("The pipeline task did not advance: Phase mismatch");
    expect((await advancePipeline(vault({}).client, args)).summary).toMatch(/could not be updated: no route/);
    expect(await findQueue(vault({ "notes/d": {} }).client, "d")).toBeNull();
    const theirs = vault({ "notes/d": drive(), "notes/q1": queue([task({ status: "IN_PROGRESS", assignedTo: "0xother" })]), ping: { ok: true, user: "0xme" } });
    expect((await advancePipeline(theirs.client, args)).summary).toBe("The pipeline task is held by 0xother, not this connection; left as it is.");
    expect(theirs.requests.some((r) => r.path === "actions")).toBe(false);
    const unowned = vault({ "notes/d": drive(), "notes/q1": queue([task({ status: "IN_PROGRESS" })]), ping: { ok: true, user: "0xme" } });
    expect((await advancePipeline(unowned.client, args)).summary).toMatch(/held by someone else/);
    const half = vault({ "notes/d": drive(), "notes/q1": queue([task({})]) });
    expect(await advancePipeline(half.client, { ...args, incomplete: "the source was not updated" })).toEqual({ task_id: "t1", from: "create", to: "create", summary: "The pipeline task stays at create: the source was not updated. Fix that and run the step again." });
    expect(half.requests.some((r) => r.path === "actions" || r.path.includes("claim"))).toBe(false);
    expect((await advancePipeline(vault({ "notes/d": drive(), "notes/q1": queue([task({})]), "tasks/t1/claim": {}, actions: { operations: [] } }).client, { ...args, now: undefined })).to).toBe("reflect");
  });
});

describe("claiming a phase before the work", () => {
  const drive = { state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } };
  const queue = (tasks: unknown[]) => ({ state: { global: { tasks } } });
  const task = (extra: Record<string, unknown>) => ({ id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "create", ...extra });
  const a = { drive: "d", sourceId: "s1", phase: "create" as const };
  it("claims a pending task, keeps its own, and stops on someone else's", async () => {
    const pending = vault({ "notes/d": drive, "notes/q1": queue([task({})]), ping: { user: "0xme" }, "tasks/t1/claim": {} });
    expect(await claimPhase(pending.client, a)).toEqual({ task_id: "t1", summary: "Claimed the pipeline task at create." });
    expect(pending.requests.map((r) => r.path)).toContain("tasks/t1/claim");
    const mine = vault({ "notes/d": drive, "notes/q1": queue([task({ status: "IN_PROGRESS", assignedTo: "0xME" })]), ping: { user: "0xme" } });
    expect((await claimPhase(mine.client, a)).summary).toMatch(/already held by this connection/);
    const theirs = vault({ "notes/d": drive, "notes/q1": queue([task({ status: "IN_PROGRESS", assignedTo: "0xother" })]), ping: { user: "0xme" } });
    await expect(claimPhase(theirs.client, a)).rejects.toThrow(/being worked by 0xother/);
    const nobody = vault({ "notes/d": drive, "notes/q1": queue([task({ status: "IN_PROGRESS" })]), ping: { user: "0xme" } });
    await expect(claimPhase(nobody.client, a)).rejects.toThrow(/being worked by someone else/);
  });
  it("leaves the step running when there is nothing to claim", async () => {
    expect((await claimPhase(vault({ "notes/d": { state: { global: { nodes: [] } } } }).client, a)).summary).toMatch(/No pipeline queue/);
    expect((await claimPhase(vault({ "notes/d": drive, "notes/q1": queue([]) }).client, a)).summary).toMatch(/no open pipeline task/);
    expect((await claimPhase(vault({ "notes/d": drive, "notes/q1": queue([task({ currentPhase: "reflect" })]) }).client, a)).summary).toMatch(/is at "reflect", not "create"/);
  });
});

describe("the stage runner", () => {
  it("times stages, pushes them live, and names a failing stage", async () => {
    const live: unknown[] = [];
    const { stage, finish } = stageRunner({ output: { update: async (o: unknown) => { live.push(o); } } });
    await stage("one", () => ({ summary: "did one" }));
    await expect(stage("two", () => { throw new KnowledgeVaultApiError("nope", { category: "validation" }); })).rejects.toMatchObject({ category: "validation", message: 'Stage "two" failed: nope (done before it: one: did one)' });
    const done = await finish();
    expect(done.stages).toEqual([expect.stringMatching(/^one · [\d.]+ s · did one$/) as unknown as string]);
    expect(live).toHaveLength(3);
    const quiet = stageRunner({ output: { update: async () => { throw new Error("no live"); } } });
    await expect(quiet.stage("x", () => { throw new Error("text"); })).rejects.toMatchObject({ category: "server", retryable: false, message: 'Stage "x" failed: text' });
  });
  it("gets the model from the step or the connection", () => {
    const auth = { props: { base_url: "https://v.test", token: "t", llm_api_key: "k", llm_default_model: "d/m" } };
    expect(llmFor({ auth }, "").model).toBe("d/m");
    expect(llmFor({ auth }, "x/y").model).toBe("x/y");
    expect(() => llmFor({ auth: { props: { base_url: "https://v.test", token: "t" } } }, "x")).toThrow(/no LLM API key/);
    expect(() => llmFor({ auth: { props: { base_url: "https://v.test", token: "t", llm_api_key: "k" } } }, "")).toThrow(/Choose a model/);
  });
});

const NOTES = [
  { id: "n1", title: "Capital is not the constraint", description: "d1", status: "DRAFT" },
  { id: "n2", title: "Legacy drags returns", description: "d2", status: "DRAFT" },
];

describe("connect", () => {
  it("reads the source's notes, skipping archived ones, and refuses a source with none", async () => {
    const v = vault({
      "notes/s1": { name: "s1", state: { global: { title: "Tech", extractedClaims: ["n1", { claimRef: "n2" }, "n3"] } } },
      "notes/n1": { state: { global: { title: "One", status: "DRAFT" } }, edges: [{ linkType: "DERIVED_FROM" }] },
      "notes/n2": { name: "n2", state: {} },
      "notes/n3": { state: { global: { status: "ARCHIVED" } } },
    });
    const out = await sourceNotes(v.client, "d", "s1");
    expect(out.sourceTitle).toBe("Tech");
    expect(out.notes.map((n) => [n.id, n.title])).toEqual([["n1", "One"], ["n2", "n2"]]);
    await expect(sourceNotes(vault({ "notes/s2": { name: "s2" } }).client, "d", "s2")).rejects.toThrow(/"s2" has no extracted notes/);
  });
  it("finds candidates among neighbours and siblings, without MoCs, archived notes or itself", async () => {
    const v = vault({
      "notes/n1/similar": [{ similarity: 0.91234, node: { documentId: "x1", title: "Near", description: "dx", status: "CANONICAL" } }, { node: { documentId: "m1", status: "MOC" } }, { node: { documentId: "n1" } }, { node: { documentId: "n2" } }, { node: { documentId: "a1", status: "ARCHIVED" } }, {}],
      "notes/n2/similar": () => { throw new Error("not indexed yet"); },
    });
    const c = await gatherCandidates(v.client, "d", NOTES);
    expect(c.n1.map((x) => [x.id, x.similarity])).toEqual([["n2", null], ["x1", 0.912]]);
    expect(c.n2.map((x) => x.id)).toEqual(["n1"]);
  });
  it("holds every link to the articulation test", () => {
    const allowed = new Map([["n1", new Set(["x1", "n2"])]]);
    const link = (extra: Record<string, unknown>) => ({ from: "n1", to: "x1", type: "BUILDS_ON", reason: "The capital note extends the payback note to technology budgets.", ...extra });
    expect(checkLink(link({}), allowed)).toBeNull();
    // Real words with a capital letter and a hyphen are not note labels.
    expect(checkLink(link({ reason: "The C-suite pressure note extends the E-commerce margin claim to technology budgets." }), allowed)).toBeNull();
    expect(checkLink(link({ reason: "C supplies what the budget note needs to hold, so the claims build together." }), allowed)).toMatch(/by a letter or id/);
    expect(checkLink(link({ from: "zz" }), allowed)).toMatch(/not one of the new notes/);
    expect(checkLink(link({ to: "zz" }), allowed)).toMatch(/not a candidate/);
    expect(checkLink(link({ type: "LIKES" }), allowed)).toMatch(/type must be/);
    expect(checkLink(link({ reason: "short" }), allowed)).toMatch(/too short/);
    expect(checkLink(link({ reason: "Relates to the other note." }), allowed)).toMatch(/names the link/);
    expect(checkLink(link({ reason: "C supplies what E identifies as the binding constraint." }), allowed)).toMatch(/letter or id/);
    expect(checkLink(link({ reason: "A connects to the other one because both are about money." }), allowed)).toMatch(/letter or id/);
    expect(checkLink(link({ reason: "It extends x1 to the budget question it leaves open." }), allowed)).toMatch(/letter or id/);
  });
  it("proposes links, drops the ones that fail, and flags thin notes", async () => {
    const reason = "The capital note extends the legacy note by naming what the drag costs.";
    const m = modelSays(JSON.stringify({ links: [
      { from: "n1", to: "n2", type: "BUILDS_ON", reason, confidence: "grounded" },
      { from: "n2", to: "n1", type: "RELATES_TO", reason, confidence: "grounded" },
      { from: "n1", to: "x1", type: "RELATES_TO", reason, confidence: "sure" },
      { from: "n1", to: "zz", type: "RELATES_TO", reason },
    ] }));
    const out = await proposeLinksStage(m.llm, "m", NOTES, { n1: [{ ...NOTES[1], similarity: null }, { id: "x1", title: "Near", description: "dx", status: null, similarity: 0.9 }], n2: [{ ...NOTES[0], similarity: null }] }, m.fetchImpl);
    expect(out.links.map((l) => [l.from, l.to, l.confidence])).toEqual([["n1", "n2", "grounded"], ["n1", "x1", "speculative"]]);
    expect(out.dropped.map((d) => d.why)).toEqual(["a link between these two is already proposed", 'to "zz" was not a candidate for n1']);
    expect(out.thin).toEqual(["Legacy drags returns"]);
    expect(out.summary).toBe("Proposed 2 links for 2 notes in 1 call (2 dropped by the articulation check); 1 note has fewer than 2.");
    expect(m.users[0]).toMatch(/NEW n1: Capital is not the constraint/);
    expect(m.users[0]).toMatch(/- x1 \(0\.9\): Near — dx/);
    const none = modelSays("{}");
    const empty = await proposeLinksStage(none.llm, "m", [NOTES[0]], {}, none.fetchImpl);
    expect(empty.summary).toBe("Proposed 0 links for 1 notes in 1 call; 1 note has fewer than 2.");
    const three = modelSays(JSON.stringify({ links: [{ from: "n1", to: "n2", type: "BUILDS_ON", reason }] }));
    expect((await proposeLinksStage(three.llm, "m", [...NOTES, { id: "n3", title: "T3", description: "", status: null }], { n1: [{ ...NOTES[1], similarity: null }] }, three.fetchImpl)).summary).toMatch(/Proposed 1 link for 3 notes in 1 call; 3 notes have fewer than 2\./);
  });
  it("splits the notes across parallel calls and removes duplicates between them", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `n${i + 1}`, title: `T${i + 1}`, description: "", status: null }));
    const cands = Object.fromEntries(seven.map((n) => [n.id, seven.filter((m) => m.id !== n.id).map((m) => ({ ...m, similarity: null }))]));
    const reason = "The first note extends the second by naming what the drag costs.";
    const m = modelSays(
      JSON.stringify({ links: [{ from: "n1", to: "n4", type: "BUILDS_ON", reason, confidence: "grounded" }] }),
      JSON.stringify({ links: [{ from: "n4", to: "n1", type: "RELATES_TO", reason, confidence: "grounded" }] }),
      JSON.stringify({ links: [] }),
    );
    const out = await proposeLinksStage(m.llm, "m", seven, cands, m.fetchImpl);
    expect(m.users).toHaveLength(3);
    expect(m.users[2]).toMatch(/NEW n7/);
    expect(out.links).toHaveLength(1);
    expect(out.dropped).toEqual([{ link: "n4 → n1", why: "a link between these two is already proposed" }]);
    expect(out.summary).toMatch(/^Proposed 1 link for 7 notes in 3 calls \(1 dropped/);
    expect(out.cost_usd).toBeCloseTo(0.003);
  });
  it("writes each link, and reports what the vault refused and what opens a tension", async () => {
    const v = vault({ relationships: (o: RequestOptions) => { if ((o.json as { target: string }).target === "bad") throw new Error("reason too short"); return {}; } });
    const out = await writeLinksStage(v.client, [
      { from: "n1", to: "n2", type: "CONTRADICTS", reason: "r", confidence: "grounded" },
      { from: "n1", to: "bad", type: "RELATES_TO", reason: "r", confidence: "grounded" },
    ]);
    expect(out.summary).toBe("Wrote 1 link, 1 refused by the vault; 1 CONTRADICTS link, each opens a tension.");
    expect(v.requests[0].json).toEqual({ source: "n1", target: "n2", type: "CONTRADICTS", reason: "r", confidence: "grounded" });
    expect((await writeLinksStage(vault({ relationships: {} }).client, [{ from: "a", to: "b", type: "RELATES_TO", reason: "r", confidence: "grounded" }, { from: "a", to: "c", type: "CONTRADICTS", reason: "r", confidence: "grounded" }, { from: "a", to: "d", type: "CONTRADICTS", reason: "r", confidence: "grounded" }])).summary).toBe("Wrote 3 links; 2 CONTRADICTS links, each opens a tension.");
  });
});

const MOCS: MocInfo[] = [
  { id: "hub", title: "Hub", description: "all", tier: "HUB", members: 0, samples: [], parent: null },
  { id: "dom", title: "Business", description: "money", tier: "DOMAIN", members: 3, samples: ["A sale"], parent: "hub" },
  { id: "top", title: "Pricing", description: "prices", tier: "TOPIC", members: 5, samples: [], parent: "dom" },
];
const NOTES3 = [...NOTES, { id: "n3", title: "Portfolios balance", description: "d3", status: "DRAFT" }];

describe("synthesize", () => {
  it("reads the MoC tree and the existing memberships", async () => {
    const v = vault({ "graph.json": {
      nodes: [{ documentId: "hub", noteType: "MOC (HUB)", status: "MOC" }, { documentId: "dom", title: "Business", noteType: "MOC (DOMAIN)", status: "MOC" }, { documentId: "top", title: "Pricing", status: "MOC" }, { documentId: "x1", title: "A sale" }],
      edges: [{ sourceDocumentId: "hub", targetDocumentId: "dom", linkType: "CHILD_MOC" }, { sourceDocumentId: "dom", targetDocumentId: "x1", linkType: "CORE_IDEA", targetTitle: null }, { sourceDocumentId: "dom", targetDocumentId: "zz", linkType: "CORE_IDEA" }],
    } });
    const { mocs, coreIdeas } = await readMocs(v.client, "d");
    expect(mocs.map((m) => [m.id, m.tier, m.members, m.parent])).toEqual([["hub", "HUB", 0, null], ["dom", "DOMAIN", 2, "hub"], ["top", "TOPIC", 0, null]]);
    expect(mocs[1].samples).toEqual(["A sale"]);
    expect(mocs[0].title).toBe("hub");
    expect(coreIdeas.has("dom>x1")).toBe(true);
  });
  it("checks a plan against the tree's rules", () => {
    const plan = checkPlan({
      placements: [{ note: "n1", moc: "top" }, { note: "n2", moc: "hub" }, { note: "n3", moc: "new:1" }, { note: "zz", moc: "top" }],
      new_mocs: [{ key: "new:1", title: "Tech", parent: "dom" }, { key: "bad", title: "No key" }, { key: "new:2", title: "Under a topic", parent: "top" }],
    }, NOTES3, MOCS);
    expect(plan.placements).toEqual([{ note: "n1", moc: "top" }, { note: "n3", moc: "new:1" }]);
    expect(plan.problems).toEqual([
      'new MoC "No key" needs a key like new:1 and a title',
      'new MoC "Under a topic" needs an existing DOMAIN or the HUB as parent, not "top"',
      'note n2: "hub" is not a TOPIC or DOMAIN MoC',
      'new MoC "Tech" would hold 1 note; a new TOPIC needs 3 or more, so place it in an existing MoC',
    ]);
    expect(plan.unplaced).toEqual(["n2"]);
    expect(checkPlan({ new_mocs: [{ key: "new:1", title: "Two", parent: "hub" }], placements: [{ note: "n1", moc: "new:1" }, { note: "n2", moc: "new:1" }] }, NOTES, MOCS).problems).toEqual(['new MoC "Two" would hold 2 notes; a new TOPIC needs 3 or more, so place them in an existing MoC']);
  });
  it("plans in up to two rounds, and never writes what still breaks the rules", async () => {
    const good = JSON.stringify({ placements: NOTES3.map((n) => ({ note: n.id, moc: "new:1" })), new_mocs: [{ key: "new:1", title: "Technology investment", description: "d", orientation: "o", parent: "dom" }] });
    const m = modelSays(JSON.stringify({ placements: [{ note: "n1", moc: "hub" }] }), good);
    const out = await planStage(m.llm, "m", NOTES3, MOCS, m.fetchImpl);
    expect(out.summary).toBe('Placed 3 of 3 notes in 1 MoC (new "Technology investment"), 1 of them new.');
    expect(m.users[1]).toMatch(/note n2 was not placed/);
    expect(m.users[0]).toMatch(/- dom \[DOMAIN, under hub\] Business \(3 notes\): money e\.g\. "A sale"/);
    const stubborn = modelSays(JSON.stringify({ placements: [{ note: "n1", moc: "new:1" }, { note: "n2", moc: "top" }], new_mocs: [{ key: "new:1", title: "Lonely", parent: "dom" }] }));
    const kept = await planStage(stubborn.llm, "m", NOTES, MOCS, stubborn.fetchImpl);
    expect(kept.placements).toEqual([{ note: "n2", moc: "top" }]);
    expect(kept.new_mocs).toEqual([]);
    expect(kept.summary).toBe('Placed 1 of 2 notes in 1 MoC ("Pricing"); 1 not placed.');
    const two = modelSays(JSON.stringify({ placements: [{ note: "n1", moc: "top" }, { note: "n2", moc: "dom" }] }));
    expect((await planStage(two.llm, "m", NOTES, MOCS, two.fetchImpl)).summary).toBe('Placed 2 of 2 notes in 2 MoCs ("Pricing", "Business").');
  });
  it("creates the new MoC under its parent, then adds the core ideas", async () => {
    const v = vault({ notes: { notes: [{ id: "moc-new", operations: [{ type: "CREATE_MOC", error: null }] }] }, relationships: (o: RequestOptions) => { if ((o.json as { target: string }).target === "n2") throw new Error("refused"); return {}; } });
    const out = await writePlacementsStage(v.client, {
      drive: "d",
      placements: [{ note: "n1", moc: "new:1" }, { note: "n2", moc: "top" }, { note: "n3", moc: "top" }, { note: "n1", moc: "new:9" }],
      newMocs: [{ key: "new:1", title: "Technology Investment & Value", description: "d", orientation: "o", parent: "dom" }],
      coreIdeas: new Set(["top>n3"]),
      now: at,
    });
    const create = v.requests[0].json as { documentType: string; notes: { name: string; actions: { input: Record<string, unknown> }[] }[] };
    expect(create.documentType).toBe("bai/moc");
    expect(create.notes[0].name).toBe("technology-investment-value");
    expect(create.notes[0].actions[0].input).toMatchObject({ tier: "TOPIC", parentRef: "dom", createdAt: "2026-09-28T12:00:00.000Z" });
    expect(v.requests[1].json).toEqual({ source: "dom", target: "moc-new", type: "CHILD_MOC" });
    expect(out).toMatchObject({ created_mocs: ["moc-new"], linked: 1, problems: ["CORE_IDEA top → n2: refused"] });
    expect(out.summary).toBe("Added 1 note to their MoCs (1 already there); created 1 TOPIC MoC, each attached to its parent; 1 problem.");
  });
  it("in a vault with no HUB yet, offers one to be created with the first MoC (else no MoC could ever be made)", async () => {
    const empty: MocInfo[] = [];
    const plan = checkPlan({ placements: NOTES3.map((n) => ({ note: n.id, moc: "new:1" })), new_mocs: [{ key: "new:1", title: "Euro markets", description: "d", orientation: "o", parent: "new:hub" }] }, NOTES3, empty);
    expect(plan.problems).toEqual([]);
    expect(plan.newMocs[0]).toMatchObject({ parent: "new:hub" });
    // With a HUB in place, the existing one is the parent, never a second.
    expect(checkPlan({ placements: NOTES3.map((n) => ({ note: n.id, moc: "new:1" })), new_mocs: [{ key: "new:1", title: "X", parent: "new:hub" }] }, NOTES3, MOCS).problems).toContain('new MoC "X" needs an existing DOMAIN or the HUB as parent, not "new:hub"');
    const m = modelSays(JSON.stringify({ placements: NOTES3.map((n) => ({ note: n.id, moc: "new:1" })), new_mocs: [{ key: "new:1", title: "Euro markets", description: "d", orientation: "o", parent: "new:hub" }] }));
    const out = await planStage(m.llm, "m", NOTES3, empty, m.fetchImpl);
    expect(m.users[0]).toMatch(/- new:hub \[HUB\] .*created with the first MoC/);
    expect(out.new_mocs).toHaveLength(1);
  });
  it("creates the HUB first when a new MoC hangs from it, then the MoC under it", async () => {
    let n = 0;
    const v = vault({ "notes/d": { name: "moc-check", state: { global: { name: "MoC check", nodes: [] } } }, notes: () => ({ notes: [{ id: ++n === 1 ? "hub-1" : "moc-1", operations: [{ type: "CREATE_MOC", error: null }] }] }), relationships: {} });
    const out = await writePlacementsStage(v.client, { drive: "d", placements: NOTES3.map((x) => ({ note: x.id, moc: "new:1" })), newMocs: [{ key: "new:1", title: "Euro markets", description: "d", orientation: "o", parent: "new:hub" }], coreIdeas: new Set(), now: at });
    expect(v.requests[0].path).toBe("notes/d");
    const hub = v.requests[1].json as { notes: { actions: { input: Record<string, unknown> }[] }[] };
    expect(hub.notes[0].actions[0].input).toMatchObject({ tier: "HUB", title: "MoC check" });
    const topic = v.requests[2].json as { notes: { actions: { input: Record<string, unknown> }[] }[] };
    expect(topic.notes[0].actions[0].input).toMatchObject({ tier: "TOPIC", parentRef: "hub-1" });
    expect(v.requests[3].json).toEqual({ source: "hub-1", target: "moc-1", type: "CHILD_MOC" });
    expect(out.created_mocs).toEqual(["hub-1", "moc-1"]);
    expect(out.linked).toBe(3);
    expect(out.summary).toBe("Added 3 notes to their MoCs; created the vault's HUB and 1 TOPIC MoC, each attached to its parent.");
  });
  it("names the HUB 'Hub' when the vault's name cannot be read", async () => {
    let n = 0;
    const v = vault({ "notes/d": () => { throw new Error("down"); }, notes: () => ({ notes: [{ id: ++n === 1 ? "hub-1" : "moc-1", operations: [{ type: "CREATE_MOC", error: null }] }] }), relationships: {} });
    await writePlacementsStage(v.client, { drive: "d", placements: NOTES3.map((x) => ({ note: x.id, moc: "new:1" })), newMocs: [{ key: "new:1", title: "T", description: "d", orientation: "o", parent: "new:hub" }], coreIdeas: new Set(), now: at });
    const hub = v.requests.find((r) => (r.json as { notes?: { actions: { input: { tier?: string } }[] }[] } | undefined)?.notes?.[0]?.actions[0]?.input.tier === "HUB")!.json as { notes: { actions: { input: Record<string, unknown> }[] }[] };
    expect(hub.notes[0].actions[0].input).toMatchObject({ title: "Hub" });
  });
  it("reports a MoC the vault rejected and a parent link that failed", async () => {
    const v = vault({ notes: { notes: [{ id: "m9", operations: [{ type: "CREATE_MOC", error: "tier invalid" }] }] }, relationships: () => { throw new Error("down"); } });
    const out = await writePlacementsStage(v.client, { drive: "d", placements: [{ note: "n1", moc: "new:1" }, { note: "n2", moc: "new:1" }], newMocs: [{ key: "new:1", title: "!!!", description: "", orientation: "", parent: "hub" }], coreIdeas: new Set() });
    expect(out.problems).toEqual(['MoC "!!!": tier invalid', 'attach "!!!" under its parent: down', "CORE_IDEA m9 → n1: down", "CORE_IDEA m9 → n2: down"]);
    expect((v.requests[0].json as { notes: { name: string }[] }).notes[0].name).toBe("moc");
    expect(out.summary).toBe("Added 0 notes to their MoCs; created 1 TOPIC MoC, each attached to its parent; 4 problems.");
    expect((await writePlacementsStage(vault({ relationships: {} }).client, { drive: "d", placements: [{ note: "n1", moc: "top" }, { note: "n2", moc: "top" }], newMocs: [], coreIdeas: new Set() })).summary).toBe("Added 2 notes to their MoCs.");
  });
});

describe("the connect and place actions", () => {
  const auth = { props: { base_url: "http://127.0.0.1:1", token: "t", llm_api_key: "k", llm_base_url: "https://llm.test/v1", llm_default_model: "m/default" } };
  const reason = "The capital note extends the legacy note by naming what the drag costs.";
  let variant = "normal";
  const answer = (body: string) => {
    if (body.includes("You link atomic notes")) {
      return JSON.stringify({ links: variant === "normal" ? [{ from: "n1", to: "n2", type: "BUILDS_ON", reason, confidence: "grounded" }] : [{ from: "n1", to: "x9", type: "RELATES_TO", reason, confidence: "grounded" }] });
    }
    if (variant === "normal") return JSON.stringify({ placements: [{ note: "n1", moc: "top" }, { note: "n2", moc: "top" }] });
    return JSON.stringify({ placements: [{ note: "n1", moc: "new:1" }, { note: "n2", moc: "new:1" }, { note: "n3", moc: "new:1" }], new_mocs: [{ key: "new:1", title: "Tech investment", description: "d", orientation: "o", parent: "hub" }] });
  };
  const serve = (u: string, init?: RequestInit) => {
    if (u.startsWith("https://llm.test")) return json({ choices: [{ message: { content: answer((init?.body as string | undefined) ?? "") } }], usage: { cost: 0.002 } });
    if (u.includes("/similar")) return json(variant === "normal" ? [] : [{ node: { documentId: "x9" }, similarity: 0.8 }]);
    if (u.includes("/graph.json")) return json({ nodes: [{ documentId: "top", title: "Pricing", status: "MOC" }, { documentId: "hub", noteType: "MOC (HUB)", status: "MOC" }], edges: [] });
    if (u.includes("/notes/s1")) return json({ name: "s1", state: { global: { title: "Tech", status: "EXTRACTED", extractedClaims: variant === "none" ? [] : variant === "one" ? ["n1"] : variant === "three" ? ["n1", "n2", "n3", "n4"] : ["n1", "n2"] } } });
    if (u.includes("/notes/d")) return json({ state: { global: { nodes: [{ id: "q1", documentType: "bai/pipeline-queue" }] } } });
    if (u.includes("/notes/q1")) return json({ state: { global: { tasks: [{ id: "t1", taskType: "claim", status: "IN_PROGRESS", assignedTo: "0xme", documentRef: "s1", currentPhase: u.includes("q1") ? phase : "create" }] } } });
    if (u.includes("/ping")) return json({ ok: true, user: "0xme" });
    if (u.match(/\/notes\/n\d/)) return json({ state: { global: { title: u.includes("n1") ? "Capital" : "Legacy", status: "DRAFT" } } });
    return json({ operations: [] });
  };
  let phase = "reflect";
  const withFetch = async (body: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => serve(String(url), init)) as typeof fetch;
    try {
      await body();
    } finally {
      globalThis.fetch = real;
    }
  };
  const run = (a: unknown, propsValue: Record<string, unknown>) => (a as { run(c: unknown): Promise<Record<string, unknown>> }).run({ auth, propsValue });

  it("connect: dry run proposes, write links and advances reflect", async () => {
    await withFetch(async () => {
      const dry = await run(connectNotesAction, { drive: "d", source: "s1", mode: "dry_run" });
      expect(String(dry.summary)).toMatch(/^Dry run: Proposed 1 link for 2 notes/);
      expect(dry.links).toEqual([expect.objectContaining({ from_title: "Capital", to_title: "Legacy" }) as unknown]);
      phase = "reflect";
      const wrote = await run(connectNotesAction, { drive: "d", source: "s1", mode: "write" });
      expect(String(wrote.summary)).toMatch(/^Wrote 1 link\. Pipeline task advanced reflect → reweave\. \d+ s, \$0\.0020\.$/);
    });
  });
  it("place: dry run plans, write links and advances reweave", async () => {
    await withFetch(async () => {
      const dry = await run(placeInMocsAction, { drive: "d", source: "s1", mode: "dry_run" });
      expect(String(dry.summary)).toMatch(/^Dry run: Placed 2 of 2 notes in 1 MoC \("Pricing"\)/);
      expect(dry.placements).toEqual([expect.objectContaining({ note: "Capital", moc: "Pricing" }), expect.objectContaining({ note: "Legacy", moc: "Pricing" })] as unknown[]);
      phase = "reweave";
      const wrote = await run(placeInMocsAction, { drive: "d", source: "s1", mode: "write" });
      expect(String(wrote.summary)).toMatch(/^Added 2 notes to their MoCs\. Pipeline task advanced reweave → verify\./);
    });
  });

  it("name new MoCs, unplaced notes and unknown link targets in the output", async () => {
    await withFetch(async () => {
      variant = "one";
      phase = "reflect";
      const one = await run(connectNotesAction, { drive: "d", source: "s1", mode: "write" });
      expect(one.stages).toEqual(expect.arrayContaining([expect.stringMatching(/"Tech" has 1 note to connect/) as unknown as string]));
      expect(one.links).toEqual([expect.objectContaining({ to: "x9", to_title: "" }) as unknown]);
      variant = "three";
      const dry = await run(placeInMocsAction, { drive: "d", source: "s1", mode: "dry_run" });
      expect(dry.placements).toEqual(expect.arrayContaining([expect.objectContaining({ moc: "new: Tech investment" }) as unknown]));
      expect(dry.new_mocs).toEqual([expect.objectContaining({ parent_title: "hub" }) as unknown]);
      expect(dry.unplaced).toEqual(["Legacy"]);
      variant = "normal";
    });
  });

  it("finish cleanly on a source that yielded no notes, and still move the task on", async () => {
    await withFetch(async () => {
      variant = "none";
      phase = "reflect";
      const c = await run(connectNotesAction, { drive: "d", source: "s1", mode: "write" });
      expect(String(c.summary)).toMatch(/^"Tech" yielded no notes; nothing to connect\. Pipeline task advanced reflect → reweave\./);
      expect(c.links).toEqual([]);
      phase = "reweave";
      const pl = await run(placeInMocsAction, { drive: "d", source: "s1", mode: "write" });
      expect(String(pl.summary)).toMatch(/^"Tech" yielded no notes; nothing to place\. Pipeline task advanced reweave → verify\./);
      const dryC = await run(connectNotesAction, { drive: "d", source: "s1", mode: "dry_run" });
      expect(String(dryC.summary)).toMatch(/^Dry run: "Tech" yielded no notes; nothing to connect\. \d+ s\.$/);
      const dryP = await run(placeInMocsAction, { drive: "d", source: "s1", mode: "dry_run" });
      expect(String(dryP.summary)).toMatch(/^Dry run: "Tech" yielded no notes; nothing to place\. \d+ s\.$/);
      variant = "normal";
    });
  });
});
