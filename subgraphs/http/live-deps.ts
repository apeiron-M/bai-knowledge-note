import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import {
  getEmbedding,
  searchSimilar,
} from "../../processors/graph-indexer/embedding-store.js";
import { isCurrentNode } from "../../processors/graph-indexer/query.js";
import { readAccessMap } from "../access/access-map.js";
import { getDb, getQuery } from "../knowledge-graph/helpers/db.js";
import { reindexDrive } from "../knowledge-graph/helpers/reindex.js";
import type { HttpRouteDeps } from "./lib/deps.js";
import type { StructureRouteDeps } from "./routes/structure.js";

export function buildHttpRouteDeps(subgraph: BaseSubgraph): HttpRouteDeps {
  return {
    reactorClient: subgraph.reactorClient,
    resolveCanonicalDocumentId: (identifier, ctx) =>
      subgraph.resolveCanonicalDocumentId(identifier, ctx),
    authorization: subgraph.authorizationService,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}

export function buildStructureRouteDeps(
  subgraph: BaseSubgraph,
): StructureRouteDeps {
  return {
    ...buildHttpRouteDeps(subgraph),
    getQuery: (driveId: string) => getQuery(subgraph, driveId),
    similar: async (driveId: string, documentId: string, limit: number) => {
      const db = getDb(subgraph, driveId);
      const embedding = await getEmbedding(db, documentId);
      if (!embedding) return [];
      const results = await searchSimilar(db, embedding, limit * 2 + 1);
      const query = getQuery(subgraph, driveId);
      const out: { node: unknown; similarity: number }[] = [];
      for (const result of results) {
        if (result.documentId === documentId) continue;
        const node = await query.nodeByDocumentId(result.documentId);
        if (node && isCurrentNode(node)) {
          out.push({ node, similarity: result.similarity });
        }
      }
      return out.slice(0, limit);
    },
    reindex: (driveId: string) => reindexDrive(subgraph, driveId),
    accessMap: (driveId: string) => readAccessMap(subgraph, driveId),
    authorization: subgraph.authorizationService,
  };
}