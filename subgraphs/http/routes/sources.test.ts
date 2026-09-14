import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createIngestSourceRoute } from "./sources.js";

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

const FOLDERS = [
  { id: "f-sources", name: "sources", kind: "folder" },
  { id: "f-knowledge", name: "knowledge", kind: "folder" },
  { id: "f-notes", name: "notes", kind: "folder", parentFolder: "f-knowledge" },
  { id: "f-ops", name: "ops", kind: "folder" },
  { id: "f-queue", name: "queue", kind: "folder", parentFolder: "f-ops" },
];

const createdSource = {
  header: {
    id: "src-1",
    documentType: "bai/source",
    revision: { document: 2 },
  },
  state: { global: {} },
};

const emptyQueue = {
  header: {
    id: "queue-1",
    documentType: "bai/pipeline-queue",
    revision: { global: 1 },
  },
  state: { global: { tasks: [] } },
};

function driveDoc(extraNodes: unknown[] = [], folders = FOLDERS) {
  return {
    header: { id: "drive", documentType: "powerhouse/document-drive" },
    state: { global: { nodes: [...folders, ...extraNodes] } },
  };
}

function deps(overrides: Partial<HttpRouteDeps> = {}, driveNodes = [
  { id: "src-1", name: "A source", documentType: "bai/source", parentFolder: "f-sources" },
]): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async (id: string) => {
        if (id === "drive") return driveDoc(driveNodes);
        if (id === "queue-1") return emptyQueue;
        return createdSource;
      }) as never,
      createDocumentInDrive: vi.fn(async () => createdSource) as never,
      getOperations: vi.fn(async () => ({
        results: [
          { index: 0, error: null, action: { id: "uuid-1", type: "INGEST_SOURCE" } },
        ],
      })) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async (id: string) => id) as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-14T12:00:00.000Z"),
    uuid: () => "uuid-1",
    ...overrides,
  };
}

const post = (body: unknown) =>
  new Request("http://h/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST sources", () => {
  it("ingests from content alone and places it in /sources", async () => {
    const d = deps();
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "A source", content: "the body", queue: false }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      parentFolder: string;
      path: string;
      status: string;
      readBack: string;
    };
    expect(body.id).toBe("src-1");
    expect(body.parentFolder).toBe("f-sources");
    expect(body.path).toBe("/sources");
    expect(body.status).toBe("INBOX");
    expect(body.readBack).toBe("confirmed");

    const create = d.reactorClient.createDocumentInDrive as unknown as {
      mock: { calls: [string, unknown, string][] };
    };
    // placed by folder id, resolved by the API - not by the caller
    expect(create.mock.calls[0][2]).toBe("f-sources");
  });

  it("dispatches INGEST_SOURCE with the caller as createdBy", async () => {
    const d = deps();
    await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C", queue: false, sourceType: "ARTICLE" }),
      ctx,
    );
    const exec = d.reactorClient.executeAsync as unknown as {
      mock: { calls: [string, string, { type: string; input: Record<string, unknown> }[]][] };
    };
    const actions = exec.mock.calls[0][2];
    expect(actions[0].type).toBe("INGEST_SOURCE");
    expect(actions[0].input.sourceType).toBe("ARTICLE");
    expect(actions[0].input.createdBy).toBe("0xabc");
  });

  it("refuses parentFolder so nothing can be placed elsewhere", async () => {
    const d = deps();
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C", parentFolder: "f-notes" }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("refuses an invalid sourceType instead of dropping it silently", async () => {
    const d = deps();
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C", sourceType: "BLOG" }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("creates nothing when the drive has no /sources folder", async () => {
    const noSources = FOLDERS.filter((f) => f.id !== "f-sources");
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => driveDoc([], noSources)) as never,
        createDocumentInDrive: vi.fn(async () => createdSource) as never,
      } as never),
    });
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "FOLDER_UNRESOLVED",
    });
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("requires title and content", async () => {
    const d = deps();
    for (const body of [
      { drive: "drive", content: "C" },
      { drive: "drive", title: "T" },
      { drive: "drive", title: "  ", content: "C" },
    ]) {
      const res = await createIngestSourceRoute(d)(post(body), ctx);
      expect(res.status).toBe(400);
    }
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("queues a claim task by default and reports it", async () => {
    const d = deps({}, [
      { id: "src-1", name: "A source", documentType: "bai/source", parentFolder: "f-sources" },
      { id: "queue-1", name: "queue", documentType: "bai/pipeline-queue", parentFolder: "f-queue" },
    ]);
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    const body = (await res.json()) as {
      status: string;
      task?: { id: string; created: boolean };
    };
    expect(body.status).toBe("EXTRACTING");
    expect(body.task).toEqual({ id: "uuid-1", created: true });
  });

  it("does not add a second task for a source already queued", async () => {
    const queueDoc = {
      header: { id: "queue-1", documentType: "bai/pipeline-queue", revision: { global: 4 } },
      state: { global: { tasks: [{ id: "existing", documentRef: "src-1" }] } },
    };
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async (id: string) => {
          if (id === "drive")
            return driveDoc([
              { id: "src-1", name: "s", documentType: "bai/source", parentFolder: "f-sources" },
              { id: "queue-1", name: "q", documentType: "bai/pipeline-queue", parentFolder: "f-queue" },
            ]);
          if (id === "queue-1") return queueDoc;
          return createdSource;
        }) as never,
        createDocumentInDrive: vi.fn(async () => createdSource) as never,
        getOperations: vi.fn(async () => ({
          results: [
            { index: 0, error: null, action: { id: "uuid-1", type: "INGEST_SOURCE" } },
          ],
        })) as never,
      } as never),
    });
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    const body = (await res.json()) as { task?: { id: string; created: boolean } };
    expect(body.task).toEqual({ id: "existing", created: false });
  });

  it("refuses a caller without write access to the drive", async () => {
    const d = deps({
      authorization: {
        canRead: vi.fn(async () => true),
        canWrite: vi.fn(async () => false),
        canMutate: vi.fn(async () => true),
        isSupremeAdmin: vi.fn(() => false),
      },
    });
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });
});
