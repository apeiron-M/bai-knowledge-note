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

  it("retries the read-back when the operation log lags", async () => {
    const getOperations = vi
      .fn()
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({
        results: [
          { index: 1, error: null, action: { id: "uuid-1", type: "SET_TITLE" } },
        ],
      });
    const d = deps({
      reactorClient: createFakeReactorClient({
        getOperations: getOperations as never,
      } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [validAction],
      ctx,
      wait: true,
    });
    expect(result.operations).toHaveLength(1);
    expect(getOperations).toHaveBeenCalledTimes(2);
  });

  it("ignores an already-aborted request signal", async () => {
    const executeAsync = vi.fn(async () => ({ id: "job-1" }));
    const d = deps({
      reactorClient: createFakeReactorClient({ executeAsync } as never),
    });
    await executeWrite(d, {
      documentId: "doc",
      document: sourceDocument,
      actions: [validAction],
      ctx: { ...ctx, signal: AbortSignal.abort() } as unknown as RouteContext,
      wait: true,
    });
    expect((executeAsync.mock.calls[0] as unknown[])[3]).toBeUndefined();
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
describe("executeWrite read-back scope arithmetic", () => {
  // A reactor-faithful operation log: getOperations only returns operations
  // whose per-scope index is >= filter.sinceRevision, which is exactly what
  // the real OperationFilter does. Without this the read-back tests pass
  // vacuously.
  function opLog(
    ops: { index: number; id: string; type: string }[],
    pageSize = 200,
  ) {
    return vi.fn(
      async (
        _id: string,
        _view: unknown,
        filter: { sinceRevision?: number } | undefined,
        paging: { cursor?: string; limit?: number } | undefined,
      ) => {
        const visible = ops.filter(
          (o) => o.index >= (filter?.sinceRevision ?? 0),
        );
        const start = paging?.cursor ? Number(paging.cursor) : 0;
        const slice = visible.slice(start, start + pageSize);
        const nextStart = start + pageSize;
        return {
          results: slice.map((o) => ({
            index: o.index,
            error: null,
            action: { id: o.id, type: o.type },
          })),
          nextCursor: nextStart < visible.length ? String(nextStart) : undefined,
        };
      },
    );
  }

  const freshNote = {
    header: {
      id: "doc",
      documentType: "bai/knowledge-note",
      // A freshly created document really does look like this: containment
      // wrote two document-scope operations and there is no global entry.
      revision: { document: 2 },
    },
    state: { global: { title: "x", status: "DRAFT" } },
  } as unknown as PHDocument;

  it("matches a first global write on a document with no global revision yet", async () => {
    const getOperations = opLog([
      { index: 0, id: "uuid-1", type: "SET_TITLE" },
    ]);
    const d = deps({
      reactorClient: createFakeReactorClient({ getOperations } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: freshNote,
      actions: [validAction],
      ctx,
      wait: true,
    });
    expect(result.operations).toHaveLength(1);
    expect(result.readBack).toBe("confirmed");
  });

  it("asks the log for the written scope's prior revision, not the map minimum", async () => {
    const getOperations = opLog([
      { index: 0, id: "uuid-1", type: "SET_TITLE" },
    ]);
    const d = deps({
      reactorClient: createFakeReactorClient({ getOperations } as never),
    });
    await executeWrite(d, {
      documentId: "doc",
      document: freshNote,
      actions: [validAction],
      ctx,
      wait: true,
    });
    const [, , filter] = getOperations.mock.calls[0] as unknown as [
      string,
      unknown,
      { sinceRevision: number },
    ];
    expect(filter.sinceRevision).toBe(0);
  });

  it("matches a document-scope write when only global is present", async () => {
    const noDocScope = {
      header: {
        id: "doc",
        documentType: "bai/knowledge-note",
        revision: { global: 5 },
      },
      state: { global: { title: "x", status: "DRAFT" } },
    } as unknown as PHDocument;
    const getOperations = opLog([
      { index: 0, id: "uuid-1", type: "ADD_RELATIONSHIP" },
    ]);
    const d = deps({
      reactorClient: createFakeReactorClient({ getOperations } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: noDocScope,
      actions: [
        {
          type: "ADD_RELATIONSHIP",
          input: {
            sourceId: "a",
            targetId: "b",
            relationshipType: "RELATES_TO",
            metadata: { reason: "a specific and checkable reason here" },
          },
        },
      ],
      ctx,
      wait: true,
      defaultScope: "document",
    });
    expect(result.operations).toHaveLength(1);
    expect(result.readBack).toBe("confirmed");
  });

  it("follows the cursor when the wanted operation is not on the first page", async () => {
    const filler = Array.from({ length: 200 }, (_, i) => ({
      index: i,
      id: `other-${i}`,
      type: "SET_CONTENT",
    }));
    const getOperations = opLog(
      [...filler, { index: 200, id: "uuid-1", type: "SET_TITLE" }],
      200,
    );
    const d = deps({
      reactorClient: createFakeReactorClient({ getOperations } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: freshNote,
      actions: [validAction],
      ctx,
      wait: true,
    });
    expect(result.operations).toHaveLength(1);
    expect(result.readBack).toBe("confirmed");
  });

  it("reports readBack unconfirmed instead of a clean write when nothing matches", async () => {
    const getOperations = opLog([]);
    const d = deps({
      reactorClient: createFakeReactorClient({ getOperations } as never),
    });
    const result = await executeWrite(d, {
      documentId: "doc",
      document: freshNote,
      actions: [validAction],
      ctx,
      wait: true,
    });
    expect(result.operations).toEqual([]);
    expect(result.readBack).toBe("unconfirmed");
    expect(result.jobId).toBe("job-1");
  });
});
