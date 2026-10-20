/**
 * Tensions for the vault views, sourced from the knowledgeGraph projection.
 *
 * The graph-indexer indexes `bai/tension` documents as nodes (with
 * `documentType === "bai/tension"` and the tension's own OPEN / RESOLVED /
 * DISSOLVED status) and reconciles one `INVOLVES` edge per `involvedRefs`
 * entry. Both arrive on the same `useGraphMetadata()` round-trip the sidebar
 * already makes, so this hook costs no extra request — it is a derivation.
 *
 * Nothing here decides whether tensions are DRAWN. The graph view keeps them
 * as an opt-in layer, off by default: a vault with many notes gets no new
 * dots unless the reader asks for them. What this hook makes possible
 * everywhere else is "this note is involved in tension X" and honest counts.
 */
import { useMemo } from "react";
import { useGraphMetadata } from "./use-graph-metadata.js";

export type TensionInfo = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  involvedRefs: string[];
  /** Who or what recorded it — a person, or an automation like graph-indexer. */
  observedBy: string | null;
  observedAt: string | null;
};

export type UseKnowledgeTensionsResult = {
  tensions: TensionInfo[];
  openTensions: TensionInfo[];
  /** Tensions per involved note id — for a note's own view. */
  byNote: Map<string, TensionInfo[]>;
  isLoading: boolean;
};

export function useKnowledgeTensions(): UseKnowledgeTensionsResult {
  const { nodes, edges, isLoading } = useGraphMetadata();

  return useMemo(() => {
    const involvedBySource = new Map<string, string[]>();
    for (const e of edges) {
      if (e.linkType !== "INVOLVES") continue;
      const arr = involvedBySource.get(e.sourceDocumentId) ?? [];
      arr.push(e.targetDocumentId);
      involvedBySource.set(e.sourceDocumentId, arr);
    }

    const tensions: TensionInfo[] = [];
    for (const n of nodes) {
      if (n.documentType !== "bai/tension") continue;
      tensions.push({
        id: n.documentId,
        title: n.title ?? "(untitled tension)",
        description: n.description,
        status: n.status,
        involvedRefs: involvedBySource.get(n.documentId) ?? [],
        observedBy: n.author,
        observedAt: n.createdAt,
      });
    }
    tensions.sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));

    const byNote = new Map<string, TensionInfo[]>();
    for (const t of tensions) {
      for (const ref of t.involvedRefs) {
        const arr = byNote.get(ref) ?? [];
        arr.push(t);
        byNote.set(ref, arr);
      }
    }

    return {
      tensions,
      openTensions: tensions.filter((t) => t.status === "OPEN"),
      byNote,
      isLoading,
    };
  }, [nodes, edges, isLoading]);
}
