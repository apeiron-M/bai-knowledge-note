import type {
  GraphEdgeMetadata,
  GraphNodeMetadata,
} from "../../knowledge-vault/hooks/use-graph-metadata.js";

/**
 * A note's place in the graph, both directions.
 *
 * The editor used to show only the edges the note owns — `noteMap.get(id).links`
 * is grouped by source — so half of every note's meaning was missing. Measured
 * on the live vault (241 notes, 1,135 edges): the median note is pointed at by
 * one other note and held as a core idea by **two** maps of content, and for 43
 * notes more notes point at them than they point out. None of that needs a
 * query: `useGraphMetadata` already holds every edge in the drive, so this is a
 * filter over data that is on the page anyway.
 */
export type Neighbour = {
  documentId: string;
  title: string;
  linkType: string;
  /** The articulation carried on the edge — why it exists. */
  reason: string | null;
  confidence: string | null;
  /** `bai/knowledge-note`, `bai/moc`, `bai/source`, … when the node is indexed. */
  documentType: string | null;
  /** `DOMAIN` | `TOPIC` | `HUB` for a map of content, else null. */
  tier: string | null;
  status: string | null;
};

export type Neighbourhood = {
  /** Edges this note owns. Editable here. */
  outgoing: Neighbour[];
  /** Edges other notes own and point at this one. Read-only here. */
  incoming: Neighbour[];
  /** Maps of content holding this note as a core idea. */
  mocs: Neighbour[];
  /** Tensions that involve this note. */
  tensions: Neighbour[];
};

const MOC_TIER = /^MOC \(([A-Z]+)\)$/;

/** A source is not graph-indexed, so an edge to one resolves by title or not at all. */
function describe(
  documentId: string,
  fallbackTitle: string | null,
  nodes: Map<string, GraphNodeMetadata>,
): Pick<Neighbour, "title" | "documentType" | "tier" | "status"> {
  const node = nodes.get(documentId);
  const tier = node?.noteType ? (MOC_TIER.exec(node.noteType)?.[1] ?? null) : null;
  return {
    title: node?.title ?? fallbackTitle ?? documentId,
    documentType: node?.documentType ?? null,
    tier,
    status: node?.status ?? null,
  };
}

/**
 * Split the drive's edges into the four things a reader asks about one note.
 * `CORE_IDEA` and `INVOLVES` arrive as incoming edges but answer different
 * questions — where is this filed, and what does it conflict with — so they get
 * their own buckets rather than being mixed into "what points at this".
 */
export function neighbourhood(
  documentId: string,
  edges: readonly GraphEdgeMetadata[],
  nodes: Map<string, GraphNodeMetadata>,
): Neighbourhood {
  const outgoing: Neighbour[] = [];
  const incoming: Neighbour[] = [];
  const mocs: Neighbour[] = [];
  const tensions: Neighbour[] = [];

  for (const edge of edges) {
    const type = edge.linkType ?? "RELATES_TO";
    if (edge.sourceDocumentId === documentId) {
      outgoing.push({
        documentId: edge.targetDocumentId,
        linkType: type,
        reason: edge.reason,
        confidence: edge.confidence,
        ...describe(edge.targetDocumentId, edge.targetTitle, nodes),
      });
      continue;
    }
    if (edge.targetDocumentId !== documentId) continue;
    const from: Neighbour = {
      documentId: edge.sourceDocumentId,
      linkType: type,
      reason: edge.reason,
      confidence: edge.confidence,
      ...describe(edge.sourceDocumentId, null, nodes),
    };
    if (type === "CORE_IDEA") mocs.push(from);
    else if (type === "INVOLVES" || from.documentType === "bai/tension")
      tensions.push(from);
    else incoming.push(from);
  }

  // A hub before a domain before a topic: the broadest home first.
  const rank: Record<string, number> = { HUB: 0, DOMAIN: 1, TOPIC: 2 };
  mocs.sort((a, b) => (rank[a.tier ?? ""] ?? 3) - (rank[b.tier ?? ""] ?? 3));
  return { outgoing, incoming, mocs, tensions };
}

/** Human wording for a link type, in the vault's own vocabulary. */
export const LINK_LABEL: Record<string, string> = {
  RELATES_TO: "Relates to",
  BUILDS_ON: "Builds on",
  CONTRADICTS: "Contradicts",
  SUPERSEDES: "Supersedes",
  DERIVED_FROM: "Derived from",
  CORE_IDEA: "Core idea",
  CHILD_MOC: "Child map",
  INVOLVES: "Involves",
  PROMOTED_TO: "Promoted to",
};
