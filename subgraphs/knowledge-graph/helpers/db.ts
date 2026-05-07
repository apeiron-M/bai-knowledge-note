/**
 * Database access helpers for the knowledge-graph subgraph.
 * Provides typed Kysely instances scoped to the graph-indexer processor namespace.
 */
import type { Kysely } from "kysely";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import { GraphIndexerProcessor } from "../../../processors/graph-indexer/index.js";
import { createGraphQuery } from "../../../processors/graph-indexer/query.js";
import type { DB } from "../../../processors/graph-indexer/schema.js";

/**
 * Read-only namespaced query builder — use for all SELECT resolvers.
 */
export function getDb(subgraph: ISubgraph, driveId: string): Kysely<DB> {
  return GraphIndexerProcessor.query(
    driveId,
    subgraph.relationalDb as unknown as IRelationalDb,
  ) as unknown as Kysely<DB>;
}

/**
 * Writable namespaced Kysely instance — use for reindex (INSERT/DELETE).
 */
export async function getWritableDb(
  subgraph: ISubgraph,
  driveId: string,
): Promise<Kysely<DB>> {
  const namespace = GraphIndexerProcessor.getNamespace(driveId);
  return (await subgraph.relationalDb.createNamespace(
    namespace,
  )) as unknown as Kysely<DB>;
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
export async function resolveCanonicalDriveId(
  subgraph: ISubgraph,
  driveId: string,
): Promise<string> {
  try {
    const drive = await subgraph.reactorClient.get(driveId);
    return (
      (drive as unknown as { header?: { id?: string }; id?: string }).header
        ?.id ??
      (drive as unknown as { id?: string }).id ??
      driveId
    );
  } catch {
    return driveId;
  }
}
