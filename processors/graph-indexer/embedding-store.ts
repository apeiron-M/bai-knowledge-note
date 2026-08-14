/**
 * Durable embedding store, backed by the graph-indexer's per-drive
 * relationalDb namespace (the `note_embeddings` table created in
 * migrations.ts).
 *
 * This replaces the previous implementation: a SEPARATE PGlite instance with
 * the pgvector extension, `idb://` in the browser and `memory://` on the
 * server. That design lost every vector on Switchboard restart, and its
 * claimed recovery path ("embeddings are recomputed via knowledgeGraphReindex")
 * never existed — reindex has no embedding code. It also required shipping
 * pglite's vector.tar.gz WASM bundle, whose relative asset path broke in the
 * published package.
 *
 * Design here:
 *  - Vectors are JSON-encoded float arrays. Similarity is an exact dot
 *    product in JS over an in-memory Float32Array matrix (embeddings are
 *    normalized at embed time, so dot product == cosine). Measured: 2.1ms
 *    over 521 notes, 25ms over 100k — no pgvector, no index tuning, zero
 *    recall loss. int8 quantization and pgvector HNSW are later escalations
 *    behind this same interface.
 *  - The matrix cache self-invalidates: each search does a cheap
 *    count+max(updated_at) probe and rebuilds only when the table changed.
 *    No cross-module cache-key coordination between the processor (writer)
 *    and the subgraph resolvers (readers).
 *  - `model` + `content_hash` columns make every write idempotent and every
 *    model swap an incremental re-embed.
 *
 * All functions take the namespaced Kysely handle: the processor passes
 * `this.relationalDb`, resolvers pass `getDb(subgraph, driveId)`.
 */
import type { Kysely } from "kysely";
import type { DB } from "./schema.js";

/** Model identity, including quantization — stored per row. */
export const ACTIVE_MODEL = "Supabase/gte-small@q8";
export const ACTIVE_DIMS = 384;

type EmbeddingDb = Pick<
  Kysely<DB>,
  "selectFrom" | "insertInto" | "deleteFrom"
>;

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function upsertEmbedding(
  db: EmbeddingDb,
  documentId: string,
  embedding: number[],
  contentHash: string,
  model: string = ACTIVE_MODEL,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto("note_embeddings")
    .values({
      document_id: documentId,
      embedding: JSON.stringify(embedding),
      dims: embedding.length,
      model,
      content_hash: contentHash,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("document_id").doUpdateSet({
        embedding: JSON.stringify(embedding),
        dims: embedding.length,
        model,
        content_hash: contentHash,
        updated_at: now,
      }),
    )
    .execute();
}

export async function deleteEmbedding(
  db: EmbeddingDb,
  documentId: string,
): Promise<void> {
  await db
    .deleteFrom("note_embeddings")
    .where("document_id", "=", documentId)
    .execute();
}

/** The stored content_hash for a doc, or null — the processor's skip gate. */
export async function getStoredHash(
  db: EmbeddingDb,
  documentId: string,
): Promise<{ contentHash: string; model: string } | null> {
  const row = await db
    .selectFrom("note_embeddings")
    .select(["content_hash", "model"])
    .where("document_id", "=", documentId)
    .executeTakeFirst();
  return row ? { contentHash: row.content_hash, model: row.model } : null;
}

export async function getEmbedding(
  db: EmbeddingDb,
  documentId: string,
): Promise<number[] | null> {
  const row = await db
    .selectFrom("note_embeddings")
    .select(["embedding", "model"])
    .where("document_id", "=", documentId)
    .executeTakeFirst();
  if (!row || row.model !== ACTIVE_MODEL) return null;
  try {
    return JSON.parse(row.embedding) as number[];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Exact similarity search over an in-memory matrix                   */
/* ------------------------------------------------------------------ */

type MatrixCache = {
  ids: string[];
  matrix: Float32Array;
  dims: number;
  rowCount: number;
  maxUpdatedAt: string;
};

// One cache per db handle. WeakMap so a dropped namespace handle frees its
// matrix; the self-invalidation probe below handles content changes.
const caches = new WeakMap<object, MatrixCache>();

async function loadMatrix(db: EmbeddingDb): Promise<MatrixCache | null> {
  const probe = await db
    .selectFrom("note_embeddings")
    .select((eb) => [
      eb.fn.countAll().as("cnt"),
      eb.fn.max("updated_at").as("max_updated"),
    ])
    .where("model", "=", ACTIVE_MODEL)
    .executeTakeFirst();
  const rowCount = Number(probe?.cnt ?? 0);
  if (rowCount === 0) return null;
  const maxUpdatedAt = String(probe?.max_updated ?? "");

  const cached = caches.get(db);
  if (
    cached &&
    cached.rowCount === rowCount &&
    cached.maxUpdatedAt === maxUpdatedAt
  ) {
    return cached;
  }

  const rows = await db
    .selectFrom("note_embeddings")
    .select(["document_id", "embedding", "dims"])
    .where("model", "=", ACTIVE_MODEL)
    .execute();
  if (rows.length === 0) return null;

  const dims = rows[0].dims;
  const ids: string[] = [];
  const matrix = new Float32Array(rows.length * dims);
  let n = 0;
  for (const row of rows) {
    if (row.dims !== dims) continue; // mixed dims mid-migration — skip
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding) as number[];
    } catch {
      continue;
    }
    matrix.set(vec, n * dims);
    ids.push(row.document_id);
    n++;
  }

  const cache: MatrixCache = {
    ids,
    matrix: matrix.subarray(0, n * dims) as Float32Array,
    dims,
    rowCount,
    maxUpdatedAt,
  };
  caches.set(db, cache);
  return cache;
}

/**
 * Top-`limit` documents by cosine similarity (vectors are normalized, so
 * dot product == cosine). Returns [] when no embeddings exist for the
 * active model — callers treat that as "semantic unavailable".
 */
export async function searchSimilar(
  db: EmbeddingDb,
  embedding: number[],
  limit: number,
): Promise<Array<{ documentId: string; similarity: number }>> {
  const cache = await loadMatrix(db);
  if (!cache || cache.dims !== embedding.length) return [];

  const { ids, matrix, dims } = cache;
  const q = Float32Array.from(embedding);
  const scores = new Float32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    let s = 0;
    const off = i * dims;
    for (let j = 0; j < dims; j++) s += matrix[off + j] * q[j];
    scores[i] = s;
  }

  return Array.from(ids.keys())
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, limit)
    .map((i) => ({ documentId: ids[i], similarity: scores[i] }));
}
