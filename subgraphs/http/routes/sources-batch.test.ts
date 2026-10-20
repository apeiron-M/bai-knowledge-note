import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createIngestSourcesBatchRoute } from "./sources-batch.js";

const ctx = {
  user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const FOLDERS = [
  { id: "f-sources", name: "sources", kind: "folder" },
  { id: "f-book", name: "A Book", kind: "folder", parentFolder: "f-sources" },
  { id: "f-ops", name: "ops", kind: "folder" },
  { id: "f-queue", name: "queue", kind: "folder", parentFolder: "f-ops" },
  { id: "queue-1", name: "queue", kind: "file", documentType: "bai/pipeline-queue", parentFolder: "f-queue" },
];

type Act = { id: string; type: string; input: Record<string, unknown> };

/**
 * A small engine: the drive holds the ADD_FILEs it is sent, the queue its
 * ADD_TASKs, and every dispatch reads back as operations — with the
 * INGEST_SOURCE of the sources named in `refuse` (by creation order) refused.
 */
function engine(refuse: ReadonlySet<number> = new Set()) {
  let drafts = 0;
  let uuids = 0;
  const nodes: Record<string, unknown>[] = [...FOLDERS];
  const tasks: Record<string, unknown>[] = [];
  const created: string[] = [];
  const dispatches: { doc: string; actions: Act[] }[] = [];
  const log = new Map<string, { index: number; error: string | null; action: { id: string; type: string } }[]>();
  const client = createFakeReactorClient({
    getDocumentModelModule: vi.fn(async () => ({
      utils: {
        createDocument: () => ({
          header: { id: `src-${++drafts}`, documentType: "bai/source", name: "", revision: {} },
          state: { global: {} },
        }),
      },
    })) as never,
    create: vi.fn(async (doc: { header: { id: string } }) => {
      created.push(doc.header.id);
      return doc;
    }) as never,
    get: vi.fn(async (id: string) => {
      if (id === "drive") {
        return { header: { id, documentType: "powerhouse/document-drive", revision: {} }, state: { global: { nodes } } };
      }
      if (id === "queue-1") {
        return { header: { id, documentType: "bai/pipeline-queue", revision: { global: 0 } }, state: { global: { tasks } } };
      }
      return { header: { id, documentType: "bai/source", revision: { global: 0 } }, state: { global: {} } };
    }) as never,
    executeAsync: vi.fn(async (doc: string, _branch: string, actions: Act[]) => {
      dispatches.push({ doc, actions });
      const ops = log.get(doc) ?? [];
      for (const action of actions) {
        if (action.type === "ADD_FILE") nodes.push(action.input);
        if (action.type === "ADD_TASK") tasks.push(action.input);
        const refused = action.type === "INGEST_SOURCE" && refuse.has(created.indexOf(doc));
        ops.push({ index: ops.length, error: refused ? "content is refused" : null, action: { id: action.id, type: action.type } });
      }
      log.set(doc, ops);
      return { id: `job-${dispatches.length}` };
    }) as never,
    getOperations: vi.fn(async (doc: string) => ({ results: log.get(doc) ?? [] })) as never,
  });
  const deps = {
    reactorClient: client,
    resolveCanonicalDocumentId: vi.fn(async (id: string) => id) as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-10-15T12:00:00.000Z"),
    uuid: () => `uuid-${++uuids}`,
  } as unknown as HttpRouteDeps;
  return { deps, client, created, dispatches, tasks };
}

const source = (n: number) => ({
  title: `Section ${n}`,
  content: `The text of section ${n}.`,
  sourceType: "BOOK_CHAPTER",
  actions: [
    {
      type: "ATTACH_ORIGINAL_FILE",
      scope: "global",
      input: {
        originalFile: "attachment://v1:abcdef",
        originalFileName: "book.pdf",
        originalMimeType: "application/pdf",
        originalSizeBytes: 1000,
        convertedBy: "docling.rs",
        attachedAt: "2026-10-15T12:00:00.000Z",
      },
    },
  ],
});

const post = (body: unknown) =>
  new Request("http://h/sources/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const typesOf = (actions: Act[]) => actions.map((a) => a.type);

describe("POST sources/batch", () => {
  it("files a batch with two drive writes (containment links, then the tree) and one queue write, the original riding with each source's content", async () => {
    const e = engine();
    const res = await createIngestSourcesBatchRoute(e.deps)(
      post({ drive: "drive", parentFolder: "f-book", sources: [source(1), source(2), source(3)] }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string; sources: { index: number; id: string; status: string; task?: { created: boolean } }[] };
    expect(body.path).toBe("/sources/A Book");
    const ids = e.created; // in creation order (the draft linted against is never created)
    expect(ids).toHaveLength(3);
    expect(body.sources.map((s) => [s.index, s.id, s.status, s.task?.created])).toEqual(
      ids.map((id, index) => [index, id, "EXTRACTING", true]),
    );

    // The drive's "child" relationship to each source — what a reader's grant
    // on the drive reaches it through — then the tree, each in one job.
    const drive = e.dispatches.filter((d) => d.doc === "drive");
    expect(drive).toHaveLength(2);
    expect(typesOf(drive[0].actions)).toEqual(["ADD_RELATIONSHIP", "ADD_RELATIONSHIP", "ADD_RELATIONSHIP"]);
    expect(drive[0].actions.map((a) => [a.input.sourceId, a.input.targetId, a.input.relationshipType])).toEqual(
      ids.map((id) => ["drive", id, "child"]),
    );
    expect(typesOf(drive[1].actions)).toEqual(["ADD_FILE", "ADD_FILE", "ADD_FILE"]);
    expect(drive[1].actions.every((a) => a.input.parentFolder === "f-book")).toBe(true);
    const queue = e.dispatches.filter((d) => d.doc === "queue-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].actions.map((a) => a.input.documentRef)).toEqual(ids);
    for (const id of ids) {
      const writes = e.dispatches.filter((d) => d.doc === id);
      expect(writes).toHaveLength(1);
      expect(typesOf(writes[0].actions)).toEqual(["INGEST_SOURCE", "SET_SOURCE_STATUS", "ATTACH_ORIGINAL_FILE"]);
    }
    expect(e.client.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("keeps the sources before a refused one, rolls back it and the rest, and queues only what landed", async () => {
    const e = engine(new Set([1]));
    const res = await createIngestSourcesBatchRoute(e.deps)(
      post({ drive: "drive", parentFolder: "f-book", sources: [source(1), source(2), source(3)] }),
      ctx,
    );
    expect(res.status).toBe(207);
    const body = (await res.json()) as { sources: { id: string }[]; failure: { index: number; code: string } };
    const [first, second, third] = e.created;
    expect(body.sources.map((s) => s.id)).toEqual([first]);
    expect(body.failure).toMatchObject({ index: 1, code: "INGEST_REJECTED" });
    expect(e.client.deleteDocuments).toHaveBeenCalledWith([second, third]);
    expect(e.tasks.map((t) => t.documentRef)).toEqual([first]);
  });

  it("refuses a batch with one bad source before creating anything", async () => {
    const e = engine();
    const res = await createIngestSourcesBatchRoute(e.deps)(
      post({ drive: "drive", sources: [source(1), { ...source(2), sourceType: "NOT_A_TYPE" }] }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("sources[1].sourceType");
    expect(e.created).toEqual([]);
    expect(e.dispatches).toEqual([]);
  });
});
