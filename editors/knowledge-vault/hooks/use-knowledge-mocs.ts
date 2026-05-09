import { useMemo } from "react";
import {
  useGraphMetadata,
  type GraphEdgeMetadata,
} from "./use-graph-metadata.js";

export type MocTier = "HUB" | "DOMAIN" | "TOPIC";

export type MocInfo = {
  id: string;
  title: string;
  tier: MocTier | null;
  noteCount: number;
  coreIdeas: { noteRef: string; contextPhrase: string }[];
  childRefs: string[];
};

export type UseKnowledgeMocsResult = {
  mocs: MocInfo[];
  mocMap: Map<string, MocInfo>;
};

const TIER_RANK: Record<MocTier, number> = {
  HUB: 0,
  DOMAIN: 1,
  TOPIC: 2,
};

const UNTIERED_RANK = 99;

const MOC_NOTE_TYPE_RE = /^MOC \((HUB|DOMAIN|TOPIC)\)$/;

/**
 * Sidebar/GraphView source for MoC documents.
 *
 * Reuses the in-flight `useGraphMetadata()` response — the graph-indexer
 * already projects MoCs into `graph_nodes` (note_type prefixed `MOC (...)`)
 * and their coreIdeas/childRefs into `graph_edges` (link_type `CORE_IDEA`).
 * No additional fetch is performed.
 *
 * `coreIdea.contextPhrase` is not in the projection — only the target
 * document id. Returned as empty string; GraphView uses it for tooltips
 * only.
 *
 * Note: `useKnowledgeNotes` also calls `useGraphMetadata()`, so when both
 * this hook and `useKnowledgeNotes` are mounted, the subgraph fetch fires
 * twice. This is an accepted tradeoff for now; long-term the call should
 * be lifted into a shared context/provider.
 */
export function useKnowledgeMocs(): UseKnowledgeMocsResult {
  const { nodeMap, edges } = useGraphMetadata();

  return useMemo(() => {
    // First pass: collect MoC ids so the second pass can classify edge
    // targets as either MoC (childRef) or non-MoC (coreIdea).
    const mocIds = new Set<string>();
    for (const node of nodeMap.values()) {
      if (node.noteType?.startsWith("MOC (")) {
        mocIds.add(node.documentId);
      }
    }

    // Build a Map<sourceId, edges> for O(1) lookup by source document.
    // This avoids O(MoCs × edges) behavior from the naive nested loop.
    const edgesBySource = new Map<string, GraphEdgeMetadata[]>();
    for (const edge of edges) {
      let arr = edgesBySource.get(edge.sourceDocumentId);
      if (!arr) {
        arr = [];
        edgesBySource.set(edge.sourceDocumentId, arr);
      }
      arr.push(edge);
    }

    // Second pass: build a MocInfo for each MoC node, looking up outgoing
    // CORE_IDEA edges to populate coreIdeas and childRefs.
    const mocs: MocInfo[] = [];
    for (const node of nodeMap.values()) {
      if (!node.noteType || !node.noteType.startsWith("MOC (")) continue;

      const tier = (MOC_NOTE_TYPE_RE.exec(node.noteType)?.[1] ??
        null) as MocTier | null;

      const coreIdeas: MocInfo["coreIdeas"] = [];
      const childRefs: string[] = [];
      const sourceEdges = edgesBySource.get(node.documentId) ?? [];
      for (const edge of sourceEdges) {
        if (edge.linkType !== "CORE_IDEA") continue;
        if (mocIds.has(edge.targetDocumentId)) {
          childRefs.push(edge.targetDocumentId);
        } else {
          coreIdeas.push({
            noteRef: edge.targetDocumentId,
            contextPhrase: "",
          });
        }
      }

      mocs.push({
        id: node.documentId,
        title: node.title ?? "(untitled)",
        tier,
        noteCount: coreIdeas.length,
        coreIdeas,
        childRefs,
      });
    }

    // Sort: known tiers (HUB → DOMAIN → TOPIC) first ranked by TIER_RANK,
    // then untiered MoCs, then alphabetical by title within each tier.
    mocs.sort((a, b) => {
      const ra = a.tier ? TIER_RANK[a.tier] : UNTIERED_RANK;
      const rb = b.tier ? TIER_RANK[b.tier] : UNTIERED_RANK;
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title);
    });

    const mocMap = new Map<string, MocInfo>();
    for (const moc of mocs) mocMap.set(moc.id, moc);

    return { mocs, mocMap };
  }, [nodeMap, edges]);
}
