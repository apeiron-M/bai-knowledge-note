import { useMemo } from "react";
import { generateId } from "document-model/core";
import type { KnowledgeGraphDocument } from "../../../document-models/knowledge-graph/index.js";
import { isKnowledgeGraphDocument } from "../../../document-models/knowledge-graph/v1/gen/document-schema.js";
import { useDocumentsSafe } from "./use-documents-safe.js";
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
 * Returns the first KnowledgeGraph document in the drive (created by use-drive-init).
 * Does NOT auto-create — that's handled solely by useDriveInit to avoid duplicates.
 */
export function useKnowledgeGraph(notes: KnowledgeNoteInfo[]) {
  const allDocs = useDocumentsSafe();
  const graphDocs = useMemo(
    () => allDocs.filter(isKnowledgeGraphDocument) as KnowledgeGraphDocument[],
    [allDocs],
  );
  const graphDoc = graphDocs[0];
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
