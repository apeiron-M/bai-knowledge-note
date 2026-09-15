import type {
  GraphEdgeResult,
  GraphNodeResult,
} from "../../../processors/graph-indexer/query.js";
import { isCurrentNode } from "../../../processors/graph-indexer/query.js";

/**
 * One-hop graph expansion for search results.
 *
 * Search on its own answers "which notes look like the question". It does not
 * answer "what else should I read", and in this vault that gap is most of the
 * knowledge: a six-hit search over a 983-note vault sat next to 105 directly
 * connected notes the caller never saw. The point of expanding is that a
 * reader — especially a small model that will only ever make one call — gets
 * the neighbourhood handed to it instead of having to know that
 * `forwardLinks`/`backlinks` exist.
 *
 * One hop, not two. Two hops over the same six hits reaches most of the vault
 * and stops being context.
 */

/** An edge, always written source → target so there is no direction to decode. */
export interface NeighbourVia {
  from: string;
  fromTitle: string | null;
  to: string;
  toTitle: string | null;
  linkType: string | null;
  reason: string | null;
  confidence: string | null;
}

export interface Neighbour {
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  documentType: string | null;
  /** How many distinct search hits touch this node. Convergence is signal. */
  hitCount: number;
  /** Ranking score; comparable within one response, not across responses. */
  score: number;
  via: NeighbourVia[];
}

export interface Neighbourhood {
  /** Ranked nodes adjacent to the hits, excluding the hits themselves. */
  related: Neighbour[];
  /**
   * The same neighbours, grouped under the hit that reaches them, with `via`
   * narrowed to that hit's own edges. Ordering stays global — a node three
   * results point at outranks one only this result points at — so a caller
   * reading a single hit still sees the convergent nodes first.
   *
   * Exists so a per-hit presentation (GraphQL selects fields per object)
   * costs no extra query: both views come out of the same two reads.
   */
  byHit: Record<string, Neighbour[]>;
  /** Edges BETWEEN hits — the shape of the result set itself. */
  links: NeighbourVia[];
  /**
   * The same edges, grouped under each hit they touch (either end), so a
   * per-object presentation can show them.
   *
   * These cannot appear in `byHit`: a node that is itself a hit is not a
   * neighbour, so an edge between two hits is dropped from `related` by
   * construction. That is the right call for "what am I missing" but the
   * wrong one for correctness — semantic search naturally returns BOTH sides
   * of a contradiction, and the `CONTRADICTS` edge joining them would then be
   * the one fact nobody sees.
   */
  linksByHit: Record<string, NeighbourVia[]>;
  /** Distinct adjacent nodes found before `limit` was applied. */
  totalRelated: number;
  truncated: boolean;
}

/**
 * How much each link type contributes to a neighbour's rank.
 *
 * These are a heuristic, not a measurement, and they encode one judgement:
 * a link that changes whether an answer is CORRECT outranks a link that
 * merely adds material. A CONTRADICTS or SUPERSEDES edge means the hit is
 * disputed or stale, and a reader who never sees it will state a contested
 * claim as settled — so those sort to the top. DERIVED_FROM points at the
 * source document, which is provenance rather than an answer, so it sorts
 * last while staying present for citation.
 */
export const LINK_TYPE_WEIGHT: Record<string, number> = {
  CONTRADICTS: 1.6,
  SUPERSEDES: 1.4,
  BUILDS_ON: 1.2,
  INVOLVES: 1.15,
  CORE_IDEA: 1.0,
  CHILD_MOC: 0.9,
  RELATES_TO: 0.8,
  PROMOTED_TO: 0.6,
  CITES: 0.5,
  DELIVERED_BY: 0.5,
  DERIVED_FROM: 0.4,
};
const DEFAULT_WEIGHT = 0.7;

export const DEFAULT_RELATED_LIMIT = 10;
/**
 * Most edges any ONE hit may contribute. A MoC is a legitimate search hit and
 * carries a CORE_IDEA edge to every note it holds — 60+ on this vault's
 * domain MoCs — which without a cap would fill the whole list from a single
 * result and bury the other five hits' neighbours.
 */
export const DEFAULT_PER_HIT_EDGE_CAP = 15;

export interface NeighbourhoodInput {
  documentId: string;
  similarity: number;
  node: { title?: string | null } & Record<string, unknown>;
}

export interface NeighbourhoodOptions {
  limit?: number;
  perHitEdgeCap?: number;
  includeArchived?: boolean;
}

interface NeighbourhoodQuery {
  edgesTouching(documentIds: string[]): Promise<GraphEdgeResult[]>;
  nodesByDocumentIds(
    documentIds: string[],
  ): Promise<Map<string, GraphNodeResult>>;
}

// Ternary, not `linkType && ...`: an empty link type would make the `&&`
// evaluate to "" and `??` would keep it, yielding a string weight.
const weightOf = (linkType: string | null): number =>
  (linkType ? LINK_TYPE_WEIGHT[linkType] : undefined) ?? DEFAULT_WEIGHT;

export async function buildNeighbourhood(
  query: NeighbourhoodQuery,
  hits: NeighbourhoodInput[],
  options: NeighbourhoodOptions = {},
): Promise<Neighbourhood> {
  const limit = options.limit ?? DEFAULT_RELATED_LIMIT;
  const perHitEdgeCap = options.perHitEdgeCap ?? DEFAULT_PER_HIT_EDGE_CAP;
  const empty: Neighbourhood = {
    related: [],
    byHit: {},
    links: [],
    linksByHit: {},
    totalRelated: 0,
    truncated: false,
  };
  if (hits.length === 0 || limit <= 0) return empty;

  const hitIds = hits.map((hit) => hit.documentId);
  const hitById = new Map(hits.map((hit) => [hit.documentId, hit]));

  // Two queries total, regardless of how many hits there are.
  const edges = await query.edgesTouching(hitIds);
  if (edges.length === 0) return empty;

  // Split into edges that stay inside the result set and edges that leave it.
  const internal: GraphEdgeResult[] = [];
  const outward: { edge: GraphEdgeResult; hitId: string; otherId: string }[] =
    [];
  for (const edge of edges) {
    const sourceIsHit = hitById.has(edge.sourceDocumentId);
    const targetIsHit = hitById.has(edge.targetDocumentId);
    if (sourceIsHit && targetIsHit) {
      if (edge.sourceDocumentId !== edge.targetDocumentId) internal.push(edge);
      continue;
    }
    const hitId = sourceIsHit ? edge.sourceDocumentId : edge.targetDocumentId;
    const otherId = sourceIsHit ? edge.targetDocumentId : edge.sourceDocumentId;
    outward.push({ edge, hitId, otherId });
  }

  // Cap each hit's contribution, keeping its most informative edges.
  const edgesByHit = new Map<string, typeof outward>();
  for (const entry of outward) {
    const bucket = edgesByHit.get(entry.hitId);
    if (bucket) bucket.push(entry);
    else edgesByHit.set(entry.hitId, [entry]);
  }
  const kept: typeof outward = [];
  for (const bucket of edgesByHit.values()) {
    bucket.sort((a, b) => weightOf(b.edge.linkType) - weightOf(a.edge.linkType));
    kept.push(...bucket.slice(0, perHitEdgeCap));
  }

  // Accumulate. A node connected to several hits scores the sum, so
  // convergence rises without a separate rule for it.
  const scores = new Map<string, number>();
  const viaEdges = new Map<string, GraphEdgeResult[]>();
  const touchingHits = new Map<string, Set<string>>();
  for (const { edge, hitId, otherId } of kept) {
    const hit = hitById.get(hitId);
    if (!hit) continue;
    scores.set(
      otherId,
      (scores.get(otherId) ?? 0) +
        hit.similarity * weightOf(edge.linkType) * (edge.reason ? 1.15 : 1),
    );
    const list = viaEdges.get(otherId);
    if (list) list.push(edge);
    else viaEdges.set(otherId, [edge]);
    const hitSet = touchingHits.get(otherId);
    if (hitSet) hitSet.add(hitId);
    else touchingHits.set(otherId, new Set([hitId]));
  }

  const nodes = await query.nodesByDocumentIds([...scores.keys()]);
  const titleOf = (documentId: string): string | null =>
    (hitById.get(documentId)?.node.title) ??
    nodes.get(documentId)?.title ??
    null;
  const toVia = (edge: GraphEdgeResult): NeighbourVia => ({
    from: edge.sourceDocumentId,
    fromTitle: titleOf(edge.sourceDocumentId),
    to: edge.targetDocumentId,
    toTitle: titleOf(edge.targetDocumentId) ?? edge.targetTitle,
    linkType: edge.linkType,
    reason: edge.reason,
    confidence: edge.confidence,
  });

  const related: Neighbour[] = [];
  for (const [documentId, score] of scores) {
    const node = nodes.get(documentId);
    // No row means the edge points at something outside the index — a source
    // document, or a target indexed later. Nothing to show.
    if (!node) continue;
    if (!options.includeArchived && !isCurrentNode(node)) continue;
    related.push({
      documentId,
      title: node.title,
      description: node.description,
      noteType: node.noteType,
      status: node.status,
      documentType: node.documentType,
      hitCount: touchingHits.get(documentId)?.size ?? 0,
      score: Number(score.toFixed(4)),
      via: (viaEdges.get(documentId) ?? []).map(toVia),
    });
  }
  related.sort(
    (a, b) => b.score - a.score || (a.title ?? "").localeCompare(b.title ?? ""),
  );

  // Group after sorting, so every per-hit list inherits the global ordering.
  const byHit: Record<string, Neighbour[]> = {};
  for (const hitId of hitIds) byHit[hitId] = [];
  for (const neighbour of related) {
    for (const hitId of touchingHits.get(neighbour.documentId) ?? []) {
      const bucket = byHit[hitId];
      if (!bucket || bucket.length >= limit) continue;
      bucket.push({
        ...neighbour,
        via: neighbour.via.filter(
          (via) => via.from === hitId || via.to === hitId,
        ),
      });
    }
  }

  // Hit-to-hit edges, filed under BOTH ends so either hit shows the edge.
  const links = internal.map(toVia);
  const linksByHit: Record<string, NeighbourVia[]> = {};
  for (const hitId of hitIds) linksByHit[hitId] = [];
  for (const via of links) {
    linksByHit[via.from]?.push(via);
    linksByHit[via.to]?.push(via);
  }

  return {
    related: related.slice(0, limit),
    byHit,
    links,
    linksByHit,
    totalRelated: related.length,
    truncated: related.length > limit,
  };
}
