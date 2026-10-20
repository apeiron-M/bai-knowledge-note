import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createSourceFolderRoute } from "./source-folders.js";

const ctx = {
  user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" },
  params: {},
  authEnabled: true,
  signal: undefined,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const BASE = [
  { id: "f-sources", name: "sources", kind: "folder" },
  { id: "f-knowledge", name: "knowledge", kind: "folder" },
];

/**
 * `nodes` is what the drive holds BEFORE the dispatch; `after` what it holds
 * once the folder exists. The route reads the drive twice — once to look for
 * an existing folder, once to verify placement — and a fixture that answered
 * identically both times would hide which read it was using.
 */
function deps(
  nodes: unknown[] = BASE,
  overrides: Partial<HttpRouteDeps> = {},
  after?: unknown[],
): HttpRouteDeps {
  let reads = 0;
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async () => ({
        header: { id: "drive", documentType: "powerhouse/document-drive" },
        // resolveVaultFolder reads first, then the existence check, then the
        // verification — so `after` applies from the third read on.
        state: { global: { nodes: after && ++reads >= 3 ? after : nodes } },
      })) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async (id: string) => id) as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-16T12:00:00.000Z"),
    uuid: () => "new-folder-id",
    ...overrides,
  };
}

const post = (body: unknown) =>
  new Request("http://h/sources/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST sources/folders", () => {
  it("creates a folder under /sources and returns its id", async () => {
    const d = deps(BASE, {}, [
      ...BASE,
      { id: "new-folder-id", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-sources" },
    ]);
    const res = await createSourceFolderRoute(d)(
      post({ drive: "drive", name: "Building the Knowledge Vault" }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: "new-folder-id",
      name: "Building the Knowledge Vault",
      path: "/sources/Building the Knowledge Vault",
      created: true,
    });
    const exec = d.reactorClient.executeAsync as unknown as {
      mock: { calls: [string, string, { type: string; input: Record<string, unknown> }[]][] };
    };
    const [target, , actions] = exec.mock.calls[0];
    expect(target).toBe("drive");
    expect(actions[0].type).toBe("ADD_FOLDER");
    expect(actions[0].input).toMatchObject({
      id: "new-folder-id",
      name: "Building the Knowledge Vault",
      parentFolder: "f-sources",
    });
  });

  it("returns the existing folder instead of making a second one", async () => {
    // Idempotent on name: the seed skill re-runs, and two folders called
    // "Building the Knowledge Vault" is worse than a no-op.
    const d = deps([
      ...BASE,
      { id: "f-book", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-sources" },
    ]);
    const res = await createSourceFolderRoute(d)(
      post({ drive: "drive", name: "Building the Knowledge Vault" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "f-book", created: false });
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("does not mistake a same-named folder elsewhere in the drive for its own", async () => {
    const elsewhere = [
      ...BASE,
      { id: "f-elsewhere", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-knowledge" },
    ];
    const d = deps(elsewhere, {}, [
      ...elsewhere,
      { id: "new-folder-id", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-sources" },
    ]);
    const res = await createSourceFolderRoute(d)(
      post({ drive: "drive", name: "Building the Knowledge Vault" }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "new-folder-id" });
  });

  it("requires a drive and a non-empty name", async () => {
    const d = deps();
    for (const body of [{ drive: "drive" }, { name: "x" }, { drive: "drive", name: "   " }]) {
      const res = await createSourceFolderRoute(d)(post(body), ctx);
      expect(res.status).toBe(400);
    }
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("refuses a name containing a path separator", async () => {
    // Folder names are one segment; a slash would make `path` a lie.
    const res = await createSourceFolderRoute(deps())(
      post({ drive: "drive", name: "book/chapter" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("refuses when the drive has no /sources folder", async () => {
    const res = await createSourceFolderRoute(deps([{ id: "f-knowledge", name: "knowledge", kind: "folder" }]))(
      post({ drive: "drive", name: "A book" }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "FOLDER_UNRESOLVED" });
  });

  it("returns 403 when the caller cannot write the drive", async () => {
    const d = deps();
    d.authorization.canWrite = vi.fn(async () => false);
    const res = await createSourceFolderRoute(d)(
      post({ drive: "drive", name: "A book" }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(d.reactorClient.executeAsync).not.toHaveBeenCalled();
  });

  it("fails loudly when the folder does not appear after the dispatch", async () => {
    // The drive read back still lacks it: report rather than hand back an id
    // that places nothing.
    const d = deps(BASE);
    const res = await createSourceFolderRoute(d)(
      post({ drive: "drive", name: "A book" }),
      ctx,
    );
    expect(res.status).toBe(502);
  });
});
