/**
 * Per-MoC time travel: the MoC half of `shared/document-revisions`.
 *
 * The generic module fetches the operation log, folds undo into it and
 * replays it; all this file adds is the MoC model (its `createDocument` and
 * `reducer`) and one-line summaries of the MoC's own operations.
 *
 * A MoC's prose body is `orientation`, not `content` — the synthesis
 * paragraph an agent rewrites on every reweave. Its history is the record of
 * how the vault's understanding of an area was re-stated over time, which is
 * the one thing the current state deliberately throws away.
 *
 * Membership (CORE_IDEA) and hierarchy (CHILD_MOC) moved to the reactor's
 * relationship table, so recent MoCs carry few ADD_CORE_IDEA operations;
 * the ones that exist are from before that move and are still replayed.
 */
import { reducer, utils } from "document-models/moc";
import type { MocAction, MocDocument } from "document-models/moc";
import {
  humanizeOperationType,
  replayDocumentOperations,
  str,
  type DocumentOperation,
  type OperationKind,
  type ReplayResult,
} from "../../shared/document-revisions.js";

/** A MoC operation, as the reactor returns it. */
export type MocOperation = DocumentOperation;

/**
 * Replay operations with index ≤ `upToIndex` (inclusive) from an empty MoC.
 * Reducer errors are recorded and skipped, matching the reactor.
 */
export function replayToRevision(
  ops: MocOperation[],
  upToIndex: number,
): ReplayResult<MocDocument> {
  return replayDocumentOperations<MocDocument>(ops, upToIndex, {
    createDocument: () => utils.createDocument(),
    reducer: (doc, action) => reducer(doc, action as MocAction),
  });
}

function len(v: unknown): number {
  return typeof v === "string" ? v.length : 0;
}

/** One line saying what an operation did, for the revision list. */
export function describeOperation(op: MocOperation): string {
  const input = op.action.input;
  switch (op.action.type) {
    case "CREATE_MOC":
      return `Created “${str(input.title, 40)}” as ${str(input.tier)}`;
    case "UPDATE_DESCRIPTION":
      return "Description updated";
    case "UPDATE_ORIENTATION":
      return `Orientation rewritten (${len(input.orientation).toLocaleString()} chars)`;
    case "ADD_CORE_IDEA":
      return `Core idea added — ${str(input.contextPhrase, 48) || str(input.noteRef, 12)}`;
    case "UPDATE_CORE_IDEA":
      return `Core idea updated${str(input.contextPhrase) ? ` — ${str(input.contextPhrase, 48)}` : ""}`;
    case "REMOVE_CORE_IDEA":
      return "Core idea removed";
    case "REORDER_CORE_IDEAS":
      return `Core ideas reordered (${Array.isArray(input.ids) ? input.ids.length : 0})`;
    case "ADD_TENSION":
      return `Tension noted: ${str(input.description, 48)}`;
    case "REMOVE_TENSION":
      return "Tension removed";
    case "ADD_OPEN_QUESTION":
      return `Question added: ${str(input.question, 48)}`;
    case "REMOVE_OPEN_QUESTION":
      return `Question removed: ${str(input.question, 48)}`;
    case "ADD_CHILD_MOC":
      return `Child MoC added → ${str(input.childRef, 12)}`;
    case "REMOVE_CHILD_MOC":
      return "Child MoC removed";
    case "SET_METADATA_FIELD":
      return `Metadata ${str(input.field)} = ${str(input.value, 40)}`;
    default:
      return humanizeOperationType(op.action.type);
  }
}

/** Which part of the MoC an operation touched — drives a colour dot. */
export function operationKind(type: string): OperationKind {
  if (
    type === "CREATE_MOC" ||
    type === "UPDATE_DESCRIPTION" ||
    type === "UPDATE_ORIENTATION"
  )
    return "content";
  if (type.includes("CORE_IDEA") || type.includes("CHILD_MOC")) return "links";
  if (type.includes("TENSION") || type.includes("OPEN_QUESTION"))
    return "annotation";
  if (type.includes("METADATA")) return "metadata";
  return "other";
}
