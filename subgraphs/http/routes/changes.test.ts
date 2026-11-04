import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import { createTestDb } from "../../../tests/helpers/create-test-db.js";
import { createGraphQuery } from "../../../processors/graph-indexer/query.js";
import { loadDriveChanges } from "../../knowledge-graph/helpers/changes-scope.js";
import { getResolvers } from "../../knowledge-graph/resolvers.js";
import { createChangesRoute, type ChangesRouteDeps } from "./changes.js";
import type * as DbModule from "../../knowledge-graph/helpers/db.js";
import type * as SearchModule from "../../knowledge-graph/helpers/search.js";

// Both surfaces read through getQuery; here it is one real PGlite index, so
// the route and the resolver answer from the same rows.
let harness: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("../../knowledge-graph/helpers/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getQuery: () => createGraphQuery(harness.db),
  resolveCanonicalDriveId: (_: unknown, id: string) => Promise.resolve(id),
}));
vi.mock("../../knowledge-graph/helpers/search.js", async (importOriginal) => ({
  ...(await importOriginal<typeof SearchModule>()),
  searchVault: () => Promise.resolve([{ node: { documentId: "n1" } }]),
}));

const DRIVE = "drive-uuid";
const subgraph = {
  assertCanRead: vi.fn(() => Promise.resolve({})),
  assertCanWrite: vi.fn(() => Promise.resolve({})),
} as unknown as BaseSubgraph;

function ctxFor(): RouteContext {
  return {
    user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
    params: {},
    authEnabled: true,
    transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
  } as unknown as RouteContext;
}

function deps(canRead = true): ChangesRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
    resolveCanonicalDocumentId: vi.fn(() => Promise.resolve(DRIVE)) as never,
    authorization: {
      canRead: vi.fn(() => Promise.resolve(canRead)),
      canWrite: vi.fn(() => Promise.resolve(false)),
      canMutate: vi.fn(() => Promise.resolve(false)),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    loadChanges: (driveId, args) => loadDriveChanges(subgraph, driveId, args),
  };
}

const get = (query: string, headers: Record<string, string> = {}, d = deps()) =>
  createChangesRoute(d)(new Request(`http://h/changes?${query}`, { headers }), ctxFor());

beforeAll(async () => {
  harness = await createTestDb();
  const op = (id: string, documentId: string, operationType: string, input: unknown, timestamp: string) => ({
    id,
    document_id: documentId,
    document_type: "bai/knowledge-note",
    operation_type: operationType,
    timestamp,
    index: 0,
    scope: "global",
    summary: null,
    input_json: JSON.stringify(input),
    signer_address: "0xabc",
    signer_app: null,
    signer_key: null,
    signature: null,
  });
  await harness.db
    .insertInto("graph_operations")
    .values([
      op("a", "n1", "SET_CONTENT", { content: "old claim" }, "2026-10-01T00:00:00.000Z"),
      op("b", "n1", "SET_CONTENT", { content: "new claim" }, "2026-11-03T10:00:00.000Z"),
      op("c", "n2", "CREATE_DOCUMENT", {}, "2026-11-03T11:00:00.000Z"),
    ])
    .execute();
});

afterAll(async () => {
  await harness.cleanup();
});

describe("GET changes", () => {
  it("400s without a drive or a since, and on a date it cannot read", async () => {
    expect((await get("since=2026-11-01")).status).toBe(400);
    expect((await get(`drive=${DRIVE}`)).status).toBe(400);
    const bad = await get(`drive=${DRIVE}&since=last-summer`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("403s a caller who cannot read the drive", async () => {
    const res = await get(`drive=${DRIVE}&since=2026-11-01`, {}, deps(false));
    expect(res.status).toBe(403);
  });

  it("answers JSON by default", async () => {
    const res = await get(`drive=${DRIVE}&since=2026-11-01&until=2026-11-03`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { revised: number; created: number }; window: { until: string }; events?: unknown };
    expect(body.totals).toMatchObject({ revised: 1, created: 1 });
    expect(body.window.until).toBe("2026-11-03T23:59:59.999Z");
    expect(body.events).toBeUndefined();
    expect((body as { story?: { growth: unknown; areas: unknown[] } }).story).toMatchObject({ growth: expect.any(Object) as unknown, areas: expect.any(Array) as unknown });
  });

  it("passes the scope through: comma-separated documentIds, limit and cursor", async () => {
    const res = await get(`drive=${DRIVE}&since=2026-11-01&documentIds=n1,n9&limit=1`);
    const body = (await res.json()) as { scope: unknown; events: { documentId: string }[] };
    expect(body.scope).toEqual({ documentIds: ["n1", "n9"] });
    expect(body.events.map((e) => e.documentId)).toEqual(["n1"]);
  });

  it("pages through one window when no until is given, and 400s a cursor it did not issue", async () => {
    const first = (await (await get(`drive=${DRIVE}&since=2026-11-01&documentIds=n1,n2&limit=1`)).json()) as { window: { until: string }; nextCursor: string; events: { documentId: string }[] };
    expect(first.nextCursor).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    const second = (await (await get(`drive=${DRIVE}&since=2026-11-01&documentIds=n1,n2&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json()) as { window: { until: string }; events: { documentId: string }[] };
    expect(second.window.until).toBe(first.window.until);
    expect([...first.events, ...second.events].map((e) => e.documentId).sort()).toEqual(["n1", "n2"]);
    const bad = await get(`drive=${DRIVE}&since=2026-11-01&documentIds=n1&cursor=garbage`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers markdown when asked", async () => {
    const res = await get(`drive=${DRIVE}&since=2026-11-01&until=2026-11-03`, { accept: "text/markdown" });
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toMatch(/^# Changes 2026-11-01T00:00:00.000Z → 2026-11-03T23:59:59.999Z/);
    expect(text).toContain("1 created, 1 revised");
  });

  it("gives the same totals as knowledgeGraphChanges for the same arguments", async () => {
    const res = await get(`drive=${DRIVE}&since=2026-11-01&until=2026-11-03&q=claims`);
    const rest = (await res.json()) as { totals: unknown; scope: unknown };
    const resolver = (getResolvers(subgraph) as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<{ totals: unknown; scope: unknown }>> }).Query
      .knowledgeGraphChanges;
    const gql = await resolver({}, { driveId: DRIVE, since: "2026-11-01", until: "2026-11-03", q: "claims" }, {});
    expect(rest.totals).toEqual(gql.totals);
    // Both say what q covered: no map is named "claims", so a search.
    expect(rest.scope).toEqual({ q: "claims", resolved: { kind: "search", query: "claims", hits: 1 } });
    expect(gql.scope).toEqual(rest.scope);
    expect(rest.totals).toMatchObject({ revised: 1, documents: 1 });
  });

  describe("areas and source scopes (Addendum C1a, C1b)", () => {
    beforeAll(async () => {
      // Inserted after the q parity test above: a map holding n1 would turn its search into an area.
      const T = "2026-11-01T00:00:00.000Z";
      const node = (id: string, title: string, documentType: string, noteType: string | null) => ({
        id, document_id: id, title, description: null, note_type: noteType, status: documentType === "bai/moc" ? "MOC" : "CANONICAL",
        content: null, author: null, source_origin: null, created_at: null, added_at: null, updated_at: T, document_type: documentType,
      });
      await harness.db
        .insertInto("graph_nodes")
        .values([node("hub", "Vault Hub", "bai/moc", "MOC (HUB)"), node("a1", "Claims, Old and New", "bai/moc", "MOC (DOMAIN)"), node("n1", "n1", "bai/knowledge-note", null), node("n2", "n2", "bai/knowledge-note", null)])
        .execute();
      const edge = (s: string, t: string, type: string) => ({ id: `${s}-${t}`, source_document_id: s, target_document_id: t, link_type: type, target_title: null, updated_at: T, metadata: null });
      await harness.db.insertInto("graph_edges").values([edge("hub", "a1", "CHILD_MOC"), edge("a1", "n1", "CORE_IDEA")]).execute();
      const { SOURCE_ROW_VERSION } = await import("../../../processors/graph-indexer/source-timeline.js");
      await harness.db
        .insertInto("graph_sources")
        .values({ document_id: "s1", row_json: JSON.stringify({ id: "s1", title: "README.md", url: "https://github.com/powerhouse-inc/powerhouse", claimIds: ["n2"], addedAt: T }), revision: 1, version: SOURCE_ROW_VERSION, updated_at: T })
        .execute();
    });
    const resolver = () =>
      (getResolvers(subgraph) as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<{ totals: unknown; scope: unknown }>> }).Query.knowledgeGraphChanges;

    it("takes areas as repeated parameters (a title may hold a comma) and answers as knowledgeGraphChanges does", async () => {
      const rest = (await (await get(`drive=${DRIVE}&since=2026-11-01&until=2026-11-03&areas=${encodeURIComponent("claims, old and new")}&areas=Nope`)).json()) as { totals: unknown; scope: unknown };
      const gql = await resolver()({}, { driveId: DRIVE, since: "2026-11-01", until: "2026-11-03", areas: ["claims, old and new", "Nope"] }, {});
      expect(rest.scope).toEqual({ areas: ["claims, old and new", "Nope"], resolved: { kind: "areas", areas: [{ id: "a1", title: "Claims, Old and New" }], unknown: ["Nope"] } });
      expect(gql.scope).toEqual(rest.scope);
      expect(rest.totals).toEqual(gql.totals);
      expect(rest.totals).toMatchObject({ revised: 1, created: 0 });
    });

    it("takes source and answers as knowledgeGraphChanges does", async () => {
      const rest = (await (await get(`drive=${DRIVE}&since=2026-11-01&until=2026-11-03&source=Powerhouse-Inc/Powerhouse`)).json()) as { totals: unknown; scope: unknown };
      const gql = await resolver()({}, { driveId: DRIVE, since: "2026-11-01", until: "2026-11-03", source: "Powerhouse-Inc/Powerhouse" }, {});
      expect(rest.scope).toEqual({ source: "Powerhouse-Inc/Powerhouse", resolved: { kind: "source", match: "Powerhouse-Inc/Powerhouse", sources: 1 } });
      expect(gql.scope).toEqual(rest.scope);
      expect(rest.totals).toEqual(gql.totals);
      expect(rest.totals).toMatchObject({ created: 1, revised: 0 });
    });
  });
});
