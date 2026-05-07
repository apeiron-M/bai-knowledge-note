import { useMemo } from "react";
import { generateId } from "document-model/core";
import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import type { KnowledgeGraphDocument } from "../../../document-models/knowledge-graph/index.js";
import { useDocumentByIdSafe } from "./use-documents-safe.js";
import type { KnowledgeNoteInfo } from "./use-knowledge-notes.js";

export type GraphState = {
  nodes: {
    id: string;
    documentId: string;
    title?: string | null;
    noteType?: string | null;
    status?: string | null;
  }[];
  edges: {
    id: string;
    sourceDocumentId: string;
    targetDocumentId: string;
    linkType?: string | null;
  }[];
  lastSyncedAt?: string | null;
};

/**
 * Returns the KnowledgeGraph singleton document for the drive (created
 * by use-drive-init). Does NOT auto-create — that's handled solely by
 * useDriveInit to avoid duplicates.
 *
 * Resolves the singleton's id via the drive's file-node tree (one
 * filter pass over the file nodes — no per-doc fetching), then loads
 * only that single document via useDocumentByIdSafe. Avoids the
 * previous pattern of fetching every document in the drive just to
 * pick one out by type.
 */
export function useKnowledgeGraph(_notes: KnowledgeNoteInfo[]) {
  const fileNodes = useFileNodesInSelectedDrive();
  const graphNodeId = useMemo(
    () =>
      (fileNodes ?? []).find((n) => n.documentType === "bai/knowledge-graph")
        ?.id ?? null,
    [fileNodes],
  );
  const [graphDoc] = useDocumentByIdSafe<KnowledgeGraphDocument>(graphNodeId);
  const graphState: GraphState | null = graphDoc?.state.global ?? null;

  return {
    graphDoc,
    graphState,
    hasGraphDoc: !!graphDoc,
  };
}

/**
 * Builds the sync payload from the current notes.
 */
export function buildSyncPayload(notes: KnowledgeNoteInfo[]) {
  const nodeIds = new Set(notes.map((n) => n.id));

  const nodes = notes.map((note) => ({
    id: generateId(),
    documentId: note.id,
    title: note.title ?? null,
    noteType: note.noteType ?? null,
    status: note.status ?? null,
  }));

  const edges = notes.flatMap((note) =>
    note.links
      .filter((l) => l.targetDocumentId && nodeIds.has(l.targetDocumentId))
      .map((link) => ({
        id: generateId(),
        sourceDocumentId: note.id,
        targetDocumentId: link.targetDocumentId!,
        linkType: link.linkType ?? null,
      })),
  );

  return { nodes, edges };
}
