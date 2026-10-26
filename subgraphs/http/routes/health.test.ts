import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { reducer as healthReducer, utils as healthUtils } from "../../../document-models/health-report/index.js";
import { createBadgeRoute, createHealthRoute, createHealthWriteRoute, openTasks } from "./health.js";

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

const driveDocument = {
  header: { id: "d", documentType: "powerhouse/document-drive" },
  state: {
    global: { nodes: [{ id: "health-1", documentType: "bai/health-report" }] },
  },
};

const emptyDriveDocument = {
  header: { id: "d", documentType: "powerhouse/document-drive" },
  state: { global: { nodes: [] } },
};

function deps(drive: unknown = driveDocument): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async (id: string) =>
        id === "d" ? drive : reportDocument,
      ) as never,
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
    const res = await createHealthRoute(deps(emptyDriveDocument))(
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
    d.reactorClient.get = vi.fn(async (id: string) => {
      if (id === "d") return driveDocument;
      throw new Error("forbidden");
    }) as never;
    const res = await createBadgeRoute(d)(
      new Request("http://h/badge.svg?drive=d"),
      ctx,
    );
    expect(await res.text()).toContain("UNKNOWN");
  });
});
describe("POST health: grade the vault and rewrite its report", () => {
  /** A drive with a report, two notes (one linked, one not) and a map; the report runs on its real reducer. */
  function vault(options: { withReport?: boolean; tasks?: { status: string; updatedAt?: string | null; createdAt: string }[] } = {}) {
    let report = healthUtils.createDocument() as unknown as { header: { id: string; documentType: string; revision?: unknown }; operations: { global: { index: number; error?: string | null; action: { id: string; type: string } }[] }; state: { global: Record<string, unknown> } };
    report = { ...report, header: { ...report.header, id: "health-1" } };
    const drive = {
      header: { id: "d", documentType: "powerhouse/document-drive" },
      state: {
        global: {
          nodes: [
            ...(options.withReport === false ? [] : [{ id: "health-1", kind: "file", documentType: "bai/health-report" }]),
            { id: "n1", kind: "file", documentType: "bai/knowledge-note" },
            { id: "n2", kind: "file", documentType: "bai/knowledge-note" },
            { id: "m1", kind: "file", documentType: "bai/moc" },
            ...(options.tasks ? [{ id: "q1", kind: "file", documentType: "bai/pipeline-queue" }] : []),
          ],
        },
      },
    };
    const node = (documentId: string, documentType: string, description: string | null) =>
      ({ id: documentId, documentId, title: `Title of ${documentId}`, description, noteType: "concept", status: "IN_REVIEW", documentType }) as never;
    const reactorClient = createFakeReactorClient({
      get: vi.fn(async (id: string) => (id === "d" ? drive : id === "q1" ? { header: { id: "q1", documentType: "bai/pipeline-queue" }, state: { global: { tasks: options.tasks ?? [] } } } : report)) as never,
      executeAsync: vi.fn(async (_id: string, _branch: string, actions: { id: string; type: string }[]) => {
        for (const action of actions) report = healthReducer(report as never, action as never) as never;
        return { id: "job-1" };
      }) as never,
      getOperations: vi.fn(async (_id: string, _v: unknown, filter: { sinceRevision: number }) => ({
        results: report.operations.global.filter((op) => op.index >= filter.sinceRevision),
      })) as never,
    } as never);
    const deps = {
      reactorClient,
      resolveCanonicalDocumentId: vi.fn(async (id: string) => id) as never,
      authorization: { canRead: vi.fn(async () => true), canWrite: vi.fn(async () => true), canMutate: vi.fn(async () => true), isSupremeAdmin: vi.fn(() => false) },
      now: () => new Date("2026-10-26T12:00:00.000Z"),
      uuid: () => "u",
      getQuery: () => ({
        allNodes: async () => [node("n1", "bai/knowledge-note", "A note that says what it adds to its title."), node("n2", "bai/knowledge-note", null), node("m1", "bai/moc", null)],
        allEdges: async () => [
          { id: "e1", sourceDocumentId: "n2", targetDocumentId: "n1", linkType: "BUILDS_ON", targetTitle: null, updatedAt: "", reason: "why" } as never,
          { id: "e2", sourceDocumentId: "m1", targetDocumentId: "n1", linkType: "CORE_IDEA", targetTitle: null, updatedAt: "", reason: null } as never,
        ],
        topicsByDocument: async () => new Map([["n1", ["reactor"]]]),
      }),
    };
    return { deps, report: () => report };
  }

  it("writes GENERATE_REPORT, then the dashboard's checks, and answers with what it wrote", async () => {
    const v = vault();
    const res = await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d&by=vault-pipeline", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overallStatus: string; checks: { category: string }[]; metrics: { noteCount: number }; readBack: string };
    expect(body.readBack).toBe("confirmed");
    expect(body.metrics.noteCount).toBe(2);
    // The dashboard's rules (health-checks.ts): these five always; throughput and tensions only when something is open.
    expect(body.checks.map((c) => c.category).sort()).toEqual(["DESCRIPTION_QUALITY", "LINK_HEALTH", "MOC_COHERENCE", "ORPHAN_DETECTION", "SCHEMA_COMPLIANCE"]);
    const state = v.report().state.global as { generatedBy?: string; mode?: string; overallStatus?: string; checks?: unknown[]; graphMetrics?: { noteCount: number } };
    expect(v.report().operations.global.every((op) => !op.error)).toBe(true);
    expect(state).toMatchObject({ generatedBy: "vault-pipeline", mode: "full", overallStatus: body.overallStatus, graphMetrics: { noteCount: 2 } });
    expect(state.checks).toHaveLength(body.checks.length);
  });

  it("replaces the last run's checks instead of adding to them", async () => {
    const v = vault();
    const first = (await (await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d", { method: "POST" }), ctx)).json()) as { checks: unknown[] };
    await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d", { method: "POST" }), ctx);
    expect((v.report().state.global as { checks: unknown[] }).checks).toHaveLength(first.checks.length);
  });

  it("404s on a drive without a report, and 400s without a drive", async () => {
    const none = await createHealthWriteRoute(vault({ withReport: false }).deps as never)(new Request("http://h/health?drive=d", { method: "POST" }), ctx);
    expect(none.status).toBe(404);
    const noDrive = await createHealthWriteRoute(vault().deps as never)(new Request("http://h/health", { method: "POST" }), ctx);
    expect(noDrive.status).toBe(400);
  });

  it("when=idle: leaves the report to the last source while others are still in the queue", async () => {
    const v = vault({ tasks: [{ status: "DONE", createdAt: "2026-10-26T11:00:00.000Z" }, { status: "IN_PROGRESS", updatedAt: "2026-10-26T11:50:00.000Z", createdAt: "2026-10-26T11:00:00.000Z" }, { status: "PENDING", createdAt: "2026-10-26T11:55:00.000Z" }] });
    const res = await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d&when=idle", { method: "POST" }), ctx);
    expect(await res.json()).toMatchObject({ skipped: "busy", openTasks: 2 });
    expect(v.report().operations.global).toHaveLength(0);
  });

  it("when=idle: writes once the batch is through, and not again while the grade is the same", async () => {
    const v = vault({ tasks: [{ status: "DONE", createdAt: "2026-10-26T11:00:00.000Z" }, { status: "FAILED", createdAt: "2026-10-26T11:00:00.000Z" }, { status: "BLOCKED", createdAt: "2026-10-26T11:00:00.000Z" }] });
    const first = (await (await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d&when=idle", { method: "POST" }), ctx)).json()) as { skipped?: string; readBack?: string };
    expect(first.skipped).toBeUndefined();
    expect(first.readBack).toBe("confirmed");
    const written = v.report().operations.global.length;
    const second = (await (await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d&when=idle", { method: "POST" }), ctx)).json()) as { skipped?: string };
    expect(second).toMatchObject({ skipped: "unchanged" });
    expect(v.report().operations.global).toHaveLength(written);
    // Asked to write every time, it does.
    await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d", { method: "POST" }), ctx);
    expect(v.report().operations.global.length).toBeGreaterThan(written);
  });

  it("when=idle: a task stuck for more than two hours does not hold the report back", async () => {
    const v = vault({ tasks: [{ status: "IN_PROGRESS", updatedAt: "2026-10-26T09:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z" }] });
    const res = (await (await createHealthWriteRoute(v.deps as never)(new Request("http://h/health?drive=d&when=idle", { method: "POST" }), ctx)).json()) as { skipped?: string };
    expect(res.skipped).toBeUndefined();
  });
});

describe("openTasks", () => {
  it("counts sources waiting or in progress, touched in the last two hours", () => {
    const now = Date.parse("2026-10-26T12:00:00.000Z");
    expect(openTasks([
      { status: "PENDING", createdAt: "2026-10-26T11:59:00.000Z" },
      { status: "IN_PROGRESS", updatedAt: "2026-10-26T10:30:00.000Z" },
      { status: "IN_PROGRESS", updatedAt: "2026-10-26T09:00:00.000Z" },
      { status: "BLOCKED", updatedAt: "2026-10-26T11:59:00.000Z" },
      { status: "DONE", updatedAt: "2026-10-26T11:59:00.000Z" },
    ], now)).toBe(2);
  });
});
