import { useMemo } from "react";
import { useGraphMetadata } from "./use-graph-metadata.js";

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

    // Second pass: build a MocInfo for each MoC node, walking outgoing
    // CORE_IDEA edges to populate coreIdeas and childRefs.
    const mocs: MocInfo[] = [];
    for (const node of nodeMap.values()) {
      if (!node.noteType || !node.noteType.startsWith("MOC (")) continue;

      const tier = (MOC_NOTE_TYPE_RE.exec(node.noteType)?.[1] ??
        null) as MocTier | null;

      const coreIdeas: MocInfo["coreIdeas"] = [];
      const childRefs: string[] = [];
      for (const edge of edges) {
        if (edge.sourceDocumentId !== node.documentId) continue;
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
      const ra = a.tier ? TIER_RANK[a.tier] : 99;
      const rb = b.tier ? TIER_RANK[b.tier] : 99;
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title);
    });

    const mocMap = new Map<string, MocInfo>();
    for (const moc of mocs) mocMap.set(moc.id, moc);

    return { mocs, mocMap };
  }, [nodeMap, edges]);
}
