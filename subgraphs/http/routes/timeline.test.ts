import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { KeptSource } from "../../knowledge-graph/helpers/source-timeline.js";
import { createTimelineRoute, type TimelineRouteDeps } from "./timeline.js";

function ctxFor(): RouteContext {
  return {
    user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
    params: {},
    authEnabled: true,
    transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
  } as unknown as RouteContext;
}

const DRIVE_UUID = "t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM";

function deps(overrides: Partial<TimelineRouteDeps> = {}) {
  const reactorClient = createFakeReactorClient();
  reactorClient.get = vi.fn((id: string) =>
    id === DRIVE_UUID
      ? Promise.resolve({ header: { id: DRIVE_UUID }, state: { global: { nodes: [{ id: "s1", kind: "file", documentType: "bai/source", parentFolder: null }] } } })
      : Promise.reject(new Error(`read the raw identifier ${id}`)),
  ) as never;
  reactorClient.find = vi.fn(() => Promise.resolve({
    results: [
      {
        header: { id: "s1", createdAtUtcIso: "2026-10-10T19:20:00.000Z" },
        state: { global: { title: "How Knowledge Vault works", status: "EXTRACTED", createdAt: "2026-10-10T19:20:00.000Z", extractedClaims: [] } },
      },
    ],
  })) as never;
  const graph = {
    timelineNodes: vi.fn(() => Promise.resolve([])),
    allEdges: vi.fn(() => Promise.resolve([])),
    topicsByDocument: vi.fn(() => Promise.resolve(new Map())),
    timelineSources: vi.fn(() => Promise.resolve(new Map())),
  };
  const getQuery = vi.fn(() => graph);
  const d: TimelineRouteDeps = {
    reactorClient,
    resolveCanonicalDocumentId: vi.fn(() => Promise.resolve(DRIVE_UUID)) as never,
    authorization: {
      canRead: vi.fn(() => Promise.resolve(true)),
      canWrite: vi.fn(() => Promise.resolve(true)),
      canMutate: vi.fn(() => Promise.resolve(true)),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
    getQuery,
    ...overrides,
  };
  return { d, getQuery };
}

describe("GET timeline", () => {
  it("keeps the source rows it had to read, in the canonical drive's index", async () => {
    const saved: KeptSource[] = [];
    const getStore = vi.fn(() => ({ save: (rows: readonly KeptSource[]) => Promise.resolve(void saved.push(...rows)) }));
    const { d } = deps({ getStore });
    const res = await createTimelineRoute(d)(new Request("http://h/timeline?drive=liberuum"), ctxFor());
    expect(res.status).toBe(200);
    expect(getStore).toHaveBeenCalledWith(DRIVE_UUID);
    expect(saved.map((k) => [k.row.id, k.row.title])).toEqual([["s1", "How Knowledge Vault works"]]);
  });

  it("returns the drive's timeline as JSON, reading the canonical drive, not the slug it was given", async () => {
    const { d, getQuery } = deps();
    const res = await createTimelineRoute(d)(new Request("http://h/timeline?drive=liberuum"), ctxFor());
    expect(res.status).toBe(200);
    expect(getQuery).toHaveBeenCalledWith(DRIVE_UUID);
    const body = (await res.json()) as { additions: { title: string }[]; totals: { sources: number } };
    expect(body.additions.map((a) => a.title)).toEqual(["How Knowledge Vault works"]);
    expect(body.totals.sources).toBe(1);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=0");
  });

  it("needs a drive", async () => {
    const res = await createTimelineRoute(deps().d)(new Request("http://h/timeline"), ctxFor());
    expect(res.status).toBe(400);
  });

  it("refuses a caller who cannot read the drive", async () => {
    const { d } = deps();
    d.authorization.canRead = vi.fn(() => Promise.resolve(false));
    const res = await createTimelineRoute(d)(new Request("http://h/timeline?drive=liberuum"), ctxFor());
    expect(res.status).toBe(403);
  });

  it("answers a failed read with the route's internal error, not the reactor's message", async () => {
    const { d } = deps();
    d.reactorClient.get = vi.fn(() => Promise.reject(new Error("pglite: relation does not exist"))) as never;
    const res = await createTimelineRoute(d)(new Request("http://h/timeline?drive=liberuum"), ctxFor());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error", code: "INTERNAL" });
  });
});
