import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createBadgeRoute, createHealthRoute } from "./health.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: {},
  authEnabled: true,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const reportDocument = {
  header: { id: "health-1", documentType: "bai/health-report" },
  state: { global: { overallStatus: "PASS", checks: [] } },
};

function deps(report: unknown = reportDocument): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      find: vi.fn(async () => ({ results: report ? [report] : [] })) as never,
      get: vi.fn(async () => reportDocument) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async () => "health-1") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
  };
}

describe("health routes", () => {
  it("health.json returns the last report for a reader", async () => {
    const res = await createHealthRoute(deps())(
      new Request("http://h/health.json?drive=d"),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { overallStatus: string }).toMatchObject({
      overallStatus: "PASS",
    });
  });

  it("health.json 404s without a report", async () => {
    const res = await createHealthRoute(deps(null))(
      new Request("http://h/health.json?drive=d"),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("badge.svg renders the status word", async () => {
    const res = await createBadgeRoute(deps())(
      new Request("http://h/badge.svg?drive=d"),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("PASS");
  });

  it("badge.svg stays UNKNOWN when the report cannot be read", async () => {
    const d = deps();
    d.reactorClient.get = vi.fn(async () => {
      throw new Error("forbidden");
    }) as never;
    const res = await createBadgeRoute(d)(
      new Request("http://h/badge.svg?drive=d"),
      ctx,
    );
    expect(await res.text()).toContain("UNKNOWN");
  });
});