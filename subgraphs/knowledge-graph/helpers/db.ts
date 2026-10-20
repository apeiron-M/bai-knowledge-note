/**
 * Database access helpers for the knowledge-graph subgraph.
 * Provides typed Kysely instances scoped to the graph-indexer processor namespace.
 */
import type { Kysely } from "kysely";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { GraphIndexerProcessor } from "../../../processors/graph-indexer/index.js";
import { up } from "../../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../../processors/graph-indexer/query.js";
import type { DB } from "../../../processors/graph-indexer/schema.js";

/**
 * Memoized namespaced query builders, keyed on the relational db and namespace.
 *
 * `RelationalDbProcessor.query` returns a **fresh object literal** on every
 * call — a thin, stateless wrapper of bound methods over the one long-lived
 * Kysely instance. Building it is free, but its *identity* is not free:
 * `embedding-store.ts` caches the embedding matrix in a
 * `WeakMap` keyed on this handle, so a new handle per call meant the cache
 * never hit from a subgraph and every semantic search reloaded and
 * `JSON.parse`d the entire `note_embeddings` table (measured 2026-09-14: ~250ms
 * per query). Only the processor, which holds a stable handle, ever got the
 * cache the comment there promises.
 *
 * Keying on the db object as well as the namespace means a replaced relational
 * db cannot serve a stale builder, and the outer WeakMap lets both be
 * collected together.
 */
const dbHandles = new WeakMap<object, Map<string, NamespacedReadDb>>();

/** Test seam: drop every memoized query builder. */
export function clearDbHandleCache(): void {
  // WeakMap has no clear(); dropping the per-db maps is enough because the
  // only reachable entries are keyed by live relational db objects.
  cachedRelationalDbs.forEach((db) => dbHandles.delete(db));
  cachedRelationalDbs.clear();
}
const cachedRelationalDbs = new Set<object>();

/**
 * What `RelationalDbProcessor.query` actually returns: `selectFrom`,
 * `selectNoFrom`, `with`, `withRecursive`, `withSchema` and nothing else.
 *
 * This used to be typed `Kysely<DB>` through an `as unknown as` cast, which
 * claimed methods the object does not have. `knowledgeGraphUpsertEmbedding`
 * passed one of these to `upsertEmbedding`, which calls `db.insertInto(...)`,
 * and the mutation failed at runtime with `db.insertInto is not a function`
 * while type-checking cleanly. Writes must use `getWritableDb`.
 */
export type NamespacedReadDb = Pick<
  Kysely<DB>,
  "selectFrom" | "with" | "withRecursive" | "withSchema"
>;

/**
 * Read-only namespaced query builder — use for all SELECT resolvers.
 */
export function getDb(
  subgraph: ISubgraph,
  driveId: string,
): NamespacedReadDb {
  const relationalDb = subgraph.relationalDb as unknown as IRelationalDb;
  const namespace = GraphIndexerProcessor.getNamespace(driveId);
  let perDb = dbHandles.get(relationalDb as unknown as object);
  if (!perDb) {
    perDb = new Map();
    dbHandles.set(relationalDb as unknown as object, perDb);
    cachedRelationalDbs.add(relationalDb as unknown as object);
  }
  const existing = perDb.get(namespace);
  if (existing) return existing;
  const handle = GraphIndexerProcessor.query(
    driveId,
    relationalDb,
  ) as unknown as NamespacedReadDb;
  perDb.set(namespace, handle);
  return handle;
}

/**
 * Writable namespaced Kysely instance — use for reindex (INSERT/DELETE).
 *
 * Runs the processor's migrations first (idempotent — every CREATE is
 * ifNotExists). The graph-indexer factory only instantiates for
 * knowledge-vault drives now, so a drive it skipped has no tables at all;
 * running `up` here keeps the reindex mutation a complete on-demand
 * recovery path instead of failing with `relation does not exist`.
 */
export async function getWritableDb(
  subgraph: ISubgraph,
  driveId: string,
): Promise<Kysely<DB>> {
  const namespace = GraphIndexerProcessor.getNamespace(driveId);
  const db = (await subgraph.relationalDb.createNamespace(
    namespace,
  )) as unknown as Kysely<DB>;
  await up(db as unknown as Parameters<typeof up>[0]);
  return db;
}

/**
 * Returns a high-level graph query object for the given drive.
 */
export function getQuery(subgraph: ISubgraph, driveId: string) {
  return createGraphQuery(getDb(subgraph, driveId));
}

/**
 * Resolve any drive identifier (slug OR UUID) to the canonical UUID
 * used by the GraphIndexerProcessor's namespace.
 *
 * The processor's namespace is built from `driveHeader.id` (always a
 * UUID — see processors/graph-indexer/factory.ts:11). Resolvers
 * receive `driveId` from GraphQL clients that may pass either a slug
 * or a UUID. Without this normalization a slug-driven read looks up
 * a non-existent namespace and the underlying SQL fails with
 * `relation "<ns>.graph_nodes" does not exist`.
 *
 * Returns the input unchanged if the drive cannot be resolved — the
 * caller will then surface the original error from the downstream
 * query instead of masking a real misconfiguration.
 */
/**
 * Cache of identifier -> canonical drive UUID.
 *
 * Resolving used to cost a full `reactorClient.get(driveId)` on EVERY graph
 * query, which fetches and JSON-parses the entire drive document — on a vault
 * drive that is the whole node list. Measured 2026-09-14: this was ~285ms of
 * the ~290ms a `knowledgeGraphNodeByDocumentId` took, against ~4ms of actual
 * SQL and 2.8ms of GraphQL parsing.
 *
 * A TTL rather than a permanent cache, and keyed on the identifier as given:
 * a UUID -> id mapping is immutable, but a *slug* can in principle be
 * reassigned to another drive, and silently serving the old namespace for the
 * life of the process would be worse than the round trip. Failures are never
 * cached, so a transient error cannot poison the entry.
 */
const driveIdCache = new Map<string, { canonical: string; expiresAt: number }>();
const DRIVE_ID_TTL_MS = 60_000;
const DRIVE_ID_CACHE_MAX = 256;

/** Test seam: drop every memoized drive id. */
export function clearDriveIdCache(): void {
  driveIdCache.clear();
}

export async function resolveCanonicalDriveId(
  subgraph: ISubgraph,
  driveId: string,
): Promise<string> {
  const now = Date.now();
  const hit = driveIdCache.get(driveId);
  if (hit && hit.expiresAt > now) return hit.canonical;

  try {
    const drive = await subgraph.reactorClient.get(driveId);
    const canonical =
      (drive as unknown as { header?: { id?: string }; id?: string }).header
        ?.id ??
      (drive as unknown as { id?: string }).id ??
      driveId;
    // Bounded: this only ever holds the drives a process actually serves.
    if (driveIdCache.size >= DRIVE_ID_CACHE_MAX) driveIdCache.clear();
    driveIdCache.set(driveId, {
      canonical,
      expiresAt: now + DRIVE_ID_TTL_MS,
    });
    return canonical;
  } catch {
    // Deliberately uncached: surface the downstream error next time rather
    // than masking a real misconfiguration for a minute.
    return driveId;
  }
}
