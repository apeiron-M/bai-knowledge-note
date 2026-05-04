import { useMemo } from "react";
import { useFileNodesInSelectedDrive } from "@powerhousedao/reactor-browser";
import { useDocumentsSafe } from "./use-documents-safe.js";
import type { KnowledgeNoteState } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

export type KnowledgeNoteInfo = {
  id: string;
  name: string;
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

export function useKnowledgeNotes() {
  const fileNodes = useFileNodesInSelectedDrive();
  const documents = useDocumentsSafe();

  const knowledgeFileNodes = useMemo(
    () =>
      (fileNodes ?? []).filter((n) => n.documentType === "bai/knowledge-note"),
    [fileNodes],
  );

  const docMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const doc of documents ?? []) {
      if (doc.header.documentType === "bai/knowledge-note") {
        map.set(doc.header.id, doc as Record<string, unknown>);
      }
    }
    return map;
  }, [documents]);

  const notes: KnowledgeNoteInfo[] = useMemo(() => {
    // Return one entry per drive file node so the lists/graph render even
    // before each per-doc payload has replicated into IndexedDB. Title /
    // topics / links / provenance fill in progressively as docs arrive.
    return knowledgeFileNodes.map((node) => {
      const doc = docMap.get(node.id);
      const state = (doc?.state as { global?: KnowledgeNoteState } | undefined)
        ?.global;
      if (!state) {
        return {
          id: node.id,
          name: node.name,
          title: null,
          noteType: null,
          status: "DRAFT",
          description: null,
          topics: [],
          links: [],
          provenance: null,
        };
      }
      return {
        id: node.id,
        name: node.name,
        title: state.title ?? null,
        noteType: state.noteType ?? null,
        status: (state.status as string) ?? "DRAFT",
        description: state.description ?? null,
        topics: (state.topics ?? []).map((t) => ({ id: t.id, name: t.name })),
        links: (state.links ?? []).map((l) => ({
          id: l.id,
          targetDocumentId: l.targetDocumentId ?? null,
          targetTitle: l.targetTitle ?? null,
          linkType: (l.linkType as string) ?? null,
        })),
        provenance: state.provenance
          ? {
              author: state.provenance.author ?? null,
              createdAt: (state.provenance.createdAt as string) ?? null,
              updatedAt: (state.provenance.updatedAt as string) ?? null,
            }
          : null,
      };
    });
  }, [knowledgeFileNodes, docMap]);

  const noteMap = useMemo(() => {
    const map = new Map<string, KnowledgeNoteInfo>();
    for (const note of notes) {
      map.set(note.id, note);
    }
    return map;
  }, [notes]);

  return { notes, noteMap };
}
