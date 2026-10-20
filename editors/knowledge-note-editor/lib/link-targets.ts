/**
 * Where a manual link may point. Manual entry is gone: a target is always a
 * document of this vault — chosen from a list, or a pasted id that names one —
 * so no link is born with an empty or invented target (spec §6).
 *
 * "Derived from" lists the vault's sources (a note is drawn from a source);
 * every other kind lists notes. A pasted id may name a document of any kind,
 * and is offered first, as "Chapter 3 Hardware · source".
 */
import type { LinkType } from "document-models/knowledge-note";
import type { VaultDocSummary } from "../../shared/vault-doc-index-store.js";

export type LinkCandidate = { id: string; title: string; kind: string };

const NOTE_TYPE = "bai/knowledge-note";
const SOURCE_TYPE = "bai/source";

const KIND_WORDS: Record<string, string> = {
  [NOTE_TYPE]: "note",
  "bai/moc": "map",
  "bai/wbs": "work breakdown",
  "powerhouse/scopeofwork": "scope of work",
};

/** What a document is, in a word or two: "note", "source", "map", "work breakdown". */
export function documentKind(documentType: string): string {
  return KIND_WORDS[documentType] ?? documentType.replace(/^[^/]+\//, "").replace(/-/g, " ");
}

/** "Chapter 3 Hardware · source" — how a candidate reads in the picker. */
export const candidateLabel = (c: LinkCandidate): string => `${c.title} · ${c.kind}`;

const asCandidate = (d: VaultDocSummary): LinkCandidate => ({ id: d.id, title: d.title, kind: documentKind(d.documentType) });

/**
 * The documents a link of this kind may point at: sources for "Derived from",
 * notes for every other kind. Never the note itself, nor anything in `exclude`.
 */
export function linkCandidates(o: {
  linkType: LinkType;
  noteId: string;
  knowledgeDocs: readonly VaultDocSummary[];
  byId: ReadonlyMap<string, VaultDocSummary>;
  exclude: ReadonlySet<string>;
}): LinkCandidate[] {
  const pool =
    o.linkType === "DERIVED_FROM"
      ? [...o.byId.values()].filter((d) => d.documentType === SOURCE_TYPE)
      : o.knowledgeDocs.filter((d) => d.documentType === NOTE_TYPE);
  return pool.filter((d) => d.id !== o.noteId && !o.exclude.has(d.id)).map(asCandidate);
}

/** A pasted id that names a document in this drive — of any kind — or null. */
export function pastedIdMatch(
  query: string,
  o: { noteId: string; byId: ReadonlyMap<string, VaultDocSummary>; exclude: ReadonlySet<string> },
): LinkCandidate | null {
  const id = query.trim();
  if (!id || id === o.noteId || o.exclude.has(id)) return null;
  const d = o.byId.get(id);
  return d ? asCandidate(d) : null;
}

/** What the picker lists for a query: the pasted match first, then title or id matches — at most `limit`. */
export function searchCandidates(
  query: string,
  candidates: readonly LinkCandidate[],
  pasted: LinkCandidate | null,
  limit = 20,
): LinkCandidate[] {
  const q = query.trim().toLowerCase();
  const hits = q
    ? candidates.filter((c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    : [...candidates];
  const rest = pasted ? hits.filter((c) => c.id !== pasted.id) : hits;
  return (pasted ? [pasted, ...rest] : rest).slice(0, limit);
}

/** The documents a note's links already point at — all of them, or those of one kind (no kind is "Relates to"). */
export function linkedTargets(
  links: readonly { targetDocumentId: string | null; linkType: string | null }[],
  kind?: string,
): Set<string> {
  return new Set(
    links.flatMap((l) =>
      l.targetDocumentId && (kind === undefined || (l.linkType ?? "RELATES_TO") === kind) ? [l.targetDocumentId] : [],
    ),
  );
}
