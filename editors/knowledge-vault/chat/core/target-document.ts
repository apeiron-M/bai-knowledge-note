/**
 * Which document a chat request acts on (M0): the viewed document from the
 * context frame, except that a request naming exactly one *other* supported
 * document verbatim retargets to it (the card says so), unless the request
 * also points at the open document ("link this note to X": X is a
 * reference, not the target). Nothing dispatches
 * without Confirm. The pipeline needs a document type (without one, op
 * accuracy falls to 37–39%, round 9 R3/R4), so with nothing open and
 * nothing named the chat only answers questions.
 */
import type {
  CandidateDoc,
  ContextTarget,
  DocumentTarget,
} from "../context/context-frame.js";
import { looksLikeQuestion } from "./no-action-gate.js";

export type TargetResolution =
  | {
      kind: "document";
      target: DocumentTarget;
      /** `context`: the viewed document; `retarget`: named in the request
       * while viewing another document; `title`: named at drive level. */
      via: "context" | "retarget" | "title";
      /** The viewed document a retarget switched away from. */
      from?: DocumentTarget;
    }
  | { kind: "unsupported"; target: DocumentTarget }
  | { kind: "drive"; target: Extract<ContextTarget, { kind: "drive" }> };

export interface ResolveTargetInput {
  /** The context frame's target (the tag). */
  context: ContextTarget;
  /** The drive's documents (node names and known titles, no state). */
  documents: CandidateDoc[];
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

/** The longest of a document's names that the request mentions. */
function mentionedName(utterance: string, d: CandidateDoc): string | null {
  let best: string | null = null;
  for (const n of [d.title, ...(d.aliases ?? [])])
    if (mentionsTitle(utterance, n) && (!best || n.length > best.length)) best = n;
  return best;
}

/**
 * The documents a request names verbatim. A name that only appears inside
 * a longer mentioned name ("CRDTs" inside "CRDTs in practice", or inside
 * the viewed document's own title) does not count on its own.
 */
export function namedDocuments(
  utterance: string,
  documents: CandidateDoc[],
): CandidateDoc[] {
  const hits = documents
    .map((d) => ({ d, name: mentionedName(utterance, d) }))
    .filter((h): h is { d: CandidateDoc; name: string } => h.name !== null);
  return hits
    .filter(
      (h) =>
        !hits.some(
          (o) =>
            o.d.id !== h.d.id &&
            o.name.length > h.name.length &&
            o.name.toLowerCase().includes(h.name.toLowerCase()),
        ),
    )
    .map((h) => h.d);
}

/** Nouns that make "this <noun>" mean the open document. */
const DOC_NOUNS =
  "note|notes|doc|docs|document|one|page|file|moc|map|project|plan|wbs|source";
/** Words after a bare "this" that leave it pointing at the open document
 * ("link this to X", "tag this with Y"), unlike "this goal" or "this idea",
 * which name an item. */
const AFTER_BARE_THIS =
  "to|into|with|in|on|under|onto|from|for|about|as|at|by|and|or|is|so|up|over|please";
const DEICTIC = new RegExp(
  [
    `\\bthis(?=\\s+(?:${DOC_NOUNS})\\b)`,
    `\\bthis(?=\\s+(?:${AFTER_BARE_THIS})\\b)`,
    `\\bthis(?=\\s*(?:$|[^\\p{L}\\p{N}\\s]))`,
    `\\bit\\b(?!['’]s\\b)`,
    `\\bhere\\b`,
  ].join("|"),
  "iu",
);

/**
 * Whether a request points at the open document ("this", "this note",
 * "it", "here"). Document names are masked first, so a title such as
 * "Make it work" is not a pointer. "this goal" names an item, not the
 * document, and does not count.
 */
export function mentionsCurrentDocument(utterance: string, names: string[] = []): boolean {
  let masked = utterance;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const t = n.trim();
    if (t.length < 3) continue;
    masked = masked.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}(?=$|[^\\p{L}\\p{N}])`, "giu"),
      "$1 ",
    );
  }
  return DEICTIC.test(masked);
}

function asTarget(d: CandidateDoc, driveId: string): DocumentTarget {
  return { kind: "document", id: d.id, driveId, title: d.title, docType: d.docType };
}

/**
 * 1. exactly one other supported document named verbatim → retarget (or,
 *    at drive level, target it), unless the request also points at the
 *    open document ("this", "this note", "it", "here"): then the open
 *    document stays the target and the named one is only a ref candidate.
 *    With nothing open a pointer has no referent, so it does not block;
 * 2. the viewed document, when its type has ops;
 * 3. else unsupported (a document is open) or drive-level (nothing open).
 */
export function resolveTargetDocument(i: ResolveTargetInput): TargetResolution {
  const { context } = i;
  const supported = i.documents.filter((d) => i.supportedTypes.has(d.docType));
  // The viewed document takes part in the containment rule even when its
  // type is unsupported, so its own title never counts as "another" one.
  const viewed: CandidateDoc[] =
    context.kind === "document" && !supported.some((d) => d.id === context.id)
      ? [{ id: context.id, docType: context.docType, title: context.title }]
      : [];
  const named = namedDocuments(i.utterance, [...supported, ...viewed]).filter(
    (d) => !(context.kind === "document" && d.id === context.id),
  );
  const driveId = context.kind === "drive" ? context.id : context.driveId;
  const pointsHere =
    context.kind === "document" &&
    mentionsCurrentDocument(
      i.utterance,
      [...i.documents, ...viewed].flatMap((d) => [d.title, ...(d.aliases ?? [])]),
    );
  if (named.length === 1 && !pointsHere) {
    const target = asTarget(named[0], driveId);
    return context.kind === "document"
      ? { kind: "document", target, via: "retarget", from: context }
      : { kind: "document", target, via: "title" };
  }
  if (context.kind === "drive") return { kind: "drive", target: context };
  return i.supportedTypes.has(context.docType)
    ? { kind: "document", target: context, via: "context" }
    : { kind: "unsupported", target: context };
}

/**
 * What a turn does: run the pipeline on a document, answer a question that
 * has no runnable document, or explain why it cannot change anything. With
 * a document there is no question rule in front: R2c's model decides
 * no-action itself.
 */
export type ChatRoute =
  | Extract<TargetResolution, { kind: "document" }>
  | { kind: "answer"; because: "drive" | "unsupported" }
  | { kind: "explain"; text: string; create: CreateIntent | null };

export interface CreateIntent {
  docType: string;
  /** The New menu's label, which the dialog shows. */
  label: string;
}

const CREATE_TYPES: [RegExp, CreateIntent][] = [
  [/\b(map of content|moc)\b/i, { docType: "bai/moc", label: "Map of Content" }],
  [/\bproject\b/i, { docType: "bai/project", label: "Project" }],
  [/\bsource\b/i, { docType: "bai/source", label: "Add Source" }],
  [/\bnote\b/i, { docType: "bai/knowledge-note", label: "Knowledge Note" }],
];

/** "create a new note about X" → the New dialog for knowledge notes. */
export function createIntent(utterance: string): CreateIntent | null {
  if (!/\b(create|new|make|start|add)\b/i.test(utterance)) return null;
  return CREATE_TYPES.find(([re]) => re.test(utterance))?.[1] ?? null;
}

export function routeChatTurn(
  utterance: string,
  target: TargetResolution,
): ChatRoute {
  if (target.kind === "document") return target;
  if (looksLikeQuestion(utterance))
    return { kind: "answer", because: target.kind };
  if (target.kind === "unsupported")
    return {
      kind: "explain",
      text: `The chat has no operations for ${documentTypeName(target.target.docType)} documents ("${target.target.title}"). Open a note, MOC, project or plan, or name one in the request.`,
      create: null,
    };
  const create = createIntent(utterance);
  return {
    kind: "explain",
    text: create
      ? `Drive-level changes are not supported in the chat yet. You can create it with the New dialog:`
      : `Nothing is open, so there is no document to change: "${target.target.name}" is the drive, and drive-level changes are not supported yet. Open a document, or name one in the request.`,
    create,
  };
}

/** `bai/knowledge-note` → `Knowledge note`, `bai/wbs` → `WBS`. */
export function documentTypeName(docType: string): string {
  if (!docType) return "Document";
  const short = docType.slice(docType.indexOf("/") + 1);
  if (short === "wbs") return "WBS";
  if (short === "moc") return "MOC";
  if (short === "document-drive") return "Drive";
  const words = short.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
