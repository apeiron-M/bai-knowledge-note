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
    expect(rest.scope).toEqual({ q: "claims" });
    expect(rest.totals).toMatchObject({ revised: 1, documents: 1 });
  });
});
