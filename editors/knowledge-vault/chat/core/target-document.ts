/**
 * Which document a chat request acts on. The v1 pipeline (R2c) needs one:
 * its step-1 list is that document's model's ops, and with no document type
 * it falls to 37–39% op (round 9 R3/R4). So the chat never guesses across
 * models; without a target it asks the user to pick a document. Questions
 * need no document and go to the answer path.
 */
import { looksLikeQuestion } from "./no-action-gate.js";
import type { ChatDocument } from "./ref-candidates.js";

export type TargetResolution =
  | { kind: "document"; doc: ChatDocument; via: "selected" | "title" }
  | {
      kind: "ask";
      reason: "none" | "unsupported" | "ambiguous";
      /** The documents the user can pick from (supported types only). */
      options: ChatDocument[];
    };

export interface ResolveTargetInput {
  /** The picked document's id, or null / "" when none is picked. */
  selectedId: string | null;
  documents: ChatDocument[];
  /** Document types the chat has ops for. */
  supportedTypes: ReadonlySet<string>;
  utterance: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `title` occurs in `utterance` as a whole phrase (any case). */
export function mentionsTitle(utterance: string, title: string): boolean {
  const t = title.trim();
  if (t.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}($|[^\\p{L}\\p{N}])`, "iu").test(
    utterance,
  );
}

/**
 * The picked document when it has a supported type; with none picked, the
 * one supported document whose title the request names; otherwise ask.
 */
export function resolveTargetDocument(i: ResolveTargetInput): TargetResolution {
  const options = i.documents.filter((d) => i.supportedTypes.has(d.docType));
  const selected = i.selectedId
    ? i.documents.find((d) => d.id === i.selectedId)
    : undefined;
  if (selected)
    return i.supportedTypes.has(selected.docType)
      ? { kind: "document", doc: selected, via: "selected" }
      : { kind: "ask", reason: "unsupported", options };
  const named = options.filter((d) => mentionsTitle(i.utterance, d.title));
  if (named.length === 1)
    return { kind: "document", doc: named[0], via: "title" };
  return named.length > 1
    ? { kind: "ask", reason: "ambiguous", options: named }
    : { kind: "ask", reason: "none", options };
}

/**
 * What a turn does: run the pipeline on a document, answer a question that
 * has no document, or ask for a document. With a document there is no
 * question rule in front: R2c's model decides no-action itself.
 */
export type ChatRoute =
  | { kind: "run"; doc: ChatDocument; via: "selected" | "title" }
  | { kind: "answer" }
  | {
      kind: "ask";
      reason: "none" | "unsupported" | "ambiguous";
      options: ChatDocument[];
    };

export function routeChatTurn(
  utterance: string,
  target: TargetResolution,
): ChatRoute {
  if (target.kind === "document")
    return { kind: "run", doc: target.doc, via: target.via };
  if (looksLikeQuestion(utterance)) return { kind: "answer" };
  return target;
}

/** `bai/knowledge-note` → `Knowledge note`, `bai/wbs` → `WBS`. */
export function documentTypeName(docType: string): string {
  const short = docType.slice(docType.indexOf("/") + 1);
  if (short === "wbs") return "WBS";
  const words = short.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The chat's reply when it needs a document, listing the choices. */
export function askForDocumentText(
  reason: "none" | "unsupported" | "ambiguous",
  options: ChatDocument[],
): string {
  const head =
    reason === "unsupported"
      ? "The chat has no operations for the selected document's type. Pick one of these documents:"
      : reason === "ambiguous"
        ? "The request names more than one document. Pick the one to change:"
        : "Which document should this change? Pick one in the Target menu:";
  if (options.length === 0)
    return `${head}\n(no supported documents in this drive)`;
  return [
    head,
    ...options.map((d) => `• ${d.title} (${documentTypeName(d.docType)})`),
  ].join("\n");
}
