import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createClaimRoute } from "./tasks.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: { id: "task-1" },
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const queueDocument = {
  header: {
    id: "queue-1",
    documentType: "bai/pipeline-queue",
    revision: { global: 4 },
  },
  state: {
    global: {
      tasks: [
        { id: "task-1", status: "PENDING", assignedTo: null },
      ],
      phaseOrder: [{ taskType: "claim", phases: ["create", "reflect"] }],
    },
  },
};

function deps(
  findResult: unknown[] = [queueDocument],
  operations: unknown[] = [
    { index: 5, error: null, action: { id: "uuid-1", type: "ASSIGN_TASK" } },
  ],
): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      find: vi.fn(async () => ({ results: findResult })) as never,
      get: vi.fn(async () => queueDocument) as never,
      getOperations: vi.fn(async () => ({ results: operations })) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async () => "queue-1") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    uuid: () => "uuid-1",
  };
}

function post(body: unknown = {}): Request {
  return new Request("http://h/tasks/task-1/claim?drive=d", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST tasks/:id/claim", () => {
  it("400s without a drive", async () => {
    const res = await createClaimRoute(deps())(
      new Request("http://h/tasks/task-1/claim", { method: "POST" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the drive has no pipeline queue", async () => {
    const res = await createClaimRoute(deps([]))(post(), ctx);
    expect(res.status).toBe(404);
  });

  it("claims with the caller's address by default", async () => {
    const d = deps();
    const res = await createClaimRoute(d)(post(), ctx);
    expect(res.status).toBe(200);
    const [, , actions] = (
      d.reactorClient.executeAsync as unknown as {
        mock: { calls: [string, string, { type: string; input: { assignedTo: string } }[]][] };
      }
    ).mock.calls[0];
    expect(actions[0].type).toBe("ASSIGN_TASK");
    expect(actions[0].input.assignedTo).toBe("0xabc");
  });

  it("honours an explicit assignedTo", async () => {
    const d = deps();
    await createClaimRoute(d)(post({ assignedTo: "0xworker" }), ctx);
    const [, , actions] = (
      d.reactorClient.executeAsync as unknown as {
        mock: { calls: [string, string, { input: { assignedTo: string } }[]][] };
      }
    ).mock.calls[0];
    expect(actions[0].input.assignedTo).toBe("0xworker");
  });

  it("409s when the task is already assigned", async () => {
    const d = deps(
      [queueDocument],
      [
        {
          index: 5,
          error: "Task task-1 is already assigned to 0xaaa",
          action: { id: "uuid-1", type: "ASSIGN_TASK" },
        },
      ],
    );
    const res = await createClaimRoute(d)(post(), ctx);
    expect(res.status).toBe(409);
  });

  it("404s when the task id is unknown", async () => {
    const d = deps(
      [queueDocument],
      [
        {
          index: 5,
          error: "Task not found",
          action: { id: "uuid-1", type: "ASSIGN_TASK" },
        },
      ],
    );
    const res = await createClaimRoute(d)(post(), ctx);
    expect(res.status).toBe(404);
  });
});