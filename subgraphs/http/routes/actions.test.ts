import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createActionsRoute } from "./actions.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const noteDocument = {
  header: {
    id: "doc",
    documentType: "bai/knowledge-note",
    revision: { global: 1 },
  },
  state: { global: { status: "DRAFT" } },
};

function deps(overrides: Partial<HttpRouteDeps> = {}): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async () => noteDocument) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async () => "doc") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-13T12:00:00.000Z"),
    uuid: () => "uuid-1",
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://h/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validAction = {
  type: "SET_TITLE",
  input: { title: "Hello", updatedAt: "2026-09-13T12:00:00.000Z" },
};

describe("POST actions", () => {
  it("400s when documentId or actions are missing", async () => {
    const res = await createActionsRoute(deps())(
      post({ actions: [validAction] }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("dispatches and returns the read-back operations", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => noteDocument) as never,
        executeAsync: executeAsync as never,
        getOperations: vi.fn(async () => ({
          results: [
            { index: 2, error: null, action: { id: "uuid-1", type: "SET_TITLE" } },
          ],
        })) as never,
      } as never),
    });
    const res = await createActionsRoute(d)(
      post({ documentId: "doc", actions: [validAction] }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revision: unknown;
      operations: { index: number; error: string | null }[];
    };
    expect(body.revision).toEqual({ global: 1 });
    expect(body.operations).toEqual([
      { index: 2, type: "SET_TITLE", error: null, attribution: "server" },
    ]);
    expect(executeAsync).toHaveBeenCalledOnce();
  });

  it("refuses a signed action from another identity with 403", async () => {
    const d = deps();
    const res = await createActionsRoute(d)(
      post({
        documentId: "doc",
        actions: [
          {
            ...validAction,
            context: { signer: { user: { address: "0xother" } } },
          },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("returns 400 with the finding path on a convention failure", async () => {
    const d = deps();
    const res = await createActionsRoute(d)(
      post({
        documentId: "doc",
        actions: [
          { type: "SET_NOTE_TYPE", input: { noteType: "WRONG_CASE", updatedAt: "2026-09-13T12:00:00.000Z" } },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details: unknown[] };
    expect(body.code).toBe("LINT_CONVENTION");
    expect(body.details).toHaveLength(1);
  });

  it("answers 202 with a job id when wait is false", async () => {
    const d = deps();
    const res = await createActionsRoute(d)(
      post({ documentId: "doc", actions: [validAction], wait: false }),
      ctx,
    );
    expect(res.status).toBe(202);
    expect((await res.json()) as { jobId: string }).toEqual({ jobId: "job-1" });
  });
});