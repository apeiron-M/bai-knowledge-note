import { describe, expect, it } from "vitest";
import { CONNECT_SYSTEM } from "../../pieces/knowledge-vault/lib/agent/connect.js";
import { LlmClient } from "../../pieces/knowledge-vault/lib/agent/llm.js";
import { CANDIDATES_SYSTEM, DRAFT_SYSTEM, OVERLAP_SYSTEM } from "../../pieces/knowledge-vault/lib/agent/staged.js";
import { PLACE_SYSTEM } from "../../pieces/knowledge-vault/lib/agent/synthesize.js";
import type { KnowledgeVaultClient, RequestOptions } from "../../pieces/knowledge-vault/lib/common/client.js";
import { KnowledgeVaultApiError } from "../../pieces/knowledge-vault/lib/common/errors.js";
import type { PipelineAi } from "./ai.js";
import { mapTitleFor, runPhase, type PhaseContext } from "./phases.js";

// ── A vault: the in-page REST surface, as far as the pipeline's stages use it ──────────────

type Doc = { name: string; documentType: string; global: Record<string, unknown> };
type Rel = { source: string; target: string; type: string; reason: string | null };
type Action = { type: string; input: Record<string, unknown> };

function fakeVault() {
  const docs = new Map<string, Doc>();
  const rels: Rel[] = [];
  const requests: RequestOptions[] = [];
  const refuse = new Set<string>();
  /** Action types the vault refuses (an operation error), e.g. a source update. */
  const refuseActions = new Set<string>();
  /** What a search finds: the vault's other notes a claim may already be. */
  const hits: { node: Record<string, unknown>; similarity: number }[] = [];
  let made = 0;
  const edgesOf = (id: string) => [
    ...rels.filter((r) => r.source === id).map((r) => ({ direction: "out", documentId: r.target, linkType: r.type, reason: r.reason })),
    ...rels.filter((r) => r.target === id).map((r) => ({ direction: "in", documentId: r.source, linkType: r.type, reason: r.reason })),
  ];
  const apply = (doc: Doc, a: Action) => {
    const g = doc.global;
    const i = a.input;
    if (a.type === "SET_TITLE") g.title = i.title;
    else if (a.type === "SET_DESCRIPTION") g.description = i.description;
    else if (a.type === "SET_NOTE_TYPE") g.noteType = i.noteType;
    else if (a.type === "SET_CONTENT") g.content = i.content;
    else if (a.type === "ADD_TOPIC") g.topics = [...(Array.isArray(g.topics) ? (g.topics as unknown[]) : []), { id: i.id, name: i.name }];
    else if (a.type === "SET_PROVENANCE") g.provenance = i;
    else if (a.type === "SUBMIT_FOR_REVIEW") g.status = "IN_REVIEW";
    else if (a.type === "CREATE_MOC") Object.assign(g, { title: i.title, description: i.description, tier: i.tier });
    else if (a.type === "ADD_EXTRACTED_CLAIM") g.extractedClaims = [...new Set([...(Array.isArray(g.extractedClaims) ? (g.extractedClaims as string[]) : []), String(i.claimRef)])];
    else if (a.type === "RECORD_EXTRACTION_STATS") g.extractionStats = i;
    else if (a.type === "SET_SOURCE_STATUS") g.status = i.status;
  };
  const view = (id: string) => {
    const doc = docs.get(id);
    if (!doc) throw new KnowledgeVaultApiError(`No document ${id}`, { category: "not_found", status: 404 });
    return { id, name: doc.name, documentType: doc.documentType, state: { global: doc.global }, edges: edgesOf(id) };
  };
  const graph = () => ({
    nodes: [...docs].map(([id, d]) =>
      d.documentType === "bai/moc"
        ? { documentId: id, title: d.global.title, description: d.global.description ?? "", status: "MOC", noteType: `MOC (${String(d.global.tier)})` }
        : { documentId: id, title: d.global.title, description: d.global.description ?? "", status: d.global.status ?? null, noteType: d.global.noteType ?? null },
    ),
    edges: rels.map((r) => ({ sourceDocumentId: r.source, targetDocumentId: r.target, linkType: r.type, targetTitle: docs.get(r.target)?.global.title ?? null })),
  });
  const respond = (o: RequestOptions): unknown => {
    const method = o.method ?? "GET";
    const body = (o.json ?? {}) as Record<string, unknown>;
    if (method === "GET" && (o.path === "topics" || o.path.startsWith("topics/"))) return [];
    if (method === "GET" && o.path === "search") return { hits };
    if (method === "GET" && o.path === "graph.json") return graph();
    if (method === "GET" && /^notes\/[^/]+\/similar$/.test(o.path)) return [];
    if (method === "GET" && o.path.startsWith("notes/")) return view(decodeURIComponent(o.path.slice("notes/".length)));
    if (method === "POST" && o.path === "notes") {
      const type = typeof body.documentType === "string" ? body.documentType : "bai/knowledge-note";
      const created = (body.notes as { name: string; actions: Action[] }[]).map((n) => {
        const id = `${type === "bai/moc" ? "map" : "note"}-${++made}`;
        const doc: Doc = { name: n.name, documentType: type, global: {} };
        docs.set(id, doc);
        for (const a of n.actions) apply(doc, a);
        return { id, name: n.name, operations: n.actions.map((a) => ({ type: a.type, error: null })), readBack: "confirmed" };
      });
      return { notes: created };
    }
    if (method === "POST" && o.path === "relationships") {
      const r = { source: String(body.source), target: String(body.target), type: String(body.type), reason: typeof body.reason === "string" ? body.reason : null };
      if (refuse.has(r.type)) throw new KnowledgeVaultApiError(`The vault refused a ${r.type} link`, { category: "validation", status: 400 });
      if (!rels.some((x) => x.source === r.source && x.target === r.target && x.type === r.type)) rels.push(r);
      return { ok: true };
    }
    if (method === "POST" && o.path === "actions") {
      const doc = docs.get(String(body.documentId));
      const actions = body.actions as Action[];
      const error = (a: Action) => (!doc ? "no such document" : refuseActions.has(a.type) ? `${a.type} refused` : null);
      for (const a of actions) if (doc && !error(a)) apply(doc, a);
      return { operations: actions.map((a) => ({ type: a.type, error: error(a) })) };
    }
    if (method === "POST" && o.path === "hub") {
      const hub = [...docs].find(([, d]) => d.documentType === "bai/moc" && d.global.tier === "HUB");
      if (hub) return { id: hub[0], created: false };
      docs.set("hub", { name: "hub", documentType: "bai/moc", global: { title: "Hub", tier: "HUB" } });
      return { id: "hub", created: true };
    }
    throw new Error(`no route ${method} ${o.path}`);
  };
  const client = {
    request: (o: RequestOptions) => {
      requests.push(o);
      try {
        return Promise.resolve(respond(o));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  } as unknown as KnowledgeVaultClient;
  return {
    client,
    requests,
    rels,
    refuse,
    refuseActions,
    hits,
    docs,
    writes: () => requests.filter((r) => (r.method ?? "GET") !== "GET"),
    source(id: string, global: Record<string, unknown>) {
      docs.set(id, { name: id, documentType: "bai/source", global: { sourceType: "ARTICLE", status: "EXTRACTING", ...global } });
    },
    map(id: string, title: string, tier: "HUB" | "TOPIC", members: string[] = [], parent?: string) {
      docs.set(id, { name: id, documentType: "bai/moc", global: { title, description: `About ${title}`, tier } });
      for (const m of members) rels.push({ source: id, target: m, type: "CORE_IDEA", reason: null });
      if (parent) rels.push({ source: parent, target: id, type: "CHILD_MOC", reason: null });
    },
    note(id: string, title: string) {
      docs.set(id, { name: id, documentType: "bai/knowledge-note", global: { title, description: "A guide note", status: "IN_REVIEW", noteType: "CONCEPT" } });
    },
    notesFrom: (sourceId: string) => rels.filter((r) => r.type === "DERIVED_FROM" && r.target === sourceId).map((r) => r.source),
  };
}

// ── An AI: answers each stage's prompt the way a capable model would ─────────────────────────

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const opens = (system: string, prompt: string) => system.slice(0, 40) === prompt.slice(0, 40);

const CLAIMS = [
  "A cache removes repeated network lookups for the same key",
  "A cache without expiry returns stale data once its source changes",
  "Invalidating entries on write keeps a cache correct while reads stay fast",
];
const TEXT = [
  "Teams that put a cache in front of their service stop asking the network for the same key twice.",
  "When nothing ever expires, the cache keeps answering with what the service said last week.",
  "Dropping an entry whenever its key is written keeps answers right, and reads never wait for it.",
].join("\n\n");
const LINK_REASON = "The stale-data problem is exactly what dropping entries on write is there to prevent.";

type Script = {
  candidates?: (user: string) => unknown;
  draft?: (ids: string[]) => unknown;
  /** The links for the source's notes, by their ids in the prompt. */
  connect?: (ids: string[]) => unknown;
  place?: (notes: string[]) => unknown;
};

function fakeAi(script: Script = {}, opts: { local?: boolean } = {}) {
  const asked: Record<string, number> = {};
  let calls = 0;
  const answer = (system: string, user: string): unknown => {
    if (opens(system, CANDIDATES_SYSTEM)) {
      return script.candidates?.(user) ?? { source_kind: "knowledge", non_claims: 0, skipped: [], kept: CLAIMS.map((claim, i) => ({ claim, locus: `paragraph ${i + 1}`, evidence: "e", disagreement: "someone would argue otherwise" })) };
    }
    if (opens(system, DRAFT_SYSTEM)) {
      const ids = [...user.matchAll(/^- (c\d+): /gm)].map((m) => m[1]);
      if (script.draft) return script.draft(ids);
      return {
        notes: ids.map((id, i) => ({
          candidate_id: id,
          title: CLAIMS[i] ?? `Claim ${id} holds`,
          description: `Why ${id} holds, and what changes when it does not`,
          note_type: "concept",
          content: "The mechanism, the evidence and the conditions under which the claim holds, in enough words to stand alone.",
          topics: ["caching"],
          confidence: "grounded",
          locus: `paragraph ${i + 1}`,
        })),
        existing: [],
      };
    }
    if (opens(system, OVERLAP_SYSTEM)) return { same: [] };
    if (opens(system, CONNECT_SYSTEM)) {
      const ids = [...user.matchAll(/NEW (\S+): /g)].map((m) => m[1]);
      if (script.connect) return script.connect(ids);
      return { links: ids.length > 1 ? [{ from: ids[1], to: ids[0], type: "BUILDS_ON", reason: LINK_REASON, confidence: "grounded" }] : [] };
    }
    if (opens(system, PLACE_SYSTEM)) {
      const notes = [...user.slice(user.indexOf("Notes to place:")).matchAll(/^- (\S+): /gm)].map((m) => m[1]);
      if (script.place) return script.place(notes);
      const hub = /^- (\S+) \[HUB\]/m.exec(user)?.[1] ?? "new:hub";
      return {
        placements: notes.map((note) => ({ note, moc: "new:1" })),
        new_mocs: [{ key: "new:1", title: "Caching", description: "How caches stay fast and right", orientation: "Start with expiry.", parent: hub }],
      };
    }
    throw new Error(`unexpected prompt: ${system.slice(0, 60)}`);
  };
  const fetchImpl = ((_url: string, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { messages: { content: string }[] };
    const [system, user] = [body.messages[0].content, body.messages[1].content];
    const kind = [["candidates", CANDIDATES_SYSTEM], ["draft", DRAFT_SYSTEM], ["overlap", OVERLAP_SYSTEM], ["connect", CONNECT_SYSTEM], ["place", PLACE_SYSTEM]].find(([, s]) => opens(system, s))?.[0] ?? "other";
    asked[kind] = (asked[kind] ?? 0) + 1;
    return Promise.resolve(json({ choices: [{ message: { content: JSON.stringify(answer(system, user)) } }], usage: { cost: 0 } }));
  }) as typeof fetch;
  const ai: PipelineAi = {
    llm: new LlmClient({ baseUrl: "https://ai.test/v1", apiKey: "k", defaultModel: "test-model" }, fetchImpl),
    model: "test-model",
    local: opts.local ?? false,
    label: "Test AI",
    fetchImpl,
    calls: () => calls,
    reach: () => Promise.resolve(),
  };
  return { ai, asked, calls: () => calls };
}

function setUp(content = TEXT) {
  const v = fakeVault();
  v.source("s1", { title: "Caching notes", content });
  v.map("hub-1", "Knowledge Vault", "HUB");
  v.note("g1", "Notes cite the sources they came from");
  v.map("m-guide", "How Knowledge Vault works", "TOPIC", ["g1"], "hub-1");
  return v;
}
const ctxFor = (v: ReturnType<typeof fakeVault>, ai: PipelineAi, extra: Partial<PhaseContext> = {}): PhaseContext => ({ client: v.client, drive: "d1", sourceId: "s1", ai, mapTitle: "caching-notes.md", ...extra });

describe("the browser pipeline's phases", () => {
  it("turn a source into notes, links, a map of their own and a check, phase by phase", async () => {
    const v = setUp();
    const { ai, asked, calls } = fakeAi();
    const ctx = ctxFor(v, ai);

    const created = await runPhase("create", ctx);
    const notes = v.notesFrom("s1");
    expect(notes).toHaveLength(3);
    expect(notes.map((id) => v.docs.get(id)?.global.title)).toEqual(CLAIMS);
    expect(v.docs.get("s1")?.global).toMatchObject({ status: "EXTRACTED", extractedClaims: notes });
    expect(created).toEqual({ workDone: "Extracted 3 notes.", filesModified: notes });

    const reflected = await runPhase("reflect", ctx);
    const links = v.rels.filter((r) => ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES"].includes(r.type));
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].reason).toBe(LINK_REASON);
    expect(reflected).toEqual({ workDone: "Connected 3 notes with 1 link, each with its reason.", filesModified: notes });

    const rewoven = await runPhase("reweave", ctx);
    const map = [...v.docs].find(([, d]) => d.documentType === "bai/moc" && d.global.title === "caching-notes.md");
    expect(map).toBeDefined();
    const mapId = map?.[0] ?? "";
    expect(v.rels.filter((r) => r.type === "CORE_IDEA" && r.source === mapId).map((r) => r.target)).toEqual(notes);
    expect(v.rels.some((r) => r.type === "CHILD_MOC" && r.source === "hub-1" && r.target === mapId)).toBe(true);
    expect(rewoven).toEqual({ workDone: 'Placed 3 of 3 notes in maps (new map: "caching-notes.md").', filesModified: [...notes, mapId] });

    const before = calls();
    const verified = await runPhase("verify", ctx);
    expect(calls()).toBe(before);
    expect(verified.workDone).toMatch(/^Checked 3 notes/);
    expect(verified.filesModified).toEqual(notes);
    expect(asked).toEqual({ candidates: 1, draft: 1, overlap: 1, connect: 1, place: 1 });
  });

  it("call beforeWrites once, before the phase's first write", async () => {
    const v = setUp();
    const { ai } = fakeAi();
    for (const phase of ["create", "reflect", "reweave"] as const) {
      const writesBefore = v.writes().length;
      const seen: number[] = [];
      await runPhase(phase, ctxFor(v, ai, { beforeWrites: () => void seen.push(v.writes().length) }));
      expect(seen).toEqual([writesBefore]);
      expect(v.writes().length).toBeGreaterThan(writesBefore);
    }
  });

  it("write nothing when beforeWrites refuses (the runner stopped)", async () => {
    const v = setUp();
    const { ai } = fakeAi();
    const stopped = () => {
      throw new Error("stopped");
    };
    await expect(runPhase("create", ctxFor(v, ai, { beforeWrites: stopped }))).rejects.toThrow("stopped");
    expect(v.writes()).toEqual([]);
  });

  it("archive a source with no knowledge in it, and pass the later phases through without the AI", async () => {
    const v = setUp("Thanks for reading.");
    const { ai, calls } = fakeAi({ candidates: () => ({ source_kind: "not_knowledge", source_kind_reason: "a sign-off", kept: [], skipped: [], non_claims: 1 }) });
    const ctx = ctxFor(v, ai);
    expect((await runPhase("create", ctx)).workDone).toBe("Found no knowledge in it, so it is archived.");
    expect(v.docs.get("s1")?.global.status).toBe("ARCHIVED");
    const asked = calls();
    expect(await runPhase("reflect", ctx)).toEqual({ workDone: "No notes to connect.", filesModified: [] });
    expect(await runPhase("reweave", ctx)).toEqual({ workDone: "No notes to place.", filesModified: [] });
    expect(await runPhase("verify", ctx)).toEqual({ workDone: "No notes to check.", filesModified: [] });
    // Run again ("Process again"): it was read, and nothing in it is read twice.
    expect(await runPhase("create", ctx)).toEqual({ workDone: "Already read: nothing in it to extract.", filesModified: [] });
    expect(calls()).toBe(asked);
  });

  it("link a claim the vault already holds to the source, instead of writing it twice", async () => {
    const v = setUp();
    v.hits.push({ node: { documentId: "g1", title: "Notes cite the sources they came from", status: "IN_REVIEW" }, similarity: 0.92 });
    const draft = (ids: string[]) => ({
      notes: ids.slice(0, 2).map((id, i) => ({ candidate_id: id, title: CLAIMS[i], description: `Why ${id} holds`, note_type: "concept", content: "x".repeat(90), topics: ["caching"], confidence: "grounded", locus: "p" })),
      existing: [{ candidate_id: ids[2], note_id: "g1", title: "Notes cite the sources they came from", reason: "The same claim, in other words." }],
    });
    const { ai } = fakeAi({ draft });
    const created = await runPhase("create", ctxFor(v, ai));
    expect(created.workDone).toBe("Extracted 2 notes, and linked 1 note already in the vault.");
    expect(created.filesModified).toContain("g1");
    expect(v.rels.some((r) => r.source === "g1" && r.target === "s1" && r.type === "DERIVED_FROM")).toBe(true);
  });

  it("say when the source itself was not updated", async () => {
    const v = setUp();
    v.refuseActions.add("SET_SOURCE_STATUS");
    const { ai } = fakeAi();
    const created = await runPhase("create", ctxFor(v, ai));
    expect(created).toMatchObject({ workDone: "Extracted 3 notes.", incomplete: "the source was not updated" });
  });

  it("say so when the AI finds nothing to link", async () => {
    const v = setUp();
    const { ai } = fakeAi({ connect: () => ({ links: [] }) });
    await runPhase("create", ctxFor(v, ai));
    expect(await runPhase("reflect", ctxFor(v, ai))).toEqual({ workDone: "Found no links to make for 3 notes.", filesModified: v.notesFrom("s1") });
  });

  it("place notes in a map that fits without opening one, and say which placements did not land", async () => {
    const v = setUp();
    const { ai } = fakeAi({ place: (notes) => ({ placements: notes.map((note) => ({ note, moc: "m-guide" })), new_mocs: [] }) });
    await runPhase("create", ctxFor(v, ai));
    const placed = await runPhase("reweave", ctxFor(v, ai));
    expect(placed).toEqual({ workDone: "Placed 3 of 3 notes in maps.", filesModified: v.notesFrom("s1") });
    expect(v.docs.size).toBe(7);

    const refused = setUp();
    refused.refuse.add("CORE_IDEA");
    await runPhase("create", ctxFor(refused, ai));
    expect((await runPhase("reweave", ctxFor(refused, ai))).incomplete).toBe("3 placements did not land");
  });

  it("check each note, saying which need a look, or that all pass", async () => {
    // A cycle gives each note two links, one of them incoming: everything the check asks.
    const cycle = (ids: string[]) => ({ links: ids.map((id, i) => ({ from: id, to: ids[(i + 1) % ids.length], type: "RELATES_TO", reason: LINK_REASON, confidence: "grounded" })) });
    const v = setUp();
    const { ai } = fakeAi({ connect: cycle });
    for (const phase of ["create", "reflect", "reweave"] as const) await runPhase(phase, ctxFor(v, ai));
    expect((await runPhase("verify", ctxFor(v, ai))).workDone).toBe("Checked 3 notes: all pass.");

    // The first note links out twice, and nothing links to it: an orphan.
    const oneOff = (ids: string[]) => ({
      links: [
        { from: ids[0], to: ids[1], type: "RELATES_TO", reason: LINK_REASON, confidence: "grounded" },
        { from: ids[0], to: ids[2], type: "BUILDS_ON", reason: LINK_REASON, confidence: "grounded" },
        { from: ids[2], to: ids[1], type: "RELATES_TO", reason: LINK_REASON, confidence: "grounded" },
      ],
    });
    const w = setUp();
    const second = fakeAi({ connect: oneOff });
    for (const phase of ["create", "reflect", "reweave"] as const) await runPhase(phase, ctxFor(w, second.ai));
    expect((await runPhase("verify", ctxFor(w, second.ai))).workDone).toBe("Checked 3 notes: 1 needs a look — no other note links to it (orphan).");
  });

  it("read only the first window of a long source, and say so", async () => {
    const paragraph = (i: number) => `Paragraph ${i} argues one point about caches at length so the text runs long. ${"More words about it. ".repeat(20)}`.trim();
    const long = Array.from({ length: 200 }, (_, i) => paragraph(i + 1)).join("\n\n").slice(0, 60_000);
    for (const local of [false, true]) {
      const v = setUp(long);
      const { ai, asked } = fakeAi({}, { local });
      const created = await runPhase("create", ctxFor(v, ai));
      expect(asked.candidates).toBe(1);
      const match = /^Extracted 3 notes \(read the first ([\d,]+) of 60,000 characters\)\.$/.exec(created.workDone);
      expect(match).not.toBeNull();
      const read = Number(match?.[1].replace(/,/g, ""));
      expect(read).toBeLessThanOrEqual(local ? 8_000 : 24_000);
      expect(read).toBeGreaterThan(local ? 6_000 : 20_000);
    }
  });

  it("extract nothing twice: a source that already has notes passes create through", async () => {
    const v = setUp();
    const { ai, calls } = fakeAi();
    await runPhase("create", ctxFor(v, ai));
    const asked = calls();
    const writes = v.writes().length;
    expect(await runPhase("create", ctxFor(v, ai))).toEqual({ workDone: "Already extracted: 3 notes.", filesModified: [] });
    expect(calls()).toBe(asked);
    expect(v.writes().length).toBe(writes);
  });

  it("say what did not land, beside what did", async () => {
    const v = setUp();
    const { ai } = fakeAi();
    await runPhase("create", ctxFor(v, ai));
    v.refuse.add("BUILDS_ON");
    const reflected = await runPhase("reflect", ctxFor(v, ai));
    expect(reflected.workDone).toBe("Connected none of 3 notes.");
    expect(reflected.incomplete).toBe("1 link did not land");
  });
});

describe("the map a source's notes go into", () => {
  const nodes = [
    { id: "sources", kind: "folder", name: "sources", parentFolder: null },
    { id: "file", kind: "folder", name: "Quarterly report.pdf", parentFolder: "sources" },
    { id: "s1", kind: "file", name: "s1", parentFolder: "file" },
    { id: "s2", kind: "file", name: "s2", parentFolder: "sources" },
  ];
  it("is named after the file its sections came from", () => {
    expect(mapTitleFor(nodes, "s1", "Revenue")).toBe("Quarterly report.pdf");
  });
  it("is named after the source when it was pasted, or is not in the tree", () => {
    expect(mapTitleFor(nodes, "s2", "My paste")).toBe("My paste");
    expect(mapTitleFor(nodes, "nowhere", "My paste")).toBe("My paste");
  });
});
