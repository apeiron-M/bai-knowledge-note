import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/helpers/create-test-db.js";
import { createGraphQuery } from "../../../processors/graph-indexer/query.js";
import { SOURCE_ROW_VERSION } from "../../../processors/graph-indexer/source-timeline.js";
import { loadDriveChanges, sourceFolderPaths } from "./changes-scope.js";
import type * as DbModule from "./db.js";
import type { GraphSubgraph } from "./db.js";

let harness: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("./db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getQuery: () => createGraphQuery(harness.db),
}));

const TREE = [
  { id: "f-sources", kind: "folder", name: "sources", parentFolder: null },
  { id: "f-ph", kind: "folder", name: "powerhouse", parentFolder: "f-sources" },
  { id: "f-docs", kind: "folder", name: "docs", parentFolder: "f-ph" },
  { id: "s-deep", kind: "file", documentType: "bai/source", parentFolder: "f-docs" },
  { id: "s-root", kind: "file", documentType: "bai/source", parentFolder: "f-sources" },
  { id: "s-loose", kind: "file", documentType: "bai/source", parentFolder: null },
  { id: "n1", kind: "file", documentType: "bai/knowledge-note", parentFolder: "f-ph" },
];

describe("sourceFolderPaths", () => {
  it("gives each source in a folder the folder's path from the drive root", () => {
    expect(sourceFolderPaths(TREE)).toEqual(
      new Map([
        ["s-deep", "/sources/powerhouse/docs"],
        ["s-root", "/sources"],
      ]),
    );
  });
});

describe("loadDriveChanges: source folders", () => {
  beforeEach(async () => {
    harness = await createTestDb();
    await harness.db
      .insertInto("graph_sources")
      .values({ document_id: "s-deep", row_json: JSON.stringify({ id: "s-deep", title: "Guide", claimIds: [], addedAt: "2026-11-03T00:00:00.000Z" }), revision: 1, version: SOURCE_ROW_VERSION, updated_at: "2026-11-03T00:00:00.000Z" })
      .execute();
    await harness.db
      .insertInto("graph_operations")
      .values({ id: "s-deep-0", document_id: "s-deep", document_type: "bai/source", operation_type: "INGEST_SOURCE", timestamp: "2026-11-03T01:00:00.000Z", index: 0, scope: "global", summary: null, input_json: '{"title":"Guide","content":"x"}', signer_address: null, signer_app: null, signer_key: null, signature: null })
      .execute();
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("groups a source with no grouped notes under its folder, read from the drive tree", async () => {
    const get = vi.fn(async () => ({ state: { global: { nodes: TREE } } }));
    const subgraph = { readClient: { get } } as unknown as GraphSubgraph;
    const d = await loadDriveChanges(subgraph, "drive", { since: "2026-11-03", until: "2026-11-03" });
    expect(get).toHaveBeenCalledWith("drive");
    expect(d.groups.map((g) => [g.kind, g.title])).toEqual([["folder", "/sources/powerhouse/docs"]]);
  });

  it("still answers, unplaced, when the drive cannot be read", async () => {
    const subgraph = { readClient: { get: vi.fn(async () => Promise.reject(new Error("down"))) } } as unknown as GraphSubgraph;
    const d = await loadDriveChanges(subgraph, "drive", { since: "2026-11-03", until: "2026-11-03" });
    expect(d.groups.map((g) => g.kind)).toEqual(["unplaced"]);
  });
});
