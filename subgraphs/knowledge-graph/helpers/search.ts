import type { ISubgraph } from "@powerhousedao/reactor-api";
import { getDb, getQuery } from "./db.js";
import { searchSimilar } from "../../../processors/graph-indexer/embedding-store.js";
import { embedQuery } from "./query-embedder.js";
import {
  RRF_K,
  isCurrentNode,
  normalizeFusedScore,
} from "../../../processors/graph-indexer/query.js";

export type SearchMode = "SEMANTIC" | "HYBRID";

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
 * SEMANTIC ranks purely by cosine similarity. HYBRID fuses semantic + keyword
 * via RRF in graphQuery.hybridSearch, which ranks well but produces ORDINAL
 * weights topping out at `2 / RRF_K` (~0.033). Those must not reach a UI as a
 * similarity: rendered as a percentage they cap at 3% regardless of how good
 * the match is. So `similarity` carries the rescaled 0..1 relevance while
 * `score` keeps the raw fused weight for callers doing their own maths.
 * Ordering is untouched — the rescale is monotonic.
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

  if (mode === "SEMANTIC") {
    const out: VaultSearchHit[] = [];
    // The embedding store knows nothing about status: archived notes are
    // still embedded (their history is knowledge) and are dropped here.
    for (const hit of semanticHits) {
      if (out.length >= limit) break;
      const node = await graphQuery.nodeByDocumentId(hit.documentId);
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

  const hybridResults = await graphQuery.hybridSearch(
    query,
    semanticHits,
    limit,
    { includeArchived },
  );
  return hybridResults.map((r) => ({
    node: { ...r.node, _driveId: driveId },
    // Rescaled against the number of legs that actually produced this hit's
    // ceiling: a note found by BOTH signals can reach 1.0, while a note only
    // one leg could ever surface is judged against a single leg's maximum.
    similarity: normalizeFusedScore(r.score, 2),
    score: r.score,
    matchedBy: r.matchedBy,
  }));
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
  mode: SearchMode = "HYBRID",
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