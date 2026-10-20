import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createNotesRoute } from "./create.js";

const ctx = {
  user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const FOLDERS = [
  { id: "f-knowledge", name: "knowledge", kind: "folder" },
  { id: "f-notes", name: "notes", kind: "folder", parentFolder: "f-knowledge" },
];

const noteDoc = (id: string) => ({
  header: { id, documentType: "bai/knowledge-note", name: "", revision: { document: 2 } },
  state: { global: { status: "DRAFT" } },
});

/** `contained` controls whether the drive reports the new nodes as placed. */
function deps(
  overrides: Partial<HttpRouteDeps> = {},
  opts: { contained?: boolean; ids?: string[] } = {},
): HttpRouteDeps {
  const ids = opts.ids ?? ["n1", "n2"];
  const contained = opts.contained !== false;
  let made = 0;
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async (id: string) => {
        if (id === "drive") {
          return {
            header: { id: "drive", documentType: "powerhouse/document-drive" },
            state: {
              global: {
                nodes: [
                  ...FOLDERS,
                  ...(contained
                    ? ids.map((n, i) => ({
                        id: n,
                        name: `note-${i + 1}`,
                        documentType: "bai/knowledge-note",
                        parentFolder: "f-notes",
                      }))
                    : []),
                ],
              },
            },
          };
        }
        return noteDoc(id);
      }) as never,
      create: vi.fn(async () => noteDoc(ids[made++])) as never,
      getOperations: vi.fn(async () => ({
        results: [{ index: 0, error: null, action: { id: "uuid-1", type: "SET_TITLE" } }],
      })) as never,
      getDocumentModelModule: vi.fn(async () => ({
        utils: {
          createDocument: () => ({
            header: { id: `draft-${made}`, documentType: "bai/knowledge-note", name: "", revision: {} },
            state: { global: { status: "DRAFT" } },
          }),
        },
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
  new Request("http://h/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const titleAction = (t: string) => ({
  type: "SET_TITLE",
  input: { title: t, updatedAt: "2026-09-14T12:00:00.000Z" },
});

describe("POST notes", () => {
  it("creates, contains in one dispatch, and populates", async () => {
    const d = deps();
    const res = await createNotesRoute(d)(
      post({
        drive: "drive",
        notes: [
          { name: "note-1", actions: [titleAction("One")] },
          { name: "note-2", actions: [titleAction("Two")] },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      parentFolder: string;
      notes: { id: string; parentFolder: string; path: string; readBack: string }[];
    };
    expect(body.parentFolder).toBe("f-notes");
    expect(body.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(body.notes.every((n) => n.path === "/knowledge/notes")).toBe(true);

    // The point of the route: ONE containment dispatch for the whole batch.
    const exec = d.reactorClient.executeAsync as unknown as {
      mock: { calls: [string, string, { type: string }[]][] };
    };
    const addFileCalls = exec.mock.calls.filter(
      (c) => c[0] === "drive" && c[2].every((a) => a.type === "ADD_FILE"),
    );
    expect(addFileCalls).toHaveLength(1);
    expect(addFileCalls[0][2]).toHaveLength(2);
  });

  it("ROLLS BACK when containment does not land, leaving no orphans", async () => {
    const d = deps({}, { contained: false });
    const res = await createNotesRoute(d)(
      post({ drive: "drive", notes: [{ name: "note-1" }, { name: "note-2" }] }),
      ctx,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; details?: unknown[] };
    expect(body.code).toBe("CONTAINMENT_FAILED");
    // every created document deleted
    expect(d.reactorClient.deleteDocuments).toHaveBeenCalledWith(["n1", "n2"]);
    // no `orphaned` detail means the rollback itself succeeded
    expect(body.details).toBeUndefined();
  });

  it("reports the stranded ids when the rollback ITSELF fails", async () => {
    const d = deps({}, { contained: false });
    (d.reactorClient.deleteDocuments as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error("delete unavailable"));
    const res = await createNotesRoute(d)(
      post({ drive: "drive", notes: [{ name: "note-1" }] }),
      ctx,
    );
    const body = (await res.json()) as {
      error: string;
      details: { orphaned: string[] }[];
    };
    // Never claim a clean rollback we did not achieve.
    expect(body.error).toContain("Rollback INCOMPLETE");
    expect(body.details[0].orphaned).toContain("n1");
  });

  it("rolls back documents already created when a later create fails", async () => {
    const d = deps();
    let n = 0;
    (d.reactorClient.create as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation(async () => {
        if (n++ === 1) throw new Error("boom");
        return noteDoc("n1");
      });
    const res = await createNotesRoute(d)(
      post({ drive: "drive", notes: [{ name: "note-1" }, { name: "note-2" }] }),
      ctx,
    );
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "CREATE_FAILED" });
    expect(d.reactorClient.deleteDocuments).toHaveBeenCalledWith(["n1"]);
  });

  it("lints every note up front and creates nothing on a bad action", async () => {
    const d = deps();
    const res = await createNotesRoute(d)(
      post({
        drive: "drive",
        notes: [
          { name: "note-1", actions: [titleAction("fine")] },
          { name: "note-2", actions: [{ type: "NOT_A_REAL_ACTION", input: {} }] },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { path: string }[] };
    expect(body.details[0].path).toContain("notes[1]");
    // a 400 means nothing was dispatched
    expect(d.reactorClient.create).not.toHaveBeenCalled();
    expect(d.reactorClient.deleteDocuments).not.toHaveBeenCalled();
  });

  it("refuses parentFolder, duplicates, an empty batch and an oversized batch", async () => {
    const d = deps();
    const bodies = [
      { drive: "drive", notes: [{ name: "a" }], parentFolder: "f-notes" },
      { drive: "drive", notes: [{ name: "dupe" }, { name: "dupe" }] },
      { drive: "drive", notes: [] },
      { drive: "drive", notes: Array.from({ length: 26 }, (_, i) => ({ name: `n${i}` })) },
    ];
    for (const b of bodies) {
      const res = await createNotesRoute(d)(post(b), ctx);
      expect(res.status).toBe(400);
    }
    expect(d.reactorClient.create).not.toHaveBeenCalled();
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
    const res = await createNotesRoute(d)(
      post({ drive: "drive", notes: [{ name: "note-1" }] }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(d.reactorClient.create).not.toHaveBeenCalled();
  });
});
