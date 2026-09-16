import { describe, expect, it, vi } from "vitest";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "./deps.js";
import { folderPaths, resolveVaultFolder, VAULT_FOLDERS } from "./vault-folders.js";

const nodes = [
  { id: "f-knowledge", name: "knowledge", kind: "folder" },
  { id: "f-notes", name: "notes", kind: "folder", parentFolder: "f-knowledge" },
  { id: "f-sources", name: "sources", kind: "folder" },
  { id: "f-ops", name: "ops", kind: "folder" },
  { id: "f-ops-queue", name: "queue", kind: "folder", parentFolder: "f-ops" },
  { id: "f-projects", name: "projects", kind: "folder" },
  // A file that shares a folder's name must not be mistaken for one.
  {
    id: "d-1",
    name: "sources",
    kind: "file",
    documentType: "bai/knowledge-note",
    parentFolder: "f-notes",
  },
];

function deps(driveNodes: unknown[] = nodes): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async () => ({
        header: { id: "drive", documentType: "powerhouse/document-drive" },
        state: { global: { nodes: driveNodes } },
      })) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async () => "drive") as never,
    authorization: {
      canRead: vi.fn(async () => true),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date("2026-09-14T12:00:00.000Z"),
    uuid: () => "uuid-1",
  };
}

describe("folderPaths", () => {
  it("builds absolute paths and ignores files", () => {
    const paths = folderPaths(nodes);
    expect(paths.get("/knowledge/notes")).toBe("f-notes");
    expect(paths.get("/sources")).toBe("f-sources");
    expect(paths.get("/ops/queue")).toBe("f-ops-queue");
    // the file named "sources" under /knowledge/notes is not a folder
    expect(paths.get("/knowledge/notes/sources")).toBeUndefined();
  });

  it("does not loop on a cyclic parent reference", () => {
    const cyclic = [
      { id: "a", name: "a", kind: "folder", parentFolder: "b" },
      { id: "b", name: "b", kind: "folder", parentFolder: "a" },
    ];
    expect(() => folderPaths(cyclic)).not.toThrow();
  });
});

describe("resolveVaultFolder", () => {
  it("places each supported type in its own folder", async () => {
    const d = deps();
    await expect(resolveVaultFolder(d, "drive", "bai/source")).resolves.toBe("f-sources");
    await expect(resolveVaultFolder(d, "drive", "bai/knowledge-note")).resolves.toBe("f-notes");
    await expect(resolveVaultFolder(d, "drive", "bai/moc")).resolves.toBe("f-knowledge");
    await expect(resolveVaultFolder(d, "drive", "bai/tension")).resolves.toBe("f-ops");
    await expect(resolveVaultFolder(d, "drive", "bai/wbs")).resolves.toBe("f-projects");
  });

  it("covers every declared type", async () => {
    const d = deps();
    for (const type of Object.keys(VAULT_FOLDERS)) {
      await expect(resolveVaultFolder(d, "drive", type)).resolves.toMatch(/^f-/);
    }
  });

  it("refuses an unknown document type", async () => {
    await expect(
      resolveVaultFolder(deps(), "drive", "bai/not-a-thing"),
    ).rejects.toMatchObject({ status: 400, code: "UNSUPPORTED_DOCUMENT_TYPE" });
  });

  it("refuses rather than falling back to the drive root", async () => {
    // A drive with no /sources folder must 400, never place at root.
    const withoutSources = nodes.filter((n) => n.id !== "f-sources");
    await expect(
      resolveVaultFolder(deps(withoutSources), "drive", "bai/source"),
    ).rejects.toMatchObject({ status: 400, code: "FOLDER_UNRESOLVED" });
  });
});

describe("placing a source in a subfolder of /sources", () => {
  // A book split into chapters: one folder under /sources holding them all.
  const withBook = [
    ...nodes,
    { id: "f-book", name: "Building the Knowledge Vault", kind: "folder", parentFolder: "f-sources" },
    { id: "f-book-part", name: "Part II", kind: "folder", parentFolder: "f-book" },
  ];

  it("accepts the canonical folder itself", async () => {
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "f-sources"),
    ).resolves.toBe("f-sources");
  });

  it("accepts a folder nested under it, at any depth", async () => {
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "f-book"),
    ).resolves.toBe("f-book");
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "f-book-part"),
    ).resolves.toBe("f-book-part");
  });

  it("still defaults to /sources when none is asked for", async () => {
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source"),
    ).resolves.toBe("f-sources");
  });

  it("refuses a folder that belongs to another part of the vault", async () => {
    // The guardrail: sources must not scatter across the drive.
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "f-notes"),
    ).rejects.toMatchObject({ status: 400, code: "FOLDER_OUTSIDE_VAULT_PATH" });
  });

  it("refuses an id that is a document, not a folder", async () => {
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "d-1"),
    ).rejects.toMatchObject({ status: 400, code: "FOLDER_OUTSIDE_VAULT_PATH" });
  });

  it("refuses an id the drive does not hold at all", async () => {
    await expect(
      resolveVaultFolder(deps(withBook), "drive", "bai/source", "nope"),
    ).rejects.toMatchObject({ status: 400, code: "FOLDER_OUTSIDE_VAULT_PATH" });
  });
});
