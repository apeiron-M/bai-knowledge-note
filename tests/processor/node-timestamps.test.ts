/**
 * `graph_nodes.updated_at` must carry the time the DOCUMENT changed, not
 * the time the indexer happened to write the row.
 *
 * Regression context: the upsert used `new Date().toISOString()`, so every
 * reindex rewrote all rows with one identical instant. On the live vault
 * that flattened all 1,502 nodes to a single timestamp, which silently
 * broke `knowledgeGraphRecent` ordering and left STALE_NOTES with nothing
 * but DRAFT counts to work from.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { createTestDb } from "../helpers/create-test-db.js";
import { makeOp } from "../helpers/make-op.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import type { DB } from "../../processors/graph-indexer/schema.js";

// Under vitest `typeof window === "undefined"`, so the processor takes its
// server path and embeds each indexed note — which would pull in the
// transformers runtime. Stub the model instead of shimming `window`:
// defining `window` makes PGlite take its browser code path and fail.
vi.mock("../../processors/graph-indexer/embedder.js", () => ({
  generateEmbedding: () => Promise.resolve(new Array(384).fill(0) as number[]),
}));

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

function noteOperation(options: {
  documentId: string;
  title: string;
  timestampUtcMs?: string;
  index?: number;
}): OperationWithContext {
  const entry = makeOp({
    documentId: options.documentId,
    documentType: "bai/knowledge-note",
    actionType: "SET_TITLE",
    actionInput: { title: options.title },
    index: options.index ?? 0,
    resultingState: {
      title: options.title,
      description: `${options.title} description`,
      noteType: "concept",
      status: "CANONICAL",
      content: `${options.title} body`,
      topics: [],
      provenance: { author: "test", sourceOrigin: "DERIVED" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });
  // `makeOp` stamps "now"; these tests are precisely about the operation's
  // own timestamp being what reaches the row.
  return {
    ...entry,
    operation: { ...entry.operation, timestampUtcMs: options.timestampUtcMs },
  } as OperationWithContext;
}

describe("graph_nodes.updated_at reflects document edit time", () => {
  let harness: TestDb;
  let processor: InstanceType<typeof GraphIndexerProcessor>;

  beforeEach(async () => {
    harness = await createTestDb();
    processor = new GraphIndexerProcessor(
      "test",
      {
        branch: ["main"],
        documentId: ["*"],
        documentType: ["bai/knowledge-note", "bai/moc"],
        scope: ["global", "document"],
      },
      harness.db as unknown as IRelationalDb<DB>,
    );
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function updatedAtFor(documentId: string): Promise<string> {
    const row = await harness.db
      .selectFrom("graph_nodes")
      .select(["updated_at"])
      .where("document_id", "=", documentId)
      .executeTakeFirstOrThrow();
    return String(row.updated_at);
  }

  it("stamps the operation timestamp, not wall-clock time", async () => {
    const edited = "2026-01-15T10:00:00.000Z";
    await processor.onOperations([
      noteOperation({ documentId: "note-a", title: "Note A", timestampUtcMs: edited }),
    ]);
    expect(await updatedAtFor("note-a")).toBe(edited);
  });

  it("keeps distinct edit times distinct rather than flattening them", async () => {
    await processor.onOperations([
      noteOperation({
        documentId: "note-old",
        title: "Old",
        timestampUtcMs: "2026-01-01T00:00:00.000Z",
      }),
      noteOperation({
        documentId: "note-new",
        title: "New",
        timestampUtcMs: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    // Assert the exact values, not merely that they differ: two rows written
    // in one batch from wall-clock time also differ (by microseconds), so a
    // difference alone would not catch the regression.
    const older = await updatedAtFor("note-old");
    const newer = await updatedAtFor("note-new");
    expect(older).toBe("2026-01-01T00:00:00.000Z");
    expect(newer).toBe("2026-06-01T00:00:00.000Z");
    expect(new Date(older).getTime()).toBeLessThan(new Date(newer).getTime());
  });

  it("re-indexing an unchanged document does not advance updated_at", async () => {
    const edited = "2026-02-02T12:00:00.000Z";
    const op = noteOperation({
      documentId: "note-stable",
      title: "Stable",
      timestampUtcMs: edited,
    });
    await processor.onOperations([op]);
    await processor.onOperations([op]);
    expect(await updatedAtFor("note-stable")).toBe(edited);
  });

  it("advances updated_at when a later edit arrives", async () => {
    await processor.onOperations([
      noteOperation({
        documentId: "note-b",
        title: "First",
        timestampUtcMs: "2026-03-01T00:00:00.000Z",
      }),
    ]);
    await processor.onOperations([
      noteOperation({
        documentId: "note-b",
        title: "Second",
        timestampUtcMs: "2026-03-09T00:00:00.000Z",
        index: 1,
      }),
    ]);
    expect(await updatedAtFor("note-b")).toBe("2026-03-09T00:00:00.000Z");
  });

  it("falls back to a valid timestamp when the operation carries none", async () => {
    await processor.onOperations([
      noteOperation({ documentId: "note-c", title: "No timestamp" }),
    ]);
    const value = await updatedAtFor("note-c");
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
  });
});
