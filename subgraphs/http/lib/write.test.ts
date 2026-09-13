import { describe, expect, it, vi } from "vitest";
import type { PHDocument } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "./deps.js";
import { executeWrite } from "./write.js";

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

const sourceDocument = {
  header: {
    id: "doc",
    documentType: "bai/knowledge-note",
    revision: { global: 3, document: 1 },
  },
  state: { global: { title: "x", status: "DRAFT" } },
} as unknown as PHDocument;

function deps(overrides: Partial<HttpRouteDeps> = {}): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient(),
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

const validAction = {
  type: "SET_TITLE",
  input: { title: "Hello", updatedAt: "2026-09-13T12:00:00.000Z" },
};

describe("executeWrite", () => {
  it("refuses a lint failure with 400 and dispatches nothing", async () => {
    const d = deps();
    await expect(
      executeWrite(d, {
        documentId: "doc",
        document: sourceDocument,
        actions: [{ type: "NOT_A_REAL_ACTION", input: {} }],
        ctx,
        wait: true,
      }),
    ).rejects.toMatchObject({ status: 400, code: "LINT_REACTOR" });
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("stamps the envelope before dispatch", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({ executeAsync } as never),
    });
    await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [validAction],
      ctx,
      wait: true,
    });
    const [, , actions] = executeAsync.mock.calls[0] as unknown as [
      string,
      string,
      { id: string; scope: string; timestampUtcMs: string }[],
    ];
    expect(actions[0].id).toBe("uuid-1");
    expect(actions[0].scope).toBe("global");
    expect(actions[0].timestampUtcMs).toBe("2026-09-13T12:00:00.000Z");
  });

  it("reads back only the dispatched operations and reports their errors", async () => {
    const d = deps({
      reactorClient: createFakeReactorClient({
        getOperations: vi.fn(async () => ({
          results: [
            { index: 3, error: null, action: { id: "other", type: "OTHER" } },
            {
              index: 4,
              error: "reducer said no",
              action: { id: "uuid-1", type: "SET_TITLE" },
            },
          ],
        })) as never,
      } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [validAction],
      ctx,
      wait: true,
    });
    expect(result.operations).toEqual([
      {
        index: 4,
        type: "SET_TITLE",
        error: "reducer said no",
        attribution: "server",
      },
    ]);
  });

  it("refuses an action signed by another identity", async () => {
    const d = deps();
    await expect(
      executeWrite(d, {
        documentId: "doc",
        document: sourceDocument,
        actions: [
          {
            ...validAction,
            context: {
              signer: { user: { address: "0xother" } },
            },
          },
        ],
        ctx,
        wait: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("returns the job id without waiting when wait is false", async () => {
    const waitForJob = vi.fn(async () => ({ id: "job-1", error: null }));
    const d = deps({
      reactorClient: createFakeReactorClient({ waitForJob } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [validAction],
      ctx,
      wait: false,
    });
    expect(result.jobId).toBe("job-1");
    expect(waitForJob).not.toHaveBeenCalled();
  });

  it("prefers a supplied scope over the default", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({ executeAsync } as never),
    });
    await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [{ ...validAction, scope: "document" }],
      ctx,
      wait: true,
      defaultScope: "document",
    });
    const [, , actions] = executeAsync.mock.calls[0] as unknown as [
      string,
      string,
      { scope: string }[],
    ];
    expect(actions[0].scope).toBe("document");
  });
});