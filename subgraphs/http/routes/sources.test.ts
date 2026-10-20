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
  // a book's chapters grouped under /sources
  { id: "f-book", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-sources" },
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

  it("refuses a parentFolder outside /sources, so nothing scatters", async () => {
    const d = deps();
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C", parentFolder: "f-notes" }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "FOLDER_OUTSIDE_VAULT_PATH" });
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
  });

  it("places a source in a folder within /sources when asked", async () => {
    // A book's chapters: each ingest names the folder the book was given.
    // The drive is read back to verify placement, so the fixture must show
    // the document actually landing in f-book.
    const d = deps({}, [
      { id: "src-1", name: "Chapter 3", documentType: "bai/source", parentFolder: "f-book" },
    ]);
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "Chapter 3", content: "C", parentFolder: "f-book", queue: false }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { parentFolder: string; path: string };
    expect(body.parentFolder).toBe("f-book");
    expect(body.path).toBe("/sources/Building the Knowledge Vault");
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

  it("ROLLS BACK a source that was created but not placed in /sources", async () => {
    // The drive reports the new document at the root: containment did not
    // land. That must never be returned as a success.
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async (id: string) => {
          if (id === "drive")
            return driveDoc([
              { id: "src-1", name: "s", documentType: "bai/source", parentFolder: null },
            ]);
          return createdSource;
        }) as never,
        createDocumentInDrive: vi.fn(async () => createdSource) as never,
      } as never),
    });
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "CONTAINMENT_FAILED",
    });
    expect(d.reactorClient.deleteDocuments).toHaveBeenCalledWith(["src-1"]);
    // and it must not have ingested content into a doomed document
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("rolls back when creation itself throws", async () => {
    const d = deps({
      reactorClient: createFakeReactorClient({
        get: vi.fn(async () => driveDoc()) as never,
        createDocumentInDrive: vi.fn(async () => {
          throw new Error("reactor unavailable");
        }) as never,
      } as never),
    });
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C" }),
      ctx,
    );
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "CREATE_FAILED",
    });
    expect(d.reactorClient.deleteDocuments).toHaveBeenCalled();
  });

  it("refuses a misspelt optional field rather than silently ignoring it", async () => {
    // `queu` used to be dropped, so the caller believed they had opted out of
    // queueing and had not.
    const d = deps();
    const res = await createIngestSourceRoute(d)(
      post({ drive: "drive", title: "T", content: "C", queu: false }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "UNKNOWN_FIELD",
    });
    expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
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

  describe("content the reducer would refuse creates NOTHING", () => {
    // Before the fix `executeWrite` linted INGEST_SOURCE only after the create
    // and placement, so each of these answered 400 AND left an empty source in
    // /sources. Observed live on 2026-09-28 with all four inputs.
    it.each([
      ["an RFC 2822 email date", { publishedAt: "Mon, 28 Sep 2026 10:00:00 +0200" }, "LINT_REACTOR"],
      ["a date without a time", { publishedAt: "2026-09-28" }, "LINT_REACTOR"],
      ["an ISO date with an offset", { publishedAt: "2026-09-28T10:00:00+02:00" }, "LINT_REACTOR"],
      ["a literal backslash-n in the content", { content: "line one\\nline two" }, "LINT_CONVENTION"],
    ])("refuses %s before creating anything", async (_name, patch, code) => {
      const d = deps();
      const res = await createIngestSourceRoute(d)(
        post({ drive: "drive", title: "T", content: "C", queue: false, ...patch }),
        ctx,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe(code);
      expect(body.error).toMatch(/^actions\[0\]/);
      expect(d.reactorClient.createDocumentInDrive).not.toHaveBeenCalled();
      expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
    });

    it("accepts an ISO instant in UTC", async () => {
      const d = deps();
      const res = await createIngestSourceRoute(d)(
        post({ drive: "drive", title: "T", content: "C", queue: false, publishedAt: "2026-09-28T08:00:00Z" }),
        ctx,
      );
      expect(res.status).toBe(201);
    });

    it("lets allowLiteralEscapes through, as POST actions does", async () => {
      const d = deps();
      const res = await createIngestSourceRoute(d)(
        post({
          drive: "drive",
          title: "LaTeX notes",
          content: "\\newcommand is a macro",
          queue: false,
          allowLiteralEscapes: true,
        }),
        ctx,
      );
      expect(res.status).toBe(201);
      const exec = d.reactorClient.executeAsync as unknown as {
        mock: { calls: [string, string, { input: { content: string } }[]][] };
      };
      expect(exec.mock.calls[0][2][0].input.content).toBe("\\newcommand is a macro");
    });
  });

  describe("an ingest that fails after the create rolls the empty source back", () => {
    it("rethrows the dispatch failure after deleting the source", async () => {
      const d = deps({
        reactorClient: createFakeReactorClient({
          get: vi.fn(async (id: string) =>
            id === "drive" ? driveDoc([{ id: "src-1", documentType: "bai/source", parentFolder: "f-sources" }]) : createdSource,
          ) as never,
          createDocumentInDrive: vi.fn(async () => createdSource) as never,
          waitForJob: vi.fn(async () => ({
            id: "job-1",
            status: "FAILED",
            error: { message: "reducer exploded" },
          })) as never,
        } as never),
      });
      const res = await createIngestSourceRoute(d)(
        post({ drive: "drive", title: "T", content: "C", queue: false }),
        ctx,
      );
      expect(res.status).toBe(422);
      expect((await res.json()) as { code: string }).toMatchObject({ code: "DISPATCH_FAILED" });
      expect(d.reactorClient.deleteDocuments).toHaveBeenCalledWith(["src-1"]);
    });

    it("rolls back when the reducer rejects INGEST_SOURCE", async () => {
      const d = deps({
        reactorClient: createFakeReactorClient({
          get: vi.fn(async (id: string) =>
            id === "drive" ? driveDoc([{ id: "src-1", documentType: "bai/source", parentFolder: "f-sources" }]) : createdSource,
          ) as never,
          createDocumentInDrive: vi.fn(async () => createdSource) as never,
          getOperations: vi.fn(async () => ({
            results: [
              { index: 0, error: "Source already ingested", action: { id: "uuid-1", type: "INGEST_SOURCE" } },
            ],
          })) as never,
        } as never),
      });
      const res = await createIngestSourceRoute(d)(
        post({ drive: "drive", title: "T", content: "C", queue: false }),
        ctx,
      );
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("INGEST_REJECTED");
      expect(body.error).toContain("Source already ingested");
      expect(body.error).toContain("rolled back");
      expect(d.reactorClient.deleteDocuments).toHaveBeenCalledWith(["src-1"]);
    });

    it("names the stranded id when the rollback itself fails", async () => {
      const d = deps({
        reactorClient: createFakeReactorClient({
          get: vi.fn(async (id: string) =>
            id === "drive" ? driveDoc([{ id: "src-1", documentType: "bai/source", parentFolder: "f-sources" }]) : createdSource,
          ) as never,
          createDocumentInDrive: vi.fn(async () => createdSource) as never,
          waitForJob: vi.fn(async () => ({ id: "job-1", status: "FAILED", error: { message: "boom" } })) as never,
          deleteDocuments: vi.fn(async () => {
            throw new Error("delete refused");
          }) as never,
        } as never),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = await createIngestSourceRoute(d)(
        post({ drive: "drive", title: "T", content: "C", queue: false }),
        ctx,
      );
      errorSpy.mockRestore();
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string; details: { orphaned: string[] }[] };
      expect(body.code).toBe("CREATE_FAILED");
      expect(body.details[0].orphaned).toEqual(["src-1"]);
    });
  });
});
