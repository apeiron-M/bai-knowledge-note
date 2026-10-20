/**
 * What became of each proposal the chat made — applied, partly applied,
 * failed or cancelled — kept in this browser under the proposal's id. The
 * card reads it to show its state again after a reload; the chat reads it to
 * tell the next turn's model what the person did (see `outcomeNote`).
 *
 * Its own module, without the write path's imports, so the chat loop can read
 * an outcome without loading the reactor.
 */
import type { WorkProposal } from "./work-changes.js";

export type ChangeStatus = "done" | "failed" | "skipped";

export interface WorkOutcome {
  status: "applied" | "partial" | "failed" | "cancelled";
  /** Per change, in order. Empty for a cancelled proposal. */
  results: { status: ChangeStatus; error?: string }[];
  /** Documents the proposal created, to open from the card. */
  created: { documentId: string; documentType: string; title: string }[];
  /** Existing scopes and breakdowns it changed, to open from the card. */
  touched: { documentId: string; documentType: string; title: string }[];
  at: string;
}

/* ------------------------------------------------------------------ */
/*  What became of a proposal, kept in this browser                   */
/* ------------------------------------------------------------------ */

const key = (proposalId: string) => `bai-chat-proposal:v1:${proposalId}`;

export function readOutcome(proposalId: string): WorkOutcome | null {
  try {
    const raw = localStorage.getItem(key(proposalId));
    return raw ? (JSON.parse(raw) as WorkOutcome) : null;
  } catch {
    return null;
  }
}

export function writeOutcome(proposalId: string, outcome: WorkOutcome): void {
  try {
    localStorage.setItem(key(proposalId), JSON.stringify(outcome));
  } catch {
    /* storage full or unavailable: the card still shows the result this time */
  }
}

/* ------------------------------------------------------------------ */
/*  The proposal as the person edited it, kept in this browser        */
/* ------------------------------------------------------------------ */

const editKey = (proposalId: string) => `bai-chat-proposal-edit:v1:${proposalId}`;

export function readEdited(proposalId: string): WorkProposal | null {
  try {
    const raw = localStorage.getItem(editKey(proposalId));
    const p = raw ? (JSON.parse(raw) as WorkProposal) : null;
    return p && Array.isArray(p.changes) ? p : null;
  } catch {
    return null;
  }
}

export function writeEdited(proposal: WorkProposal): void {
  try {
    localStorage.setItem(editKey(proposal.id), JSON.stringify(proposal));
  } catch {
    /* storage full or unavailable: the card still holds the edit this time */
  }
}

/** The changes the person edited, as the card says them. */
function editedLines(p: WorkProposal): string {
  const lines = p.changes.filter((c) => c.at && p.edited?.includes(c.at)).map((c) => c.says);
  return lines.length ? ` The person edited it first: ${lines.join("; ")}.` : "";
}

/**
 * One line the next turn's model reads under the answer that proposed: what
 * the person did with it — and how they edited it, since the model's own
 * account above names things as it first proposed them. Without it, a model
 * asked "is it done?" would only know it once proposed something.
 */
export function outcomeNote(proposal: WorkProposal): string | null {
  const current = readEdited(proposal.id) ?? proposal;
  const edits = editedLines(current);
  const o = readOutcome(proposal.id);
  if (!o) return `(The proposal above — ${current.summary} — has not been applied yet.${edits})`;
  if (o.status === "cancelled") return "(The person cancelled the proposal above: nothing was changed.)";
  const made = o.results.filter((r) => r.status === "done").length;
  const createdNote = o.created.length ? ` Created: ${o.created.map((d) => `${d.title} [[${d.documentId}]]`).join(", ")}.` : "";
  if (o.status === "applied") {
    return `(The person applied the proposal above: ${made === 1 ? "the change was" : `all ${made} changes were`} made.${createdNote}${edits})`;
  }
  const failed = o.results.find((r) => r.status === "failed");
  return `(The person applied the proposal above, but it stopped: ${made} of ${o.results.length} changes were made; the next failed — ${failed?.error ?? "unknown error"}.${createdNote}${edits})`;
}

