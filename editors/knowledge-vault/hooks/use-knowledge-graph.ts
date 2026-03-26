import { useEffect, useMemo, useCallback, useRef } from "react";
import { generateId } from "document-model/core";
import {
  useSelectedDriveId,
  addDocument,
} from "@powerhousedao/reactor-browser";
import {
  useKnowledgeGraphDocumentsInSelectedDrive,
} from "knowledge-note/document-models/knowledge-graph";
import type {
  KnowledgeGraphDocument,
} from "knowledge-note/document-models/knowledge-graph";
import type { KnowledgeNoteInfo } from "./use-knowledge-notes.js";

export type GraphState = {
  nodes: { id: string; documentId: string; title?: string | null; noteType?: string | null; status?: string | null }[];
  edges: { id: string; sourceDocumentId: string; targetDocumentId: string; linkType?: string | null }[];
  lastSyncedAt?: string | null;
};

export function useKnowledgeGraph(notes: KnowledgeNoteInfo[]) {
  const graphDocs = useKnowledgeGraphDocumentsInSelectedDrive();
  const driveId = useSelectedDriveId();
  const graphDoc = graphDocs?.[0] as KnowledgeGraphDocument | undefined;
  const graphState: GraphState | null = graphDoc?.state.global ?? null;
  const initAttempted = useRef(false);

  // Auto-create graph document if it doesn't exist
  useEffect(() => {
    if (!driveId || graphDoc || initAttempted.current) return;
    if (graphDocs === undefined) return; // still loading

    initAttempted.current = true;
    addDocument(driveId, "KnowledgeGraph", "bai/knowledge-graph")
      .then(() => {
        console.log("[KnowledgeVault] Auto-created knowledge-graph document");
      })
      .catch((err: unknown) => {
        console.error("[KnowledgeVault] Failed to auto-create graph doc:", err);
        initAttempted.current = false; // allow retry
      });
  }, [driveId, graphDoc, graphDocs]);

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
