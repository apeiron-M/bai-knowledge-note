/**
 * The processor indexes ITS drive, and only its drive.
 *
 * The processor manager has no drive dimension, so every instance of the
 * graph-indexer receives every drive's operations. Two gates keep the
 * namespaces honest:
 *
 *   1. `judgeDrive` — the factory creates an instance only for drives that
 *      are knowledge vaults (preferredEditor `knowledge-vault`, or a
 *      `bai/vault-config` node when the header is silent);
 *   2. `DriveMembership` — inside an instance, operations are indexed only
 *      when the document belongs to the drive, learned from the drive's
 *      node list plus the containment signals that flow through the same
 *      processor.
 *
 * Both fail OPEN when the drive cannot be read: a vault that loses its index
 * is worse than a few foreign rows a reindex will prune.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import { judgeDrive } from "../../processors/graph-indexer/factory.js";
import {
  DriveMembership,
  MEMBERSHIP_REFRESH_THROTTLE_MS,
} from "../../processors/graph-indexer/membership.js";

const T = "2026-09-02T10:00:00.000Z";
const OURS = "drive-ours";
const THEIRS = "drive-theirs";

function driveDoc(nodeIds: string[]) {
  return {
    header: { id: OURS, meta: { preferredEditor: "knowledge-vault" } },
    state: {
      global: {
        nodes: nodeIds.map((id) => ({
          id,
          kind: "file",
          documentType: "bai/knowledge-note",
        })),
      },
    },
  };
}

describe("judgeDrive()", () => {
  it("indexes a drive whose app is knowledge-vault, whatever it holds", () => {
    expect(judgeDrive("d", "knowledge-vault", null).index).toBe(true);
    expect(judgeDrive("d", "knowledge-vault", []).index).toBe(true);
  });

  it("skips drives that belong to another app", () => {
    const v = judgeDrive("d", "invoice-app", null);
    expect(v.index).toBe(false);
    expect(v.reason).toContain("invoice-app");
  });

  it("skips Vetra system drives by id, even if they claim the app", () => {
    expect(judgeDrive("vetra-abc", "knowledge-vault", null).index).toBe(false);
    expect(judgeDrive("preview-abc", undefined, null).index).toBe(false);
  });

  it("with no app, indexes only drives that hold a bai/vault-config", () => {
    expect(
      judgeDrive("d", undefined, [{ documentType: "bai/vault-config" }]).index,
    ).toBe(true);
    // The legacy `powerhouse` drive and the CLI's e2e-* leftovers: no app,
    // no vault-config — these used to get a namespace each.
    expect(judgeDrive("powerhouse", null, []).index).toBe(false);
    expect(
      judgeDrive("e2e-apply-1", undefined, [{ documentType: "bai/knowledge-note" }]).index,
    ).toBe(false);
  });

  it("fails open when the drive could not be read", () => {
    const v = judgeDrive("d", undefined, null);
    expect(v.index).toBe(true);
    expect(v.reason).toContain("failing open");
  });
});

describe("DriveMembership", () => {
  it("is open until the drive has been read, then exact", async () => {
    const m = new DriveMembership({ driveId: OURS });
    expect(m.known).toBe(false);
    expect(await m.has("anything")).toBe(true);

    const client = { get: vi.fn(() => Promise.resolve(driveDoc(["a", "b"]))) };
    const gated = new DriveMembership({ driveId: OURS, client });
    expect(await gated.has("a")).toBe(true);
    expect(gated.known).toBe(true);
    expect(await gated.has(OURS)).toBe(true);
  });

  it("re-reads the drive at most once per throttle window on a miss", async () => {
    let now = 1_000_000;
    const client = { get: vi.fn(() => Promise.resolve(driveDoc(["a"]))) };
    const m = new DriveMembership({ driveId: OURS, client, now: () => now });
    expect(await m.has("a")).toBe(true); // first read
    expect(await m.has("x")).toBe(false); // miss, within throttle → no read
    expect(await m.has("y")).toBe(false);
    expect(client.get).toHaveBeenCalledTimes(1);

    now += MEMBERSHIP_REFRESH_THROTTLE_MS;
    client.get.mockImplementation(() => Promise.resolve(driveDoc(["a", "x"])));
    expect(await m.has("x")).toBe(true); // miss → re-read → found
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("learns from the containment edge and the drive's node operations", async () => {
    const client = { get: vi.fn(() => Promise.resolve(driveDoc(["a"]))) };
    const m = new DriveMembership({ driveId: OURS, client });
    await m.has("a");

    // Reactor containment edge, dispatched on the NEW document's job.
    m.observe({
      documentId: "n1",
      actionType: "ADD_RELATIONSHIP",
      input: { sourceId: OURS, targetId: "n1", relationshipType: "child" },
    });
    // Another drive's containment edge is not ours.
    m.observe({
      documentId: "n2",
      actionType: "ADD_RELATIONSHIP",
      input: { sourceId: THEIRS, targetId: "n2", relationshipType: "child" },
    });
    // A knowledge edge is never a membership signal, whatever the source.
    m.observe({
      documentId: "n3",
      actionType: "ADD_RELATIONSHIP",
      input: { sourceId: OURS, targetId: "n3", relationshipType: "RELATES_TO" },
    });
    m.observe({ documentId: OURS, actionType: "ADD_FILE", input: { id: "n4" } });
    m.observe({ documentId: THEIRS, actionType: "ADD_FILE", input: { id: "n5" } });
    m.observe({ documentId: OURS, actionType: "DELETE_NODE", input: { id: "a" } });

    expect(await m.has("n1")).toBe(true);
    expect(await m.has("n4")).toBe(true);
    expect(await m.has("n2")).toBe(false);
    expect(await m.has("n3")).toBe(false);
    expect(await m.has("n5")).toBe(false);
    expect(await m.has("a")).toBe(false);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("stays open (and quiet after one warning) when the read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = { get: vi.fn(() => Promise.reject(new Error("boom"))) };
    let now = 0;
    const m = new DriveMembership({ driveId: OURS, client, now: () => now });
    expect(await m.has("x")).toBe(true);
    now += MEMBERSHIP_REFRESH_THROTTLE_MS;
    expect(await m.has("y")).toBe(true);
    expect(m.known).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("GraphIndexerProcessor with a drive-membership gate", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createGraphQuery>;
  let processor: GraphIndexerProcessor;
  const client = { get: vi.fn(() => Promise.resolve(driveDoc(["ours-1", "ours-moc"]))) };

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as unknown as IRelationalDb<DB>);
    query = createGraphQuery(db);
    processor = new GraphIndexerProcessor(
      "membership_ns",
      { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>,
      { embed: false, membership: { driveId: OURS, client } },
    );
  });

  afterAll(async () => {
    await down(db as unknown as IRelationalDb<DB>);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("graph_operations").execute();
    await db.deleteFrom("graph_topics").execute();
    await db.deleteFrom("graph_edges").execute();
    await db.deleteFrom("graph_nodes").execute();
  });

  function op(
    documentId: string,
    documentType: string,
    index: number,
    type: string,
    input: Record<string, unknown>,
    resultingGlobal?: Record<string, unknown>,
    scope: "global" | "document" = "global",
  ): OperationWithContext {
    return {
      operation: {
        index,
        skip: 0,
        hash: `h${index}`,
        timestampUtcMs: T,
        id: `${documentId}-${index}`,
        action: { id: `act-${documentId}-${index}`, type, scope, timestampUtcMs: T, input },
      },
      context: {
        documentId,
        documentType,
        scope,
        branch: "main",
        ordinal: index,
        resultingState: resultingGlobal ? JSON.stringify({ global: resultingGlobal }) : undefined,
      },
    } as unknown as OperationWithContext;
  }

  const noteState = (title: string) => ({
    title,
    description: "d",
    noteType: "concept",
    status: "DRAFT",
    topics: [],
  });

  it("indexes our documents and ignores another drive's, in one batch", async () => {
    await processor.onOperations([
      op("ours-1", "bai/knowledge-note", 0, "SET_TITLE", { title: "Ours" }, noteState("Ours")),
      op("theirs-1", "bai/knowledge-note", 0, "SET_TITLE", { title: "Theirs" }, noteState("Theirs")),
    ]);
    expect(await query.nodeByDocumentId("ours-1")).toMatchObject({ title: "Ours" });
    expect(await query.nodeByDocumentId("theirs-1")).toBeUndefined();
    const ops = await db.selectFrom("graph_operations").select("document_id").execute();
    expect(ops.map((o) => o.document_id)).toEqual(["ours-1"]);
    expect(processor.membershipGated).toBe(true);
  });

  it("admits a brand-new document through the containment edge in the same batch", async () => {
    // Order as the reactor emits it: creation, initial state, containment
    // edge — all before the drive's ADD_FILE.
    await processor.onOperations([
      op("ours-2", "bai/knowledge-note", 0, "CREATE_DOCUMENT", { documentId: "ours-2" }),
      op("ours-2", "bai/knowledge-note", 1, "UPGRADE_DOCUMENT", {}, noteState("Imported whole")),
      op("ours-2", "bai/knowledge-note", 2, "ADD_RELATIONSHIP",
        { sourceId: OURS, targetId: "ours-2", relationshipType: "child" }, undefined, "document"),
      op(OURS, "powerhouse/document-drive", 7, "ADD_FILE",
        { id: "ours-2", name: "n", documentType: "bai/knowledge-note" }),
    ]);
    expect(await query.nodeByDocumentId("ours-2")).toMatchObject({ title: "Imported whole" });
  });

  it("gates relationship actions on their source and drive deletions on the drive", async () => {
    await processor.onOperations([
      op("ours-1", "bai/knowledge-note", 0, "SET_TITLE", { title: "A" }, noteState("A")),
      op("ours-moc", "bai/moc", 0, "CREATE_MOC", { title: "M" },
        { title: "M", tier: "TOPIC", coreIdeas: [], childRefs: [], tensions: [], openQuestions: [] }),
    ]);
    await processor.onOperations([
      op("ours-moc", "bai/moc", 1, "ADD_RELATIONSHIP",
        { sourceId: "ours-moc", targetId: "ours-1", relationshipType: "CORE_IDEA" }, undefined, "document"),
      op("theirs-moc", "bai/moc", 1, "ADD_RELATIONSHIP",
        { sourceId: "theirs-moc", targetId: "ours-1", relationshipType: "CORE_IDEA" }, undefined, "document"),
    ]);
    const back = await query.backlinks("ours-1");
    expect(back.map((e) => e.sourceDocumentId)).toEqual(["ours-moc"]);

    // Another drive deleting a node with our id must not touch our index.
    await processor.onOperations([
      op(THEIRS, "powerhouse/document-drive", 3, "DELETE_NODE", { id: "ours-1" }),
    ]);
    expect(await query.nodeByDocumentId("ours-1")).toBeDefined();
    await processor.onOperations([
      op(OURS, "powerhouse/document-drive", 8, "DELETE_NODE", { id: "ours-1" }),
    ]);
    expect(await query.nodeByDocumentId("ours-1")).toBeUndefined();
  });
});
