import { useMemo } from "react";
import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import {
  useGraphMetadata,
  type DriveFileNode,
  type DriveTreeNode,
} from "./use-graph-metadata.js";

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
export type UseKnowledgeNotesResult = {
  notes: KnowledgeNoteInfo[];
  noteMap: Map<string, KnowledgeNoteInfo>;
  /** Authoritative file nodes from the reactor (bypasses Connect cache). */
  serverFileNodes: DriveFileNode[];
  /** Authoritative full drive tree (folders + files) from the reactor. */
  serverAllNodes: DriveTreeNode[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export function useKnowledgeNotes(): UseKnowledgeNotesResult {
  // Connect's local drive-document cache can be stale (we've observed
  // server having 398 file nodes while the cache reports 2). The
  // metadata hook now also fetches the drive's authoritative file-node
  // list from the reactor; prefer that source. Fall back to the local
  // cache only if the server fetch hasn't completed or returned empty.
  const cachedFileNodes = useFileNodesInSelectedDrive();
  const {
    nodeMap,
    edges,
    fileNodes: serverFileNodes,
    allNodes: serverAllNodes,
    isLoading,
    error,
    refetch,
  } = useGraphMetadata();

  const fileNodes =
    serverFileNodes.length > 0 ? serverFileNodes : (cachedFileNodes ?? []);

  const knowledgeFileNodes = useMemo(
    () => fileNodes.filter((n) => n.documentType === "bai/knowledge-note"),
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
    // DEBUG: log compose stats once per render. Remove once verified.
    if (knowledgeFileNodes.length > 0) {
      const firstId = knowledgeFileNodes[0]?.id;
      // eslint-disable-next-line no-console
      console.log(
        "[useKnowledgeNotes] compose:",
        "fileNodes=", knowledgeFileNodes.length,
        "nodeMapSize=", nodeMap.size,
        "linksBySourceSize=", linksBySource.size,
        "firstFileNodeId=", firstId,
        "firstNodeMapKeys=", Array.from(nodeMap.keys()).slice(0, 3),
        "firstFileNodeFoundInMap=", firstId ? nodeMap.has(firstId) : "n/a",
      );
    }
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

  return {
    notes,
    noteMap,
    serverFileNodes,
    serverAllNodes,
    isLoading,
    error,
    refetch,
  };
}
