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
