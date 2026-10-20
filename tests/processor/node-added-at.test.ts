/**
 * `graph_nodes.added_at` is when a document entered the vault — its header's
 * createdAtUtcIso — as opposed to `created_at`, when it was written. An
 * agent-imported note written on 17 September that reached the vault on
 * 15 October must sort by 15 October on the source timeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "../../processors/graph-indexer/migrations.js";
import { createTestDb } from "../helpers/create-test-db.js";
import { makeOp } from "../helpers/make-op.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import type { DB } from "../../processors/graph-indexer/schema.js";

vi.mock("../../processors/graph-indexer/embedder.js", () => ({
  generateEmbedding: () => Promise.resolve(new Array(384).fill(0) as number[]),
}));

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const WRITTEN = "2026-09-17T11:10:22.000Z";

function noteOperation(o: { documentId: string; title: string; timestampUtcMs: string; createdAtUtcIso?: string; index?: number }): OperationWithContext {
  const entry = makeOp({ documentId: o.documentId, documentType: "bai/knowledge-note", actionType: "SET_TITLE", actionInput: { title: o.title }, index: o.index ?? 0 });
  const global = {
    title: o.title,
    description: "",
    noteType: "concept",
    status: "IN_REVIEW",
    content: "",
    topics: [],
    provenance: { author: "knowledge-agent", sourceOrigin: "IMPORT", createdAt: WRITTEN },
  };
  const state = o.createdAtUtcIso ? { global, header: { id: o.documentId, createdAtUtcIso: o.createdAtUtcIso } } : { global };
  return {
    ...entry,
    operation: { ...entry.operation, timestampUtcMs: o.timestampUtcMs },
    context: { ...entry.context, resultingState: JSON.stringify(state) },
  } as OperationWithContext;
}

describe("graph_nodes.added_at: when a document entered the vault", () => {
  let harness: TestDb;
  let processor: InstanceType<typeof GraphIndexerProcessor>;

  beforeEach(async () => {
    harness = await createTestDb();
    processor = new GraphIndexerProcessor(
      "test",
      { branch: ["main"], documentId: ["*"], documentType: ["bai/knowledge-note", "bai/moc"], scope: ["global", "document"] },
      harness.db as unknown as IRelationalDb<DB>,
    );
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const row = (documentId: string) =>
    harness.db.selectFrom("graph_nodes").select(["added_at", "created_at"]).where("document_id", "=", documentId).executeTakeFirstOrThrow();

  it("is the header's creation time, while created_at stays the written date", async () => {
    await processor.onOperations([noteOperation({ documentId: "n", title: "Imported", timestampUtcMs: "2026-10-15T16:27:30.000Z", createdAtUtcIso: "2026-10-15T16:27:29.626Z" })]);
    expect(await row("n")).toEqual({ added_at: "2026-10-15T16:27:29.626Z", created_at: WRITTEN });
  });

  it("is kept when later operations arrive", async () => {
    await processor.onOperations([noteOperation({ documentId: "n", title: "One", timestampUtcMs: "2026-10-15T16:27:30.000Z", createdAtUtcIso: "2026-10-15T16:27:29.626Z" })]);
    await processor.onOperations([noteOperation({ documentId: "n", title: "Two", index: 1, timestampUtcMs: "2026-10-16T09:00:00.000Z", createdAtUtcIso: "2099-01-01T00:00:00.000Z" })]);
    expect((await row("n")).added_at).toBe("2026-10-15T16:27:29.626Z");
  });

  it("is filled at the next operation on a row written before the column existed", async () => {
    await harness.db
      .insertInto("graph_nodes")
      .values({ id: "old", document_id: "old", title: "Old", description: null, note_type: "concept", status: "IN_REVIEW", updated_at: "2026-10-01T00:00:00.000Z", document_type: "bai/knowledge-note" })
      .execute();
    expect((await row("old")).added_at).toBeNull();
    await processor.onOperations([noteOperation({ documentId: "old", title: "Old, edited", timestampUtcMs: "2026-10-16T09:00:00.000Z", createdAtUtcIso: "2026-09-30T08:00:00.000Z" })]);
    expect((await row("old")).added_at).toBe("2026-09-30T08:00:00.000Z");
  });

  it("takes the header's time at the next operation when the migration could only estimate it", async () => {
    await harness.db
      .insertInto("graph_nodes")
      .values({ id: "est", document_id: "est", title: "Est", description: null, note_type: "concept", status: "IN_REVIEW", updated_at: "2026-10-16T00:00:00.000Z", document_type: "bai/knowledge-note", added_at: "2026-10-15T14:20:00.000Z" })
      .execute();
    await processor.onOperations([noteOperation({ documentId: "est", title: "Est, edited", timestampUtcMs: "2026-10-16T09:00:00.000Z", createdAtUtcIso: "2026-10-15T14:19:59.000Z" })]);
    expect((await row("est")).added_at).toBe("2026-10-15T14:19:59.000Z");
  });

  it("stays null when the state carries no header, rather than guessing from the written date", async () => {
    await processor.onOperations([noteOperation({ documentId: "bare", title: "Bare", timestampUtcMs: "2026-10-16T09:00:00.000Z" })]);
    expect((await row("bare")).added_at).toBeNull();
  });

  it("reaches the read side as addedAt", async () => {
    await processor.onOperations([noteOperation({ documentId: "n", title: "Imported", timestampUtcMs: "2026-10-15T16:27:30.000Z", createdAtUtcIso: "2026-10-15T16:27:29.626Z" })]);
    const [node] = await createGraphQuery(harness.db).allNodes();
    expect(node).toMatchObject({ addedAt: "2026-10-15T16:27:29.626Z", createdAt: WRITTEN });
  });

  it("survives running the migration again", async () => {
    await processor.onOperations([noteOperation({ documentId: "n", title: "Imported", timestampUtcMs: "2026-10-15T16:27:30.000Z", createdAtUtcIso: "2026-10-15T16:27:29.626Z" })]);
    await up(harness.db as unknown as IRelationalDb<DB>);
    expect((await row("n")).added_at).toBe("2026-10-15T16:27:29.626Z");
  });
});
