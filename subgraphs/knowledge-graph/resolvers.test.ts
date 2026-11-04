import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { assertOncePerRequest, getResolvers, PRIVILEGED_RESOLVERS } from "./resolvers.js";
import type { ChangeDigest } from "../../processors/graph-indexer/changes.js";

// The change digest reads the index through getQuery and resolves `q` through
// searchVault; both are replaced so the resolver's own wiring is what runs.
const changes = vi.fn();
const edgesTouching = vi.fn();
const searchVault = vi.fn();
vi.mock("./helpers/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./helpers/db.js")>()),
  getQuery: () => ({ changes, edgesTouching }),
  resolveCanonicalDriveId: (_: unknown, id: string) => Promise.resolve(id),
}));
vi.mock("./helpers/search.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./helpers/search.js")>()),
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
    searchVault.mockReset().mockResolvedValue([]);
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
      { limit: undefined, cursor: undefined },
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
    const out = (await resolve(s)({}, { driveId: "d", since: "2026-11-01", q: "processors", limit: 20, cursor: "c" }, {})) as ChangeDigest;
    expect(searchVault).toHaveBeenCalledWith(s, "d", "processors", "SEMANTIC", 10, false);
    expect(changes.mock.calls[0][1]).toEqual({ q: "processors", documentIds: ["h1", "h2", "n9"] });
    expect(changes.mock.calls[0][2]).toEqual({ limit: 20, cursor: "c" });
    // The digest echoes the question, not the ids it resolved to.
    expect(out.scope).toEqual({ q: "processors" });
  });

  it("reports a malformed date as a user error", async () => {
    const { subgraph: s } = subgraph();
    await expect(resolve(s)({}, { driveId: "d", since: "last summer" }, {})).rejects.toThrow(/not a date/);
  });
});
