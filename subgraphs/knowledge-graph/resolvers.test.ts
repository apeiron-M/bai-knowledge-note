import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { assertOncePerRequest, getResolvers, PRIVILEGED_RESOLVERS } from "./resolvers.js";
import type { ChangeDigest } from "../../processors/graph-indexer/changes.js";
import type * as DbModule from "./helpers/db.js";
import type * as SearchModule from "./helpers/search.js";

// The change digest reads the index through getQuery and resolves `q` through
// searchVault; both are replaced so the resolver's own wiring is what runs.
const changes = vi.fn();
const edgesTouching = vi.fn();
const changeMaps = vi.fn();
const changeMapNotes = vi.fn();
const changeSources = vi.fn();
const searchVault = vi.fn();
vi.mock("./helpers/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getQuery: () => ({ changes, edgesTouching, changeMaps, changeMapNotes, changeSources }),
  resolveCanonicalDriveId: (_: unknown, id: string) => Promise.resolve(id),
}));
const backfillDriveSourceHistory = vi.fn();
vi.mock("./helpers/source-history.js", () => ({
  backfillDriveSourceHistory: (...args: unknown[]) => backfillDriveSourceHistory(...args) as unknown,
}));
vi.mock("./helpers/search.js", async (importOriginal) => ({
  ...(await importOriginal<typeof SearchModule>()),
  searchVault: (...args: unknown[]) => searchVault(...args) as unknown,
}));

function subgraph(
  assertCanRead = vi.fn(async () => ({}) as never),
  assertCanWrite = vi.fn(async () => ({}) as never),
) {
  return {
    subgraph: { assertCanRead, assertCanWrite } as unknown as BaseSubgraph,
    assertCanRead,
    assertCanWrite,
  };
}

describe("assertOncePerRequest", () => {
  it("checks once for repeated aliases in one request", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    const ctx = {};
    await Promise.all([
      assertOncePerRequest(s, ctx, "drive", false),
      assertOncePerRequest(s, ctx, "drive", false),
      assertOncePerRequest(s, ctx, "drive", false),
    ]);
    expect(assertCanRead).toHaveBeenCalledTimes(1);
  });

  it("does NOT share a decision between requests", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    await assertOncePerRequest(s, {}, "drive", false);
    await assertOncePerRequest(s, {}, "drive", false);
    // Different ctx objects are different requests, and therefore possibly
    // different identities. A shared decision here would be a auth bypass.
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });

  it("still refuses an unauthorized drive, and refuses every alias", async () => {
    const denied = vi.fn(async () => {
      throw new Error("Forbidden");
    });
    const { subgraph: s } = subgraph(denied as never);
    const ctx = {};
    await expect(
      assertOncePerRequest(s, ctx, "drive", false),
    ).rejects.toThrow("Forbidden");
    // the memoized rejection must not turn into a pass for a later alias
    await expect(
      assertOncePerRequest(s, ctx, "drive", false),
    ).rejects.toThrow("Forbidden");
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("keeps read and write decisions separate", async () => {
    const { subgraph: s, assertCanRead, assertCanWrite } = subgraph();
    const ctx = {};
    await assertOncePerRequest(s, ctx, "drive", false);
    await assertOncePerRequest(s, ctx, "drive", true);
    // A read grant must never satisfy a privileged resolver.
    expect(assertCanRead).toHaveBeenCalledTimes(1);
    expect(assertCanWrite).toHaveBeenCalledTimes(1);
  });

  it("keeps decisions separate per drive", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    const ctx = {};
    await assertOncePerRequest(s, ctx, "drive-a", false);
    await assertOncePerRequest(s, ctx, "drive-b", false);
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });

  it("falls back to an unmemoized check when ctx is not an object", async () => {
    const { subgraph: s, assertCanRead } = subgraph();
    await assertOncePerRequest(s, undefined, "drive", false);
    await assertOncePerRequest(s, undefined, "drive", false);
    expect(assertCanRead).toHaveBeenCalledTimes(2);
  });
});

describe("PRIVILEGED_RESOLVERS", () => {
  it("pins exactly which resolvers demand write access", () => {
    // An authorization boundary, so it is pinned rather than described: adding
    // or dropping a name here changes who can call what, and that should be a
    // deliberate edit with a failing test in front of it.
    expect([...PRIVILEGED_RESOLVERS].sort()).toEqual([
      // writes the projection
      "knowledgeGraphReindex",
      "knowledgeGraphBackfillSourceHistory",
      // serve operation diffs and signer addresses — an audit log
      "knowledgeGraphActivity",
      "knowledgeGraphActivityByType",
      "knowledgeGraphHistory",
      // serves the raw projection tables
      "knowledgeGraphDebug",
      // curation tool: answers what structural work needs doing
      "knowledgeGraphBridges",
    ].sort());
  });

  it("does not gate ordinary discovery", () => {
    for (const name of [
      "knowledgeGraphSemanticSearch",
      "knowledgeGraphFullSearch",
      "knowledgeGraphNodes",
      "knowledgeGraphEdges",
      "knowledgeGraphStats",
      "knowledgeGraphOrphans",
      "knowledgeGraphTriangles",
      "knowledgeGraphConnections",
    ]) {
      expect(PRIVILEGED_RESOLVERS.has(name)).toBe(false);
    }
  });
});

describe("Query.knowledgeGraphChanges", () => {
  const digest: ChangeDigest = {
    window: { since: "2026-09-01T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" },
    scope: {},
    totals: { created: 1, revised: 0, superseded: 0, archived: 0, reverified: 0, sourcesRevised: 0, sourcesAdded: 0, documents: 1, operations: 3 },
    groups: [],
  };
  type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
  const resolve = (s: BaseSubgraph): Resolver =>
    (getResolvers(s) as { Query: Record<string, Resolver> }).Query.knowledgeGraphChanges;

  beforeEach(() => {
    changes.mockReset().mockResolvedValue(digest);
    edgesTouching.mockReset().mockResolvedValue([]);
    changeMaps.mockReset().mockResolvedValue([]);
    changeMapNotes.mockReset().mockResolvedValue(new Map());
    changeSources.mockReset().mockResolvedValue([]);
    searchVault.mockReset().mockResolvedValue([]);
  });
  const hitsOf = (ids: string[], documentType = "bai/knowledge-note") => ids.map((documentId) => ({ node: { documentId, documentType } }));
  const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  // The scope the digest was read with, without the query's hit order (Addendum D2: tested on its own).
  const internalScope = (call = 0) => {
    const { rank: _rank, ...rest } = changes.mock.calls[call][1] as Record<string, unknown>;
    return rest;
  };

  it("is not privileged: a reader gets the digest, with the window parsed in UTC", async () => {
    expect(PRIVILEGED_RESOLVERS.has("knowledgeGraphChanges")).toBe(false);
    const { subgraph: s, assertCanRead, assertCanWrite } = subgraph();
    const out = await resolve(s)({}, { driveId: "d", since: "2026-09-01", until: "2026-11-03" }, {});
    expect(assertCanRead).toHaveBeenCalledWith("d", {});
    expect(assertCanWrite).not.toHaveBeenCalled();
    expect(changes).toHaveBeenCalledWith(
      { since: "2026-09-01T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" },
      {},
      { limit: undefined, cursor: undefined, sourceFolders: new Map() },
    );
    expect(out).toMatchObject({ totals: { created: 1 } });
  });

  it("refuses a caller who cannot read the drive", async () => {
    const denied = vi.fn(async () => {
      throw new Error("Forbidden");
    });
    const { subgraph: s } = subgraph(denied as never);
    await expect(resolve(s)({}, { driveId: "d", since: "2026-09-01" }, {})).rejects.toThrow("Forbidden");
    expect(changes).not.toHaveBeenCalled();
  });

  it("resolves q to the top hits and their one-hop knowledge neighbours before reading changes", async () => {
    searchVault.mockResolvedValue([{ node: { documentId: "h1" } }, { node: { documentId: "h2" } }]);
    edgesTouching.mockResolvedValue([
      { sourceDocumentId: "h1", targetDocumentId: "n9", linkType: "BUILDS_ON" },
      { sourceDocumentId: "t1", targetDocumentId: "h2", linkType: "INVOLVES" },
    ]);
    const { subgraph: s } = subgraph();
    const cursor = btoa(JSON.stringify({ k: [5, 1, "2026-11-02T00:00:00.000Z", "x", "revised"], u: "2026-11-03T12:00:00.000Z" }));
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-11-01", q: "processors", limit: 20, cursor }, {})) as ChangeDigest;
    // One search: the top 200 note hits are counted per area; no area holds enough, so the first 25 are the scope.
    expect(searchVault).toHaveBeenCalledTimes(1);
    expect(searchVault).toHaveBeenCalledWith(s, "d", "processors", "SEMANTIC", 200, false);
    expect(internalScope()).toEqual({ q: "processors", documentIds: ["h1", "h2", "n9"] });
    expect(changes.mock.calls[0][2]).toEqual({ limit: 20, cursor, sourceFolders: new Map() });
    // No until given: the window ends where the cursor's did.
    expect(changes.mock.calls[0][0]).toEqual({ since: "2026-11-01T00:00:00.000Z", until: "2026-11-03T12:00:00.000Z" });
    // The digest echoes the question, not the ids it resolved to, and says what it covered.
    expect(out.scope).toEqual({ q: "processors", resolved: { kind: "search", query: "processors", hits: 2 } });
  });

  it("resolves a q whose note hits concentrate in one area to that area's subtree", async () => {
    changeMaps.mockResolvedValue([
      { id: "a1", title: "Data Processing and CQRS", depth: 1, area: "a1" },
      { id: "m1", title: "Processors", depth: 2, area: "a1" },
    ]);
    searchVault.mockResolvedValue(hitsOf(range("n", 10)));
    changeMapNotes.mockResolvedValue(new Map([["a1", new Set(range("n", 10))], ["m1", new Set(range("n", 5))]]));
    const { subgraph: s } = subgraph();
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "data processing" }, {})) as ChangeDigest;
    expect(changeMapNotes).toHaveBeenCalledWith(["a1", "m1"]);
    expect(internalScope()).toEqual({ q: "data processing", moc: "a1" });
    expect(out.scope).toEqual({ q: "data processing", resolved: { kind: "moc", id: "a1", title: "Data Processing and CQRS" } });
  });

  describe("a specific term means the areas its notes concentrate in (Addendum C1c)", () => {
    const HUB = [
      { id: "hub", title: "Powerhouse Knowledge", depth: 0, area: null },
      { id: "rd", title: "Reactor and Drives", depth: 1, area: "rd" },
      { id: "rs", title: "Reactor Sync Infrastructure", depth: 1, area: "rs" },
      { id: "dms", title: "Document Model System", depth: 1, area: "dms" },
      { id: "lead", title: "Lead Corpus", depth: 1, area: "lead" },
      { id: "att", title: "Attachments", depth: 2, area: "dms" },
    ];
    // 100 note hits: 50 in Reactor and Drives, 30 in Reactor Sync, 5 in the lead corpus.
    const REACTOR = new Map([
      ["rd", new Set(range("n", 50))],
      ["rs", new Set(range("n", 80).slice(50))],
      ["lead", new Set(range("n", 85).slice(80))],
    ]);
    /** The hits as search ranks them: both reactor areas near the top (Addendum E1), then the rest. */
    const REACTOR_RANKED = () => {
      const first = [...range("n", 18), ...range("n", 57).slice(50)];
      return hitsOf([...first, ...range("n", 100).filter((h) => !first.includes(h))]);
    };

    it("scopes 'the powerhouse reactor' to the areas holding 10% of its top 200 note hits", async () => {
      changeMaps.mockResolvedValue(HUB);
      searchVault.mockResolvedValue(REACTOR_RANKED());
      changeMapNotes.mockResolvedValue(REACTOR);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "the powerhouse reactor" }, {})) as ChangeDigest;
      expect(searchVault).toHaveBeenCalledWith(s, "d", "the powerhouse reactor", "SEMANTIC", 200, false);
      expect(internalScope()).toEqual({ q: "the powerhouse reactor", mocs: ["rd", "rs"] });
      expect(out.scope).toEqual({
        q: "the powerhouse reactor",
        resolved: { kind: "areas", areas: [{ id: "rd", title: "Reactor and Drives" }, { id: "rs", title: "Reactor Sync Infrastructure" }] },
      });
    });

    it("leaves out an area whose hits are all in the tail of the ranking, as search ranked them (Addendum E1)", async () => {
      changeMaps.mockResolvedValue(HUB);
      // The lead corpus holds 15 of 100 hits — over 10% — but none of the top 25.
      searchVault.mockResolvedValue(REACTOR_RANKED());
      changeMapNotes.mockResolvedValue(new Map([...REACTOR, ["lead", new Set(range("n", 100).slice(85))]]));
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "authorisation" }, {});
      expect(internalScope()).toEqual({ q: "authorisation", mocs: ["rd", "rs"] });
    });

    it("counts note hits only: maps and sources among the hits are left out", async () => {
      changeMaps.mockResolvedValue(HUB);
      // 40 map hits in the lead corpus would be 40% of all hits; they are not notes.
      searchVault.mockResolvedValue([...hitsOf(range("m", 40), "bai/moc"), ...hitsOf(range("n", 60))]);
      changeMapNotes.mockResolvedValue(new Map([["rd", new Set(range("n", 60))], ["lead", new Set(range("m", 40))]]));
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "reactor" }, {});
      expect(internalScope()).toEqual({ q: "reactor", moc: "rd" });
    });

    it("scopes a narrow subject to the one map below an area holding 60% of the hits, as a moc", async () => {
      changeMaps.mockResolvedValue(HUB);
      searchVault.mockResolvedValue(hitsOf(range("n", 20)));
      changeMapNotes.mockResolvedValue(new Map([["dms", new Set(range("n", 20))], ["att", new Set(range("n", 18))]]));
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "attachments" }, {})) as ChangeDigest;
      expect(internalScope()).toEqual({ q: "attachments", moc: "att" });
      expect(out.scope.resolved).toEqual({ kind: "moc", id: "att", title: "Attachments" });
    });

    it("falls back to the first 25 hits and their neighbours when no area holds 10%", async () => {
      changeMaps.mockResolvedValue(HUB);
      searchVault.mockResolvedValue(hitsOf(range("n", 40)));
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "quantum chromodynamics" }, {})) as ChangeDigest;
      expect(searchVault).toHaveBeenCalledTimes(1);
      expect(out.scope.resolved).toEqual({ kind: "search", query: "quantum chromodynamics", hits: 25 });
      expect((changes.mock.calls[0][1] as { documentIds: string[] }).documentIds).toHaveLength(25);
    });

    it("narrows several areas to explicit documentIds", async () => {
      changeMaps.mockResolvedValue(HUB);
      searchVault.mockResolvedValue(REACTOR_RANKED());
      changeMapNotes.mockResolvedValue(REACTOR);
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "reactor", documentIds: ["n1"] }, {});
      expect(internalScope()).toEqual({ q: "reactor", mocs: ["rd", "rs"], documentIds: ["n1"] });
    });
  });

  describe("areas chosen by the caller (Addendum C1a)", () => {
    const MAPS = [
      { id: "hub", title: "Powerhouse Knowledge", depth: 0, area: null },
      { id: "rd", title: "Reactor and Drives", depth: 1, area: "rd" },
      { id: "dep", title: "Deployment and Operations", depth: 1, area: "dep" },
      { id: "att", title: "Attachments", depth: 2, area: "rd" },
    ];

    it("scopes to the union of the named areas, by exact title (any case) or id, without searching", async () => {
      changeMaps.mockResolvedValue(MAPS);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["reactor and drives", "dep"] }, {})) as ChangeDigest;
      expect(searchVault).not.toHaveBeenCalled();
      expect(internalScope()).toEqual({ areas: ["reactor and drives", "dep"], mocs: ["rd", "dep"] });
      expect(out.scope).toEqual({
        areas: ["reactor and drives", "dep"],
        resolved: { kind: "areas", areas: [{ id: "rd", title: "Reactor and Drives" }, { id: "dep", title: "Deployment and Operations" }] },
      });
    });

    it("reports titles it does not know, never guessing a near one; the hub is no area", async () => {
      changeMaps.mockResolvedValue(MAPS);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["Reactor", "Powerhouse Knowledge", "Attachments"] }, {})) as ChangeDigest;
      expect(changes.mock.calls[0][1]).toMatchObject({ mocs: ["att"] });
      expect(out.scope.resolved).toEqual({ kind: "areas", areas: [{ id: "att", title: "Attachments" }], unknown: ["Reactor", "Powerhouse Knowledge"] });
    });

    it("scopes to nothing when no area is known", async () => {
      changeMaps.mockResolvedValue(MAPS);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["The stack"] }, {})) as ChangeDigest;
      expect(internalScope()).toEqual({ areas: ["The stack"], mocs: [] });
      expect(out.scope.resolved).toEqual({ kind: "areas", areas: [], unknown: ["The stack"] });
    });

    it("with q, searches within the areas and still reports the areas", async () => {
      changeMaps.mockResolvedValue(MAPS);
      searchVault.mockResolvedValue(hitsOf(["n1"]));
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["rd"], q: "snapshots" }, {})) as ChangeDigest;
      expect(searchVault).toHaveBeenCalledWith(s, "d", "snapshots", "SEMANTIC", 200, false);
      expect(internalScope()).toEqual({ areas: ["rd"], q: "snapshots", mocs: ["rd"], documentIds: ["n1"] });
      expect(out.scope.resolved).toEqual({ kind: "areas", areas: [{ id: "rd", title: "Reactor and Drives" }] });
    });
  });

  describe("scope by source (Addendum C1b)", () => {
    it("scopes to the sources matching the text and the notes derived from them", async () => {
      changeSources.mockResolvedValue(["s1", "s2"]);
      const { subgraph: s } = subgraph();
      Object.assign(s, {
        readClient: {
          get: vi.fn(() =>
            Promise.resolve({
              state: {
                global: {
                  name: "Vault",
                  nodes: [
                    { id: "f", kind: "folder", name: "sources" },
                    { id: "s1", kind: "file", documentType: "bai/source", parentFolder: "f" },
                  ],
                },
              },
            }),
          ),
        },
      });
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", source: "powerhouse-inc/powerhouse" }, {})) as ChangeDigest;
      expect(changeSources).toHaveBeenCalledWith("powerhouse-inc/powerhouse", new Map([["s1", "/sources"]]));
      expect(searchVault).not.toHaveBeenCalled();
      expect(internalScope()).toEqual({ source: "powerhouse-inc/powerhouse", sources: ["s1", "s2"] });
      expect(out.scope).toEqual({ source: "powerhouse-inc/powerhouse", resolved: { kind: "source", match: "powerhouse-inc/powerhouse", sources: 2 } });
    });
  });

  it("resolves a q that names the hub to the whole vault, server-side: no moc, no search, no q", async () => {
    changeMaps.mockResolvedValue([
      { id: "hub", title: "Powerhouse Stack", depth: 0 },
      { id: "a1", title: "Data Processing and CQRS", depth: 1 },
    ]);
    const { subgraph: s } = subgraph();
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "the Powerhouse stack" }, {})) as ChangeDigest;
    expect(searchVault).not.toHaveBeenCalled();
    expect(internalScope()).toEqual({});
    expect(out.scope).toEqual({ q: "the Powerhouse stack", resolved: { kind: "vault", title: "Powerhouse Stack" } });
  });

  it("resolves a q that names the drive to the whole vault", async () => {
    changeMaps.mockResolvedValue([{ id: "a1", title: "Data Processing and CQRS", depth: 1 }]);
    const { subgraph: s } = subgraph();
    Object.assign(s, { readClient: { get: vi.fn(() => Promise.resolve({ header: { name: "Powerhouse Vault" }, state: { global: { name: "Powerhouse Vault", nodes: [] } } })) } });
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "powerhouse vault" }, {})) as ChangeDigest;
    expect(searchVault).not.toHaveBeenCalled();
    expect(internalScope()).toEqual({});
    expect(out.scope).toEqual({ q: "powerhouse vault", resolved: { kind: "vault", title: "Powerhouse Vault" } });
  });

  it("narrows a q-resolved map to explicit documentIds (the ids always narrow what q resolves to)", async () => {
    changeMaps.mockResolvedValue([{ id: "a1", title: "Data Processing and CQRS", depth: 1 }]);
    searchVault.mockResolvedValue(hitsOf(range("n", 10)));
    changeMapNotes.mockResolvedValue(new Map([["a1", new Set(range("n", 10))]]));
    const { subgraph: s } = subgraph();
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "data processing", documentIds: ["n1", "n2"] }, {})) as ChangeDigest;
    expect(internalScope()).toEqual({ q: "data processing", moc: "a1", documentIds: ["n1", "n2"] });
    expect(out.scope.resolved).toEqual({ kind: "moc", id: "a1", title: "Data Processing and CQRS" });
  });

  it("searches when an explicit moc is given with q (the map is already chosen)", async () => {
    changeMaps.mockResolvedValue([{ id: "m1", title: "Processors", depth: 2 }]);
    const { subgraph: s } = subgraph();
    await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "processors", moc: "a1" }, {});
    expect(searchVault).toHaveBeenCalled();
    expect(changes.mock.calls[0][1]).toMatchObject({ moc: "a1", q: "processors" });
  });

  describe("relevance inside a question's scope (Addendum D2)", () => {
    it("hands the query's 200 hits, in rank order, to the digest with the areas they resolved to", async () => {
      changeMaps.mockResolvedValue([{ id: "a1", title: "Reactor and Drives", depth: 1, area: "a1" }]);
      searchVault.mockResolvedValue(hitsOf(["n3", "n1", "n2"]));
      changeMapNotes.mockResolvedValue(new Map([["a1", new Set(["n1", "n2", "n3"])]]));
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "reactor" }, {})) as ChangeDigest;
      expect(changes.mock.calls[0][1]).toEqual({ q: "reactor", moc: "a1", rank: ["n3", "n1", "n2"] });
      // Internal: never echoed.
      expect(out.scope).toEqual({ q: "reactor", resolved: { kind: "moc", id: "a1", title: "Reactor and Drives" } });
    });

    it("ranks a q inside chosen areas by its top 200 hits; the first 25 make the scope", async () => {
      changeMaps.mockResolvedValue([{ id: "rd", title: "Reactor and Drives", depth: 1, area: "rd" }]);
      searchVault.mockResolvedValue(hitsOf(range("n", 30)));
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["rd"], q: "snapshots" }, {});
      expect(searchVault).toHaveBeenCalledWith(s, "d", "snapshots", "SEMANTIC", 200, false);
      const internal = changes.mock.calls[0][1] as { documentIds?: string[]; rank?: string[] };
      expect(internal.documentIds).toEqual(range("n", 25).sort());
      expect(internal.rank).toEqual(range("n", 30));
    });

    it("gives no rank to a scope without a query", async () => {
      changeMaps.mockResolvedValue([{ id: "rd", title: "Reactor and Drives", depth: 1, area: "rd" }]);
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", areas: ["rd"] }, {});
      expect((changes.mock.calls[0][1] as { rank?: string[] }).rank).toBeUndefined();
    });
  });

  it("reports a malformed date as a user error", async () => {
    const { subgraph: s } = subgraph();
    await expect(resolve(s)({}, { driveId: "d", since: "last summer" }, {})).rejects.toThrow(/not a date/);
  });

  it("reports a cursor it did not issue as BAD_USER_INPUT", async () => {
    const { subgraph: s } = subgraph();
    await expect(resolve(s)({}, { driveId: "d", since: "2026-11-01", cursor: "c" }, {})).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("Mutation.knowledgeGraphBackfillSourceHistory", () => {
  type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
  const resolve = (s: BaseSubgraph): Resolver =>
    (getResolvers(s) as { Mutation: Record<string, Resolver> }).Mutation.knowledgeGraphBackfillSourceHistory;
  const managed = (canManage: boolean) => {
    const { subgraph: s, assertCanWrite } = subgraph();
    const check = vi.fn(async () => canManage);
    Object.assign(s, { authorizationService: { canManage: check }, resolveCanonicalDocumentId: async (id: string) => id });
    return { s, assertCanWrite, check };
  };
  const result = { sources: 2, documents: 0, inserted: 3, skipped: 0, errors: [] };

  beforeEach(() => {
    backfillDriveSourceHistory.mockReset().mockResolvedValue(result);
  });

  it("refuses a writer who does not manage the drive, as the REST route does", async () => {
    const { s, assertCanWrite, check } = managed(false);
    await expect(resolve(s)({}, { driveId: "d" }, { user: { address: "0xw" } })).rejects.toThrow(/requires ADMIN/);
    expect(assertCanWrite).toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith("d", "0xw");
    expect(backfillDriveSourceHistory).not.toHaveBeenCalled();
  });

  it("runs for a manager, over sources only unless all is asked for", async () => {
    const { s } = managed(true);
    expect(await resolve(s)({}, { driveId: "d" }, { user: { address: "0xm" } })).toEqual(result);
    expect(backfillDriveSourceHistory).toHaveBeenLastCalledWith(s, "d", { all: false });
    await resolve(s)({}, { driveId: "d", all: true }, { user: { address: "0xm" } });
    expect(backfillDriveSourceHistory).toHaveBeenLastCalledWith(s, "d", { all: true });
  });
});
