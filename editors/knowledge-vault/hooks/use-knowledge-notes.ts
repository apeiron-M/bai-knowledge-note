import { useMemo } from "react";
import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import { useGraphMetadata } from "./use-graph-metadata.js";

export type KnowledgeNoteInfo = {
  id: string;
  /** Drive-tree node name (slug used at create-time). */
  name: string;
  /** state.global.title — populated from the subgraph projection. */
  title: string | null;
  noteType: string | null;
  status: string | null;
  description: string | null;
  topics: { id: string; name: string }[];
  links: {
    id: string;
    targetDocumentId: string | null;
    targetTitle: string | null;
    linkType: string | null;
  }[];
  provenance: {
    author: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
};

/**
 * Sidebar/list source for knowledge-notes.
 *
 * Reads metadata from the `knowledgeGraph` subgraph (one query)
 * rather than fetching each document individually. Falls back to the
 * drive-tree node `name` (the create-time slug) for any node whose
 * subgraph row hasn't been indexed yet — typical on first drive open
 * before the GraphIndexerProcessor finishes its historical replay.
 *
 * Returns `{ notes, noteMap, isLoading, error, refetch }`. The
 * `isLoading` is true only on the very first fetch; subsequent
 * refetches keep returning the previous nodes so the sidebar doesn't
 * flicker.
 */
export function useKnowledgeNotes() {
  const fileNodes = useFileNodesInSelectedDrive();
  const { nodeMap, edges, isLoading, error, refetch } = useGraphMetadata();

  const knowledgeFileNodes = useMemo(
    () =>
      (fileNodes ?? []).filter((n) => n.documentType === "bai/knowledge-note"),
    [fileNodes],
  );

  // Group edges by source document so each note can carry its outgoing
  // links inline — preserves the shape downstream consumers (auto-health,
  // graph-sync) already rely on.
  const linksBySource = useMemo(() => {
    const map = new Map<string, KnowledgeNoteInfo["links"]>();
    for (const e of edges) {
      let arr = map.get(e.sourceDocumentId);
      if (!arr) {
        arr = [];
        map.set(e.sourceDocumentId, arr);
      }
      arr.push({
        id: e.id,
        targetDocumentId: e.targetDocumentId,
        targetTitle: e.targetTitle,
        linkType: e.linkType,
      });
    }
    return map;
  }, [edges]);

  const notes: KnowledgeNoteInfo[] = useMemo(() => {
    return knowledgeFileNodes.map((node) => {
      const meta = nodeMap.get(node.id);
      const links = linksBySource.get(node.id) ?? [];
      if (!meta) {
        return {
          id: node.id,
          name: node.name,
          title: null,
          noteType: null,
          status: "DRAFT",
          description: null,
          topics: [],
          links,
          provenance: null,
        };
      }
      // The subgraph hands us topic names as a flat string[]. Reconstruct
      // a stable id by index so consumers that key by id still work.
      const topics = meta.topics.map((name, i) => ({
        id: `${node.id}-topic-${i}`,
        name,
      }));
      return {
        id: node.id,
        name: node.name,
        title: meta.title,
        noteType: meta.noteType,
        status: meta.status ?? "DRAFT",
        description: meta.description,
        topics,
        links,
        provenance:
          meta.author || meta.sourceOrigin || meta.createdAt
            ? {
                author: meta.author,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
              }
            : null,
      };
    });
  }, [knowledgeFileNodes, nodeMap, linksBySource]);

  const noteMap = useMemo(() => {
    const m = new Map<string, KnowledgeNoteInfo>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  return { notes, noteMap, isLoading, error, refetch };
}
