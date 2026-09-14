import type { ISubgraph } from "@powerhousedao/reactor-api";
import { getDb, getQuery } from "./db.js";
import { searchSimilar } from "../../../processors/graph-indexer/embedding-store.js";
import { embedQuery } from "./query-embedder.js";
import {
  RRF_K,
  isCurrentNode,
  normalizeFusedScore,
} from "../../../processors/graph-indexer/query.js";

export type SearchMode = "SEMANTIC";

export interface VaultSearchHit {
  node: Record<string, unknown>;
  similarity: number;
  score: number;
  matchedBy: string[];
}

/**
 * Shared body of knowledgeGraphSearchByEmbedding (client-supplied vector) and
 * knowledgeGraphSemanticSearch (server-embedded query).
 *
 * Ranks purely by cosine similarity, so `similarity` is a true 0..1 relevance
 * that can be compared and thresholded.
 *
 * A hybrid mode fusing this with keyword search via RRF was removed: its
 * keyword leg ANDed its terms, so a natural-language question matched nothing
 * there, and the fused score was then rescaled as though both legs had fired —
 * reporting a genuine 0.97 match as ~0.5. A caller filtering on
 * `similarity > 0.7` discarded every hit.
 */
export async function searchWithEmbedding(
  subgraph: ISubgraph,
  driveId: string,
  query: string,
  embedding: number[],
  mode: SearchMode,
  limit: number,
  includeArchived = false,
): Promise<VaultSearchHit[]> {
  const db = getDb(subgraph, driveId);
  const semanticHits = await searchSimilar(db, embedding, limit * 2);
  const graphQuery = getQuery(subgraph, driveId);

  // One query for every hit, rather than one query per hit. Ranking is
  // unchanged: `semanticHits` is already ordered by similarity and the loop
  // below still walks it in that order.
  const nodes = await graphQuery.nodesByDocumentIds(
    semanticHits.map((hit) => hit.documentId),
  );
  // The embedding store knows nothing about status: archived notes are still
  // embedded (their history is knowledge) and are dropped here.
  const out: VaultSearchHit[] = [];
  for (const hit of semanticHits) {
    if (out.length >= limit) break;
    const node = nodes.get(hit.documentId);
    if (node && (includeArchived || isCurrentNode(node))) {
      out.push({
        node: { ...node, _driveId: driveId },
        similarity: hit.similarity,
        score: hit.similarity,
        matchedBy: ["semantic"],
      });
    }
  }
  return out;
}

/**
 * Keyword-only fallback, used when the embedding path is unavailable. Only one
 * leg ran, so score these on the same rank-decay curve RRF uses and rescale
 * against a SINGLE leg's ceiling. The old flat `similarity: 0` rendered every
 * perfectly good keyword hit as "0%".
 */
export async function keywordSearch(
  subgraph: ISubgraph,
  driveId: string,
  query: string,
  limit: number,
  includeArchived = false,
): Promise<VaultSearchHit[]> {
  const graphQuery = getQuery(subgraph, driveId);
  const keywordHits = await graphQuery.fullSearch(query, limit, {
    includeArchived,
  });
  return keywordHits.map((node, rank) => {
    const score = 1 / (RRF_K + rank);
    return {
      node: { ...node, _driveId: driveId },
      similarity: normalizeFusedScore(score, 1),
      score,
      matchedBy: ["keyword"],
    };
  });
}

/**
 * The vault's search entry point: server-side embedding with a transparent
 * keyword fallback. Any failure on the embedding path — model unavailable,
 * embedding store missing, no vectors pushed yet — degrades to keyword search
 * instead of erroring. A search box must never be the thing that breaks.
 */
export async function searchVault(
  subgraph: ISubgraph,
  driveId: string,
  query: string,
  mode: SearchMode = "SEMANTIC",
  limit = 20,
  includeArchived = false,
): Promise<VaultSearchHit[]> {
  const embedding = await embedQuery(query);
  if (embedding) {
    try {
      return await searchWithEmbedding(
        subgraph,
        driveId,
        query,
        embedding,
        mode,
        limit,
        includeArchived,
      );
    } catch (err) {
      console.warn(
        `[knowledgeGraph] embedding store unavailable, keyword fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return keywordSearch(subgraph, driveId, query, limit, includeArchived);
}