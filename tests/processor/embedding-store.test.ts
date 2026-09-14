import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { DB } from "../../processors/graph-indexer/schema.js";
import {
  getEmbedding,
  searchSimilar,
  upsertEmbedding,
} from "../../processors/graph-indexer/embedding-store.js";
import { createTestDb } from "../helpers/create-test-db.js";

let db: Kysely<DB>;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
});
afterAll(async () => {
  await cleanup();
});

const vec = (fill: number) => Array.from({ length: 8 }, () => fill);

describe("embedding store round trip", () => {
  it("writes and reads an embedding back", async () => {
    await upsertEmbedding(db, "doc-a", vec(0.5), "hash-a");
    expect(await getEmbedding(db, "doc-a")).toEqual(vec(0.5));
  });

  it("updates in place rather than duplicating", async () => {
    await upsertEmbedding(db, "doc-b", vec(0.1), "hash-1");
    await upsertEmbedding(db, "doc-b", vec(0.9), "hash-2");
    expect(await getEmbedding(db, "doc-b")).toEqual(vec(0.9));
    const rows = await db
      .selectFrom("note_embeddings")
      .select("document_id")
      .where("document_id", "=", "doc-b")
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("finds a written embedding by similarity", async () => {
    await upsertEmbedding(db, "doc-c", vec(1), "hash-c");
    const hits = await searchSimilar(db, vec(1), 5);
    expect(hits.map((h) => h.documentId)).toContain("doc-c");
  });
});

describe("the namespaced query builder cannot write", () => {
  // `RelationalDbProcessor.query` returns a READ-ONLY builder, but `getDb`
  // used to cast it to `Kysely<DB>`, so handing it to a write path
  // type-checked and then threw `db.insertInto is not a function` in
  // production. That is how the (now removed) knowledgeGraphUpsertEmbedding
  // mutation shipped broken. The read/write split in embedding-store.ts makes
  // the same mistake a compile error; this asserts the premise still holds.
  it("exposes no insertInto/deleteFrom, so writes must use a writable handle", () => {
    const relationalDb = {
      queryNamespace: () => ({
        selectFrom: () => undefined,
        selectNoFrom: () => undefined,
        with: () => undefined,
        withRecursive: () => undefined,
        withSchema: () => undefined,
      }),
    };
    const handle = RelationalDbProcessor.query(
      "any-drive",
      relationalDb as never,
    ) as unknown as Record<string, unknown>;

    expect(typeof handle.selectFrom).toBe("function");
    // If either of these ever becomes a function upstream, the read/write
    // split in embedding-store.ts can be relaxed — until then it is load
    // bearing.
    expect(handle.insertInto).toBeUndefined();
    expect(handle.deleteFrom).toBeUndefined();
  });
});
