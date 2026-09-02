/**
 * Per-note time travel, from the operation log.
 *
 * The reactor never exposes "state as of revision N" over GraphQL — its
 * `view` filter takes only `branch` and `scopes`, and the browser client
 * throws on a `revision` by design. What it does expose is every operation
 * with its full action input, in order, with the signer who made it. And
 * the editor already holds the knowledge-note reducer. So a revision is a
 * pure function: replay operations 0…N through the reducer.
 *
 * This module is the pure half: fetch shapes, replay, and the per-operation
 * summary. `useNoteRevisions` wraps it for React.
 */
import {
  garbageCollect,
  sortOperations,
} from "@powerhousedao/shared/document-model";
import { reducer, utils } from "document-models/knowledge-note";
import type {
  KnowledgeNoteAction,
  KnowledgeNoteDocument,
} from "document-models/knowledge-note";

export type NoteOperation = {
  index: number;
  skip: number;
  timestampUtcMs: string;
  hash: string;
  error: string | null;
  action: {
    id: string;
    type: string;
    scope: string;
    timestampUtcMs: string;
    input: Record<string, unknown>;
    context: {
      signer: {
        user: { address: string; networkId: string; chainId: number } | null;
        app: { name: string; key: string } | null;
        signatures: string[];
      } | null;
    } | null;
  };
};

/** One page of the wire shape (`PHDocument.operations`). */
export type NoteOperationsPage = {
  items: NoteOperation[];
  totalCount: number;
  hasNextPage: boolean;
  cursor: string | null;
};

export const NOTE_OPERATIONS_QUERY = `
  query NoteOperations($id: String!, $cursor: String) {
    document(identifier: $id, view: { branch: "main" }) {
      document {
        operations(
          filter: { scopes: ["global"] }
          paging: { limit: 200, cursor: $cursor }
        ) {
          items {
            index
            skip
            timestampUtcMs
            hash
            error
            action {
              id
              type
              scope
              timestampUtcMs
              input
              context {
                signer {
                  user { address networkId chainId }
                  app { name key }
                  signatures
                }
              }
            }
          }
          totalCount
          hasNextPage
          cursor
        }
      }
    }
  }
`;

/**
 * Fetch every global-scope operation of a document, oldest first. Pages
 * through the reactor's cursor; a note with more than 20 × 200 operations is
 * not a note, so the loop is bounded rather than trusting `hasNextPage`.
 */
export async function fetchNoteOperations(
  endpoint: string,
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NoteOperation[]> {
  const all: NoteOperation[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: NOTE_OPERATIONS_QUERY,
        variables: { id: documentId, cursor },
      }),
    });
    if (!res.ok) throw new Error(`operations fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { document?: { document?: { operations?: NoteOperationsPage } } };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "operations fetch failed");
    }
    const pageData = json.data?.document?.document?.operations;
    if (!pageData) break;
    all.push(...pageData.items);
    if (!pageData.hasNextPage || !pageData.cursor) break;
    cursor = pageData.cursor;
  }
  return sortOperations(all);
}

/**
 * The operations that are actually in effect: `skip` (undo) folded in, so a
 * replay applies exactly what the reactor applied.
 */
export function effectiveOperations(ops: NoteOperation[]): NoteOperation[] {
  return garbageCollect(sortOperations(ops));
}

export type ReplayResult = {
  document: KnowledgeNoteDocument;
  /** Operations whose reducer refused them during replay (index → reason). */
  failures: Array<{ index: number; type: string; reason: string }>;
};

/**
 * Replay operations with index ≤ `upToIndex` (inclusive) from an empty
 * document. Reducer errors are recorded and skipped, matching the reactor
 * (an errored operation is stored but does not mutate state).
 */
export function replayToRevision(
  ops: NoteOperation[],
  upToIndex: number,
): ReplayResult {
  let document = utils.createDocument();
  const failures: ReplayResult["failures"] = [];
  for (const op of effectiveOperations(ops)) {
    if (op.index > upToIndex) break;
    // An operation the reactor already refused changed nothing then either.
    if (op.error) {
      failures.push({ index: op.index, type: op.action.type, reason: op.error });
      continue;
    }
    try {
      const before = document.operations.global.length;
      document = reducer(document, op.action as unknown as KnowledgeNoteAction);
      const applied = document.operations.global[before];
      if (applied?.error) {
        failures.push({
          index: op.index,
          type: op.action.type,
          reason: applied.error,
        });
      }
    } catch (e) {
      failures.push({
        index: op.index,
        type: op.action.type,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { document, failures };
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                              */
/* ------------------------------------------------------------------ */

function str(v: unknown, max = 60): string {
  if (typeof v !== "string") return "";
  return v.length > max ? `${v.slice(0, max)}…` : v;
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
      return op.action.type
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Which part of the note an operation touched — drives a colour dot. */
export function operationKind(
  type: string,
): "content" | "lifecycle" | "links" | "topics" | "metadata" | "other" {
  if (
    type === "SET_TITLE" ||
    type === "SET_DESCRIPTION" ||
    type === "SET_CONTENT" ||
    type === "SET_NOTE_TYPE"
  )
    return "content";
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

/** The last signature on an operation, or null when unsigned. */
export function lastSignature(op: NoteOperation): string | null {
  const sigs = op.action.context?.signer?.signatures;
  if (!sigs || sigs.length === 0) return null;
  return sigs[sigs.length - 1] ?? null;
}
