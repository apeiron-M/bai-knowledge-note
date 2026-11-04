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
const searchVault = vi.fn();
const mapSimilarities = vi.fn();
vi.mock("./helpers/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getQuery: () => ({ changes, edgesTouching, changeMaps }),
  resolveCanonicalDriveId: (_: unknown, id: string) => Promise.resolve(id),
}));
const backfillDriveSourceHistory = vi.fn();
vi.mock("./helpers/source-history.js", () => ({
  backfillDriveSourceHistory: (...args: unknown[]) => backfillDriveSourceHistory(...args) as unknown,
}));
vi.mock("./helpers/search.js", async (importOriginal) => ({
  ...(await importOriginal<typeof SearchModule>()),
  searchVault: (...args: unknown[]) => searchVault(...args) as unknown,
  mapSimilarities: (...args: unknown[]) => mapSimilarities(...args) as unknown,
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
    searchVault.mockReset().mockResolvedValue([]);
    // No embedder in these tests: maps are matched by their words.
    mapSimilarities.mockReset().mockResolvedValue(null);
  });

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
    expect(searchVault).toHaveBeenCalledWith(s, "d", "processors", "SEMANTIC", 25, false);
    expect(changes.mock.calls[0][1]).toEqual({ q: "processors", documentIds: ["h1", "h2", "n9"] });
    expect(changes.mock.calls[0][2]).toEqual({ limit: 20, cursor, sourceFolders: new Map() });
    // No until given: the window ends where the cursor's did.
    expect(changes.mock.calls[0][0]).toEqual({ since: "2026-11-01T00:00:00.000Z", until: "2026-11-03T12:00:00.000Z" });
    // The digest echoes the question, not the ids it resolved to, and says what it covered.
    expect(out.scope).toEqual({ q: "processors", resolved: { kind: "search", query: "processors", hits: 2 } });
  });

  it("resolves a q that names a hub area or descendant map to that map's subtree, without searching", async () => {
    changeMaps.mockResolvedValue([
      { id: "a1", title: "Data Processing and CQRS", depth: 1 },
      { id: "m1", title: "Processors", depth: 2 },
    ]);
    const { subgraph: s } = subgraph();
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "data processing" }, {})) as ChangeDigest;
    expect(searchVault).not.toHaveBeenCalled();
    expect(changes.mock.calls[0][1]).toEqual({ q: "data processing", moc: "a1" });
    expect(out.scope).toEqual({ q: "data processing", resolved: { kind: "moc", id: "a1", title: "Data Processing and CQRS" } });
  });

  describe("a subject means the main areas about it (Addendum C1)", () => {
    const HUB = [
      { id: "hub", title: "Powerhouse Knowledge", depth: 0, area: null, text: "" },
      { id: "rd", title: "Reactor and Drives", depth: 1, area: "rd", text: "How the reactor of the Powerhouse stack stores documents and drives." },
      { id: "rs", title: "Reactor Sync Infrastructure", depth: 1, area: "rs", text: "How reactors of the Powerhouse stack synchronise drives." },
      { id: "dms", title: "Document Model System", depth: 1, area: "dms", text: "Document models in the Powerhouse stack." },
      { id: "lead", title: "Lead Corpus", depth: 1, area: "lead", text: "Prospects the Powerhouse team tracks." },
      { id: "att", title: "Attachments", depth: 2, area: "dms", text: "Files attached to documents." },
    ];

    it("scopes 'the reactor' to the areas about it, without searching", async () => {
      changeMaps.mockResolvedValue(HUB);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "the powerhouse reactor" }, {})) as ChangeDigest;
      expect(searchVault).not.toHaveBeenCalled();
      expect(changes.mock.calls[0][1]).toEqual({ q: "the powerhouse reactor", mocs: ["rd", "rs"] });
      expect(out.scope).toEqual({
        q: "the powerhouse reactor",
        resolved: { kind: "areas", areas: [{ id: "rd", title: "Reactor and Drives" }, { id: "rs", title: "Reactor Sync Infrastructure" }] },
      });
    });

    it("scopes a narrow subject to the one map below an area, as a moc", async () => {
      changeMaps.mockResolvedValue(HUB);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "attachments" }, {})) as ChangeDigest;
      expect(changes.mock.calls[0][1]).toEqual({ q: "attachments", moc: "att" });
      expect(out.scope.resolved).toEqual({ kind: "moc", id: "att", title: "Attachments" });
    });

    it("ranks by the maps' embeddings when the server can embed the query", async () => {
      changeMaps.mockResolvedValue(HUB);
      mapSimilarities.mockResolvedValue(new Map([["rd", 0.86], ["rs", 0.84], ["dms", 0.78], ["lead", 0.7], ["att", 0.77]]));
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "how documents are stored and synced" }, {});
      expect(mapSimilarities).toHaveBeenCalledWith(s, "d", "how documents are stored and synced", ["rd", "rs", "dms", "lead", "att"]);
      expect(changes.mock.calls[0][1]).toEqual({ q: "how documents are stored and synced", mocs: ["rd", "rs"] });
    });

    it("searches when no area clears the floor", async () => {
      changeMaps.mockResolvedValue(HUB);
      const { subgraph: s } = subgraph();
      const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "quantum chromodynamics" }, {})) as ChangeDigest;
      expect(searchVault).toHaveBeenCalled();
      expect(out.scope.resolved).toMatchObject({ kind: "search" });
    });

    it("narrows several areas to explicit documentIds", async () => {
      changeMaps.mockResolvedValue(HUB);
      const { subgraph: s } = subgraph();
      await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "reactor", documentIds: ["n1"] }, {});
      expect(changes.mock.calls[0][1]).toEqual({ q: "reactor", mocs: ["rd", "rs"], documentIds: ["n1"] });
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
    expect(changes.mock.calls[0][1]).toEqual({});
    expect(out.scope).toEqual({ q: "the Powerhouse stack", resolved: { kind: "vault", title: "Powerhouse Stack" } });
  });

  it("resolves a q that names the drive to the whole vault", async () => {
    changeMaps.mockResolvedValue([{ id: "a1", title: "Data Processing and CQRS", depth: 1 }]);
    const { subgraph: s } = subgraph();
    Object.assign(s, { readClient: { get: vi.fn(() => Promise.resolve({ header: { name: "Powerhouse Vault" }, state: { global: { name: "Powerhouse Vault", nodes: [] } } })) } });
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "powerhouse vault" }, {})) as ChangeDigest;
    expect(searchVault).not.toHaveBeenCalled();
    expect(changes.mock.calls[0][1]).toEqual({});
    expect(out.scope).toEqual({ q: "powerhouse vault", resolved: { kind: "vault", title: "Powerhouse Vault" } });
  });

  it("narrows a q-named map to explicit documentIds (the ids always narrow what q resolves to)", async () => {
    changeMaps.mockResolvedValue([{ id: "a1", title: "Data Processing and CQRS", depth: 1 }]);
    const { subgraph: s } = subgraph();
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "data processing", documentIds: ["n1", "n2"] }, {})) as ChangeDigest;
    expect(searchVault).not.toHaveBeenCalled();
    expect(changes.mock.calls[0][1]).toEqual({ q: "data processing", moc: "a1", documentIds: ["n1", "n2"] });
    expect(out.scope.resolved).toEqual({ kind: "moc", id: "a1", title: "Data Processing and CQRS" });
  });

  it("searches when an explicit moc is given with q (the map is already chosen)", async () => {
    changeMaps.mockResolvedValue([{ id: "m1", title: "Processors", depth: 2 }]);
    const { subgraph: s } = subgraph();
    await resolve(s)({}, { driveId: "d", since: "2026-09-01", q: "processors", moc: "a1" }, {});
    expect(searchVault).toHaveBeenCalled();
    expect(changes.mock.calls[0][1]).toMatchObject({ moc: "a1", q: "processors" });
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
