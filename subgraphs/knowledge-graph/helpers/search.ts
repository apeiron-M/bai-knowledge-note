import { getDb, getQuery, type GraphSubgraph } from "./db.js";
import { ACTIVE_MODEL, searchSimilar } from "../../../processors/graph-indexer/embedding-store.js";
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
  subgraph: GraphSubgraph,
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
  subgraph: GraphSubgraph,
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
  subgraph: GraphSubgraph,
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
/**
 * Cosine similarity of a query to each of these documents' stored embeddings
 * (title + description + body; a map's body is its orientation) — what
 * `what_changed` ranks a hub's areas by (spec Addendum C1). Null when the
 * query cannot be embedded or none of the documents has a current vector;
 * a document without one is left out of the map.
 */
export async function mapSimilarities(
  subgraph: GraphSubgraph,
  driveId: string,
  query: string,
  documentIds: string[],
): Promise<Map<string, number> | null> {
  if (!documentIds.length) return null;
  const embedding = await embedQuery(query);
  if (!embedding) return null;
  try {
    const rows = await getDb(subgraph, driveId)
      .selectFrom("note_embeddings")
      .select(["document_id", "embedding"])
      .where("model", "=", ACTIVE_MODEL)
      .where("document_id", "in", documentIds)
      .execute();
    const out = new Map<string, number>();
    for (const row of rows) {
      const vector = JSON.parse(row.embedding) as number[];
      if (vector.length !== embedding.length) continue;
      let dot = 0;
      for (let i = 0; i < vector.length; i++) dot += vector[i] * embedding[i];
      out.set(row.document_id, dot);
    }
    return out.size ? out : null;
  } catch (err) {
    console.warn(`[knowledgeGraph] map embeddings unavailable, keyword fallback: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
