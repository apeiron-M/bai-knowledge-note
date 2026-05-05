import type { PGlite } from "@electric-sql/pglite";

let db: PGlite | null = null;

/**
 * Lazy-load PGlite at first use so that simply importing this module doesn't
 * require `@electric-sql/pglite` to be present in the runtime environment.
 *
 * The shared Powerhouse build config declares `@electric-sql/pglite` as
 * `neverBundle`, so the bare specifier survives into our dist. Deployed
 * switchboards load our package via HTTP CDN (no `npm install`), and their
 * base image doesn't ship pglite — without lazy loading, every consumer of
 * this module would crash at import time.
 */
export async function getEmbeddingDb(): Promise<PGlite> {
  if (db) return db;

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");

  const dataDir =
    typeof window !== "undefined"
      ? "idb://knowledge-embeddings"
      : "./.ph/knowledge-embeddings";

  db = new PGlite({
    dataDir,
    extensions: { vector },
  });

  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS note_embeddings (
      document_id VARCHAR(255) PRIMARY KEY,
      embedding vector(384) NOT NULL,
      updated_at VARCHAR(50) NOT NULL
    );
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_note_embeddings_hnsw
    ON note_embeddings USING hnsw (embedding vector_cosine_ops);
  `);

  return db;
}

export async function upsertEmbedding(
  documentId: string,
  embedding: number[],
): Promise<void> {
  const store = await getEmbeddingDb();
  const now = new Date().toISOString();
  const embeddingStr = `[${embedding.join(",")}]`;

  await store.query(
    `INSERT INTO note_embeddings (document_id, embedding, updated_at)
     VALUES ($1, $2::vector, $3)
     ON CONFLICT (document_id) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       updated_at = EXCLUDED.updated_at`,
    [documentId, embeddingStr, now],
  );
}

export async function searchSimilar(
  queryEmbedding: number[],
  limit = 10,
): Promise<Array<{ documentId: string; similarity: number }>> {
  const store = await getEmbeddingDb();
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const result = await store.query<{
    document_id: string;
    distance: number;
  }>(
    `SELECT document_id, embedding <=> $1::vector AS distance
     FROM note_embeddings
     ORDER BY distance ASC
     LIMIT $2`,
    [embeddingStr, limit],
  );

  return (result.rows ?? []).map((row) => ({
    documentId: row.document_id,
    similarity: 1 - row.distance,
  }));
}

export async function getEmbedding(
  documentId: string,
): Promise<number[] | null> {
  const store = await getEmbeddingDb();

  const result = await store.query<{ embedding: string }>(
    `SELECT embedding::text FROM note_embeddings WHERE document_id = $1`,
    [documentId],
  );

  if (!result.rows || result.rows.length === 0) return null;

  // Parse "[0.1,0.2,...]" string back to number[]
  const raw = result.rows[0].embedding;
  return JSON.parse(raw) as number[];
}

export async function deleteEmbedding(documentId: string): Promise<void> {
  const store = await getEmbeddingDb();
  await store.query(`DELETE FROM note_embeddings WHERE document_id = $1`, [
    documentId,
  ]);
}

export async function closeEmbeddingDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
