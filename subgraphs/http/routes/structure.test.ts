import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import { createStructureRoute, type StructureRouteDeps } from "./structure.js";

function ctxFor(params: Record<string, string> = {}): RouteContext {
  return {
    user: {
      address: "0xabc",
      chainId: 1,
      networkId: "eip155",
      appKey: "did:key:z",
    },
    params,
    authEnabled: true,
    transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
  } as unknown as RouteContext;
}

function queryStub() {
  return {
    stats: vi.fn(async () => ({ nodeCount: 2 })),
    density: vi.fn(async () => 0.5),
    topicStats: vi.fn(async () => [{ name: "reactor", noteCount: 3 }]),
    nodesByTopic: vi.fn(async () => [{ documentId: "n1" }]),
    orphanNodes: vi.fn(async () => []),
    triangles: vi.fn(async () => []),
    allNodes: vi.fn(async () => [{ documentId: "n1" }]),
    allEdges: vi.fn(async () => []),
    documentIdsWithoutEmbeddings: vi.fn(async () => []),
    forwardLinks: vi.fn(async () => []),
    backlinks: vi.fn(async () => []),
    connections: vi.fn(async () => []),
    activity: vi.fn(async () => []),
    history: vi.fn(async () => []),
    bridges: vi.fn(async () => []),
  };
}

function deps(overrides: Partial<StructureRouteDeps> = {}): StructureRouteDeps {
  const query = queryStub();
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(async () => "drive") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      canManage: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    getQuery: () => query as never,
    similar: vi.fn(async () => [{ documentId: "n2", similarity: 0.9 }]),
    reindex: vi.fn(async () => ({
      indexedNodes: 2,
      indexedEdges: 3,
      errors: [],
    })),
    accessMap: vi.fn(async () => ({ available: true })),
    ...overrides,
  };
}

describe("structure routes", () => {
  it("400s without a drive", async () => {
    const res = await createStructureRoute(deps(), "stats")(
      new Request("http://h/stats"),
      ctxFor(),
    );
    expect(res.status).toBe(400);
  });

  it("returns stats for a reader", async () => {
    const res = await createStructureRoute(deps(), "stats")(
      new Request("http://h/stats?drive=d"),
      ctxFor(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nodeCount: 2 });
  });

  it("passes the topic name through", async () => {
    const d = deps();
    await createStructureRoute(d, "byTopic")(
      new Request("http://h/topics/reactor?drive=d"),
      ctxFor({ name: "reactor" }),
    );
    const query = d.getQuery("d") as unknown as {
      nodesByTopic: { mock: { calls: [string][] } };
    };
    expect(query.nodesByTopic.mock.calls[0][0]).toBe("reactor");
  });

  it("caps triangles at 100", async () => {
    const d = deps();
    await createStructureRoute(d, "triangles")(
      new Request("http://h/triangles?drive=d&limit=1000"),
      ctxFor(),
    );
    const query = d.getQuery("d") as unknown as {
      triangles: { mock: { calls: [number][] } };
    };
    expect(query.triangles.mock.calls[0][0]).toBe(100);
  });

  it("requires write access for activity", async () => {
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    const res = await createStructureRoute(d, "activity")(
      new Request("http://h/activity?drive=d"),
      ctxFor(),
    );
    expect(res.status).toBe(403);
  });

  it("serves bridges to a writer who is not an admin", async () => {
    // Curation tool, not an admin one: the old canManage gate was a cost
    // guard that Tarjan retired.
    const canManage = vi.fn(async () => false);
    const d = deps();
    d.authorization.canManage = canManage;
    const res = await createStructureRoute(d, "bridges")(
      new Request("http://h/bridges?drive=d"),
      ctxFor(),
    );
    expect(res.status).toBe(200);
    expect(canManage).not.toHaveBeenCalled();
  });

  it("refuses bridges to a read-only caller", async () => {
    // It answers "what structural work needs doing", which only someone who
    // can write can act on.
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    const res = await createStructureRoute(d, "bridges")(
      new Request("http://h/bridges?drive=d"),
      ctxFor(),
    );
    expect(res.status).toBe(403);
  });

  it("requires manage access for access-map and reindex", async () => {
    const d = deps();
    d.authorization.canManage = vi.fn(async () => false);
    const map = await createStructureRoute(d, "access-map")(
      new Request("http://h/access-map?drive=d"),
      ctxFor(),
    );
    expect(map.status).toBe(403);
    const reindex = await createStructureRoute(d, "admin/reindex")(
      new Request("http://h/admin/reindex?drive=d", { method: "POST" }),
      ctxFor(),
    );
    expect(reindex.status).toBe(403);
  });

  it("returns the reindex result for an admin", async () => {
    const res = await createStructureRoute(deps(), "admin/reindex")(
      new Request("http://h/admin/reindex?drive=d", { method: "POST" }),
      ctxFor(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      indexedNodes: 2,
      indexedEdges: 3,
      errors: [],
    });
  });

  it("forwards similar with the note id and a bounded limit", async () => {
    const d = deps();
    await createStructureRoute(d, "similar")(
      new Request("http://h/notes/n1/similar?drive=d&limit=999"),
      ctxFor({ id: "n1" }),
    );
    const calls = (
      d.similar as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(calls[0]).toEqual(["d", "n1", 50]);
  });
});