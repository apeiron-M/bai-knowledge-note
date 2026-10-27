/**
 * Which document a chat request acts on (M0): the viewed document from the
 * context frame, except that a request naming exactly one *other* supported
 * document verbatim retargets to it (the card says so). When the request
 * also points at the open document, either one may be the one to change
 * ("link this note to X" changes the open note, "add this to X" changes X),
 * which only the intent settles, so the chat asks which document to change
 * before running the models. A request that refers to another document
 * without its exact title ("the CRDT MOC" for a MOC titled "CRDTs") asks
 * with the top 3 matches, plus the open document. Nothing dispatches
 * without Confirm. The pipeline needs a document type (without one, op
 * accuracy falls to 37–39%, round 9 R3/R4), so with nothing open and
 * nothing named the chat only answers questions.
 */
import type {
  CandidateDoc,
  ContextTarget,
  DocumentTarget,
} from "../context/context-frame.js";
import { lexicalScore, STOPWORDS } from "../context/candidates.js";
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
  | {
      /** The request points at the open document and names one other:
       * ask which of the two to change. The other stays a ref candidate. */
      kind: "ask";
      open: DocumentTarget;
      named: DocumentTarget;
    }
  | {
      /** The request refers to another document, but not by its exact
       * title ("the CRDT MOC" for a MOC titled "CRDTs"): ask with the top 3
       * matches, plus the open document when its type has ops. */
      kind: "pick";
      open?: DocumentTarget;
      candidates: DocumentTarget[];
      /** The words that referred to a document ("CRDT MOC"). */
      phrase: string;
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
  /** Most recent first; breaks ties among the top-3 matches. */
  recentIds?: string[];
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

/** How many documents the picker offers for a non-verbatim mention. */
export const PICK_COUNT = 3;

/** Type nouns that make a phrase refer to a document, with the document
 * types each one can mean (`null`: any). "map of content" is matched as
 * three words. */
const TYPE_NOUNS: Record<string, readonly string[] | null> = {
  note: ["bai/knowledge-note"],
  notes: ["bai/knowledge-note"],
  moc: ["bai/moc"],
  mocs: ["bai/moc"],
  map: ["bai/moc"],
  project: ["bai/project"],
  projects: ["bai/project"],
  plan: ["bai/wbs"],
  plans: ["bai/wbs"],
  wbs: ["bai/wbs"],
  doc: null,
  docs: null,
  document: null,
  documents: null,
  page: null,
  file: null,
};
/** Own keys only: "constructor" is not a type noun. */
const isTypeNoun = (w: string) => Object.hasOwn(TYPE_NOUNS, w);

/** Words that open a reference to a document. Not "a"/"an" ("this one is
 * basically a permanent note now"), and not "this" (the pointer at the
 * open document). */
const DETERMINERS = new Set(["the", "my", "our", "that"]);
/** Words after "the <noun>" that introduce its name ("the MOC on CRDTs"). */
const NAME_LINKS = new Set(["called", "named", "titled", "about", "on"]);
/** Words that end a name: prepositions, conjunctions, pointers. */
const PHRASE_BREAKS = new Set([
  ...DETERMINERS,
  ..."a an this these those it to into onto with in on".split(" "),
  ..."from for about of and or by as at is so".split(" "),
]);
/** Words in a phrase that say which one, not what it is called. */
const NOT_NAMES = new Set(
  [
    "same other current open last first second third next previous",
    "new old whole entire above below latest linked related parent main",
  ]
    .join(" ")
    .split(" "),
);

/** A phrase that refers to a document by type and not-quite name. */
export interface DocumentMention {
  /** The name words, type noun and qualifiers removed ("crdt"). */
  name: string;
  /** The document types the noun can mean; `null`: any. */
  types: readonly string[] | null;
  /** The phrase as written ("CRDT MOC"). */
  phrase: string;
}

/** The type noun at `words[i]` ("map of content" spans three words). */
function typeNounAt(
  words: string[],
  i: number,
): { len: number; types: readonly string[] | null } | null {
  const w = words.at(i) ?? "";
  if (w === "map" && words.at(i + 1) === "of" && words.at(i + 2) === "content")
    return { len: 3, types: ["bai/moc"] };
  return isTypeNoun(w) ? { len: 1, types: TYPE_NOUNS[w] } : null;
}

const nameWords = (ws: string[]) =>
  ws.filter((w) => !STOPWORDS.has(w) && !NOT_NAMES.has(w) && !isTypeNoun(w));

/**
 * Phrases that refer to a document by type and name: "the CRDT MOC",
 * "my beehive project", "the note about gossip", "the MOC called sync".
 * Only after "the", "my", "our" or "that"; "this note" is the pointer at
 * the open document, and "a note" is not a reference.
 */
export function documentMentions(utterance: string): DocumentMention[] {
  const raw = [...utterance.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => m[0]);
  const words = raw.map((w) => w.toLowerCase());
  const out: DocumentMention[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!DETERMINERS.has(words[i])) continue;
    // "the <name words> <noun>": up to four words before the noun
    for (let j = i + 1; j <= i + 5 && j < words.length; j++) {
      const noun = typeNounAt(words, j);
      if (noun) {
        const name = nameWords(words.slice(i + 1, j));
        if (name.length > 0)
          out.push({
            name: name.join(" "),
            types: noun.types,
            phrase: raw.slice(i + 1, j + noun.len).join(" "),
          });
        // "the <noun> called|about|on <name words>"
        if (j === i + 1 && NAME_LINKS.has(words[j + noun.len] ?? "")) {
          const start = j + noun.len + 1;
          let end = start;
          while (end < words.length && end < start + 4 && !PHRASE_BREAKS.has(words[end])) end++;
          const after = nameWords(words.slice(start, end));
          if (after.length > 0)
            out.push({
              name: after.join(" "),
              types: noun.types,
              phrase: raw.slice(j, end).join(" "),
            });
        }
        break;
      }
      if (PHRASE_BREAKS.has(words[j])) break;
    }
  }
  return out;
}

/**
 * The documents a non-verbatim mention may mean, best first (lexical
 * score, then recency, then title), and the mention that found them.
 * Empty when no mention matches another document, or when the open
 * document matches a mention at least as well as any other (then the
 * phrase is about the open one: "tag the CRDT note" on "CRDT merge
 * semantics").
 */
export function mentionedCandidates(
  utterance: string,
  documents: CandidateDoc[],
  opts: { openId?: string; recentIds?: string[] } = {},
): { candidates: CandidateDoc[]; phrase: string } {
  const recent = opts.recentIds ?? [];
  const rank = (id: string) => {
    const r = recent.indexOf(id);
    return r === -1 ? Number.POSITIVE_INFINITY : r;
  };
  const best = new Map<string, { d: CandidateDoc; s: number }>();
  let phrase = "";
  let top = 0;
  for (const m of documentMentions(utterance)) {
    const fits = documents.filter((d) => m.types === null || m.types.includes(d.docType));
    const scored = fits.map((d) => ({ d, s: lexicalScore(m.name, d) })).filter((x) => x.s >= 1);
    const open = scored.find((x) => x.d.id === opts.openId);
    const others = scored.filter((x) => x.d.id !== opts.openId);
    const max = Math.max(0, ...others.map((x) => x.s));
    if (others.length === 0 || (open && open.s >= max)) continue;
    if (max > top) {
      top = max;
      phrase = m.phrase;
    }
    for (const x of others) if ((best.get(x.d.id)?.s ?? 0) < x.s) best.set(x.d.id, x);
  }
  const candidates = [...best.values()]
    .sort((a, b) => b.s - a.s || rank(a.d.id) - rank(b.d.id) || a.d.title.localeCompare(b.d.title))
    .map((x) => x.d);
  return { candidates, phrase };
}

function asTarget(d: CandidateDoc, driveId: string): DocumentTarget {
  return { kind: "document", id: d.id, driveId, title: d.title, docType: d.docType };
}

/**
 * 1. exactly one other supported document named verbatim:
 *    - the request also points at the open document ("this", "this note",
 *      "it", "here") and the open document's type has ops → ask which of
 *      the two to change ("link this note to X" changes the open note,
 *      "add this to X" changes X); the other one stays a ref candidate;
 *    - otherwise → retarget (at drive level: target it). With nothing open
 *      a pointer has no referent, and with an open document that has no
 *      ops only the named one can change;
 *    Several documents named, or two sharing the named title: step 3;
 * 2. no document named verbatim, but a phrase refers to another one by
 *    type and an inexact name ("the CRDT MOC" for "CRDTs") → ask with the
 *    top 3 matches, plus the open document when its type has ops;
 * 3. the viewed document, when its type has ops;
 * 4. else unsupported (a document is open) or drive-level (nothing open).
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
  if (named.length === 1) {
    const target = asTarget(named[0], driveId);
    if (context.kind === "drive") return { kind: "document", target, via: "title" };
    if (pointsHere && i.supportedTypes.has(context.docType))
      return { kind: "ask", open: context, named: target };
    return { kind: "document", target, via: "retarget", from: context };
  }
  if (named.length === 0) {
    const openId = context.kind === "document" ? context.id : undefined;
    const { candidates, phrase } = mentionedCandidates(
      i.utterance,
      [...supported, ...viewed],
      { openId, recentIds: i.recentIds },
    );
    if (candidates.length > 0) {
      const open =
        context.kind === "document" && i.supportedTypes.has(context.docType) ? context : undefined;
      return {
        kind: "pick",
        ...(open ? { open } : {}),
        candidates: candidates.slice(0, PICK_COUNT).map((d) => asTarget(d, driveId)),
        phrase,
      };
    }
  }
  if (context.kind === "drive") return { kind: "drive", target: context };
  return i.supportedTypes.has(context.docType)
    ? { kind: "document", target: context, via: "context" }
    : { kind: "unsupported", target: context };
}

/**
 * What a turn does: run the pipeline on a document, ask which of two
 * documents to change (or which of the top 3 a mention means), answer a
 * question that
 * has no runnable document, or explain why it cannot change anything. With
 * a document there is no question rule in front: R2c's model decides
 * no-action itself.
 */
export type ChatRoute =
  | Extract<TargetResolution, { kind: "document" | "ask" | "pick" }>
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
  if (target.kind === "document" || target.kind === "ask" || target.kind === "pick")
    return target;
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
