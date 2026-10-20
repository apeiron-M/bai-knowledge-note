/**
 * Per-note time travel: the knowledge-note half of `shared/document-revisions`.
 *
 * The generic module fetches the operation log, folds undo into it and
 * replays it; all this file adds is the note model (its `createDocument` and
 * `reducer`) and one-line summaries of the note's own operations.
 */
import { reducer, utils } from "document-models/knowledge-note";
import type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
} from "document-models/knowledge-note";
import {
  fetchDocumentOperations,
  humanizeOperationType,
  replayDocumentOperations,
  str,
  type DocumentOperation,
  type OperationKind,
  type ReplayResult,
} from "../../shared/document-revisions.js";

/** A note operation, as the reactor returns it. */
export type NoteOperation = DocumentOperation;

export {
  DOCUMENT_OPERATIONS_QUERY as NOTE_OPERATIONS_QUERY,
  effectiveOperations,
  lastSignature,
} from "../../shared/document-revisions.js";

/** Fetch every global-scope operation of a note, oldest first. */
export function fetchNoteOperations(
  endpoint: string,
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NoteOperation[]> {
  return fetchDocumentOperations(endpoint, documentId, fetchImpl);
}

/**
 * Replay operations with index ≤ `upToIndex` (inclusive) from an empty note.
 * Reducer errors are recorded and skipped, matching the reactor.
 */
export function replayToRevision(
  ops: NoteOperation[],
  upToIndex: number,
): ReplayResult<KnowledgeNoteDocument> {
  return replayDocumentOperations<KnowledgeNoteDocument>(ops, upToIndex, {
    createDocument: () => utils.createDocument(),
    reducer: (doc, action) => reducer(doc, action as KnowledgeNoteAction),
  });
}

/** One line saying what an operation did, for the revision list. */
export function describeOperation(op: NoteOperation): string {
  const input = op.action.input;
  switch (op.action.type) {
    case "SET_TITLE":
      return `Title → “${str(input.title)}”`;
    case "SET_DESCRIPTION":
      return "Description updated";
    case "SET_CONTENT": {
      const len = typeof input.content === "string" ? input.content.length : 0;
      return `Content updated (${len.toLocaleString()} chars)`;
    }
    case "SET_NOTE_TYPE":
      return `Type → ${str(input.noteType)}`;
    case "ADD_TOPIC":
      return `Topic added #${str(input.name)}`;
    case "REMOVE_TOPIC":
      return "Topic removed";
    case "SET_PROVENANCE":
      return `Provenance: ${str(input.author) || "unknown"}, ${str(input.sourceOrigin)}`;
    case "SUBMIT_FOR_REVIEW":
      return `Submitted for review by ${str(input.actor)}`;
    case "APPROVE_NOTE":
      return `Approved by ${str(input.actor)}`;
    case "REJECT_NOTE":
      return `Rejected by ${str(input.actor)}: ${str(input.comment)}`;
    case "ARCHIVE_NOTE":
      return `Archived by ${str(input.actor)}`;
    case "RESTORE_NOTE":
      return `Restored by ${str(input.actor)}`;
    case "SET_METADATA_FIELD":
      return `Metadata ${str(input.field)} = ${str(input.value, 40)}`;
    case "SET_METADATA_LIST_FIELD":
      return `Metadata ${str(input.field)} (list) updated`;
    case "ADD_LINK":
      return `Link added → ${str(input.targetTitle)}`;
    case "REMOVE_LINK":
      return "Link removed";
    default:
      return humanizeOperationType(op.action.type);
  }
}

/**
 * Which part of the note an operation touched — drives a colour dot.
 * `content` is reserved for operations that write text; the note type is a
 * classification, so it files under metadata.
 */
export function operationKind(type: string): OperationKind {
  if (type === "SET_TITLE" || type === "SET_DESCRIPTION" || type === "SET_CONTENT")
    return "content";
  if (type === "SET_NOTE_TYPE") return "metadata";
  if (
    type === "SUBMIT_FOR_REVIEW" ||
    type === "APPROVE_NOTE" ||
    type === "REJECT_NOTE" ||
    type === "ARCHIVE_NOTE" ||
    type === "RESTORE_NOTE" ||
    type === "SET_STATUS"
  )
    return "lifecycle";
  if (type.includes("LINK")) return "links";
  if (type.includes("TOPIC")) return "topics";
  if (type.includes("METADATA") || type === "SET_PROVENANCE") return "metadata";
  return "other";
}
