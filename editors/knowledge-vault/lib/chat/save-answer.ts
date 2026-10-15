/**
 * Saving a chat answer as a knowledge note — the drafting half.
 *
 * The chat reads; this is the one place it proposes a write, and it only
 * proposes: everything here is pure and returns a draft the person edits and
 * confirms. `use-save-answer.ts` performs the confirmed write, through the
 * same calls the vault's own "Write a note" and note editor make.
 *
 * What a good saved note needs, and where each part comes from:
 *
 *   title        the answer's first sentence — a claim, which the person
 *                edits into the one claim they want to keep
 *   description  the sentences after it, cut to the model's 200 characters
 *                (counted as JavaScript counts them: the reducer's own rule)
 *   body         the answer, its [[documentId]] markers rewritten as
 *                [[Title]] — the vault's own reference style — and a line
 *                saying which question it answered
 *   links        one per cited document: BUILDS_ON a note, DERIVED_FROM a
 *                source, each with the sentence of the answer it supports as
 *                its reason, so every edge passes the articulation test
 */
import { parseMarker } from "./evidence.js";
import type { Citation, StoredMessage } from "./chat-storage.js";

/** The reducer's one hard limit, counted as `String.prototype.length` counts. */
export const DESCRIPTION_MAX = 200;

/** The kinds a note can be, as the model's v2 enum spells them. */
export const NOTE_KINDS = [
  "CONCEPT",
  "DECISION",
  "PATTERN",
  "OBSERVATION",
  "PROCEDURE",
  "ARCHITECTURE",
  "BUG_PATTERN",
  "INTEGRATION",
  "WORKFLOW",
  "REFERENCE",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** How a kind reads in the form. */
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  CONCEPT: "Concept",
  DECISION: "Decision",
  PATTERN: "Pattern",
  OBSERVATION: "Observation",
  PROCEDURE: "Procedure",
  ARCHITECTURE: "Architecture",
  BUG_PATTERN: "Bug pattern",
  INTEGRATION: "Integration",
  WORKFLOW: "Workflow",
  REFERENCE: "Reference",
};

export type LinkType = "BUILDS_ON" | "DERIVED_FROM";

/** One edge the saved note will carry, as the form shows it. */
export interface DraftLink {
  documentId: string;
  title: string;
  documentType: string | null;
  linkType: LinkType;
  /** "A connects to B because …": the sentence of the answer this document supports. */
  reason: string;
  /** grounded when the chat read the passage it cites; speculative when it cited unread. */
  confidence: "grounded" | "speculative";
  /** Whether it will be created; the person can untick it. */
  include: boolean;
}

export interface AnswerDraft {
  title: string;
  description: string;
  kind: NoteKind;
  topics: string[];
  content: string;
  links: DraftLink[];
  /** Maps of content the answer cited: offered as the place to file the note. */
  maps: Citation[];
  /** Cited documents a note does not link to (contradictions, projects…): named in the body only. */
  notLinked: Citation[];
}

const MARKER = /\[\[([^\]]+)\]\]/g;

/** Markdown and citation markers off, whitespace tidy: what a sentence reads as. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\s*\[\[[^\]]+\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The answer's sentences, in order: one per heading or list item, prose split at full stops. */
export function sentencesOf(markdown: string): string[] {
  const out: string[] = [];
  for (const raw of markdown.split(/\n+/)) {
    const line = plainText(
      raw
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""),
    );
    if (!line || /^[-*_]{3,}$/.test(line) || line.startsWith("|")) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\p{N}])/u)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** As many whole sentences as fit; a first sentence that alone is too long is cut at a word. */
export function fitDescription(sentences: string[], max = DESCRIPTION_MAX): string {
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= max) {
      out = next;
      continue;
    }
    if (!out) {
      const cut = s.slice(0, max - 1);
      const space = cut.lastIndexOf(" ");
      out = `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
    }
    break;
  }
  return out;
}

const NOTE_LIKE = new Set(["bai/knowledge-note", "bai/research-claim"]);

/** A title safe inside [[…]]: no brackets or pipes to break the reference. */
const referenceTitle = (title: string) => title.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The whole sentence a marker sits in, up to the marker, in plain text — kept
 * short enough to be a reason. The whole sentence, not the clause after the
 * previous marker: "Backlogs of 220 GW sit against … so buyers reserve slots"
 * says why; ", so buyers reserve slots" does not.
 */
export function sentenceAt(content: string, index: number): string {
  const before = content.slice(0, index);
  let segment = before.slice(before.lastIndexOf("\n") + 1);
  const ends = [...segment.matchAll(/[.!?](?=\s)/g)];
  const last = ends.at(-1);
  if (last) segment = segment.slice(last.index + 1);
  const sentence = plainText(segment)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/^[\s,;:–—-]+/, "")
    .replace(/[\s.!?:;,]+$/, "");
  return sentence.length > 180 ? `${sentence.slice(0, 177).replace(/\s+\S*$/, "")}…` : sentence;
}

/**
 * The note an answer would become, before the person edits it.
 *
 * `question` is what the answer replied to: it closes the body, and it is the
 * reason of last resort for a citation no sentence can be found for.
 */
export function draftFromAnswer(message: StoredMessage, question: string): AnswerDraft {
  const content = message.content;
  // The claim is the first sentence; its description, the rest of that
  // paragraph — or the next paragraph when the claim stands alone. A later
  // paragraph is usually about something else (where the vault files it,
  // what is still open), which a description should not carry.
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(sentencesOf)
    .filter((p) => p.length > 0);
  const first = paragraphs[0] ?? [];
  const title = (first[0] ?? "").replace(/\.$/, "");
  const description = fitDescription(first.length > 1 ? first.slice(1) : (paragraphs[1] ?? []));
  const citations = message.citations ?? [];
  const byId = new Map(citations.map((c) => [c.documentId, c]));

  // Where each cited document is first cited, and whether the chat had read
  // the passage behind any of its markers.
  const firstAt = new Map<string, number>();
  for (const m of content.matchAll(MARKER)) {
    const { documentId } = parseMarker(m[1]);
    if (!firstAt.has(documentId)) firstAt.set(documentId, m.index);
  }
  const read = new Set((message.evidence ?? []).filter((e) => e.quote).map((e) => e.documentId));
  const asked = plainText(question).slice(0, 160);

  const links: DraftLink[] = [];
  const maps: Citation[] = [];
  const notLinked: Citation[] = [];
  for (const c of citations) {
    const type = c.documentType ?? null;
    if (type === "bai/moc") {
      maps.push(c);
      continue;
    }
    // An untyped citation came from a tool that did not say; nearly all are notes.
    const linkType: LinkType | null =
      type === "bai/source" ? "DERIVED_FROM" : type === null || NOTE_LIKE.has(type) ? "BUILDS_ON" : null;
    if (!linkType) {
      notLinked.push(c);
      continue;
    }
    const at = firstAt.get(c.documentId);
    const sentence = at === undefined ? "" : sentenceAt(content, at);
    links.push({
      documentId: c.documentId,
      title: c.title,
      documentType: type,
      linkType,
      reason:
        sentence.length >= 20
          ? `The saved chat answer cites it for: “${sentence}”`
          : `Cited by the chat answer to “${asked}”, which this note keeps`,
      confidence: read.has(c.documentId) ? "grounded" : "speculative",
      include: true,
    });
  }

  // The body: markers as [[Title]], repeats of the same reference collapsed,
  // and the question it answered — a reader of the note should know.
  const body = content
    .replace(MARKER, (_m, label: string) => {
      const { documentId } = parseMarker(label);
      const c = byId.get(documentId);
      return c ? `[[${referenceTitle(c.title)}]]` : "";
    })
    .replace(/(\[\[([^\]]+)\]\])(?:\s*\[\[\2\]\])+/g, "$1")
    // Read as citations, not prose: references side by side become one
    // parenthesis — "… years ahead ([[Turbine note]]; [[Report part 3]])."
    .replace(/(?:[ \t]*\[\[[^\]]+\]\])+/g, (group) => {
      const refs = group.match(/\[\[[^\]]+\]\]/g) ?? [];
      return ` (${refs.join("; ")})`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const note = asked ? `\n\n*Saved from the vault chat, in answer to: “${asked}”*` : "";

  return {
    title,
    description,
    kind: "CONCEPT",
    topics: [],
    content: `${body}${note}`,
    links,
    maps,
    notLinked,
  };
}

export interface DraftProblem {
  field: "title" | "description";
  message: string;
}

/** What stops a save: the person sees these beside the fields, not after a failed write. */
export function draftProblems(d: Pick<AnswerDraft, "title" | "description">): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!d.title.trim()) problems.push({ field: "title", message: "Give the note its claim, in one sentence." });
  if (!d.description.trim()) {
    problems.push({ field: "description", message: "Add a description: what the claim leaves out." });
  } else if (d.description.trim().length > DESCRIPTION_MAX) {
    problems.push({
      field: "description",
      message: `${d.description.trim().length - DESCRIPTION_MAX} characters over the ${DESCRIPTION_MAX} a description can hold.`,
    });
  }
  return problems;
}

/** The document's name in the drive: the title as a slug, as the pipeline names notes. */
export function noteSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "saved-chat-answer";
}

/** Topic names from a comma- or newline-separated field, trimmed, without repeats. */
export function parseTopics(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(/[,\n]/)) {
    const name = t.trim().replace(/^#/, "");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
