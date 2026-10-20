import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import type { TensionInfo } from "../hooks/use-knowledge-tensions.js";
import { kindLabel, noteSourceDocument, type SourceDocument } from "./vault-lookups.js";

/**
 * The Contradictions place (design: docs/design/vault-view, "Contradictions"):
 * each contradiction as the two notes that disagree, side by side, with the
 * reason recorded on the link between them. Pure; the view only draws it.
 */

export type ContradictionStatus = "OPEN" | "RESOLVED" | "DISSOLVED";

/** One side of a contradiction: a note, as a claim. */
export type Claim = {
  id: string;
  /** False when the note is no longer in the vault (a dead reference). */
  exists: boolean;
  title: string;
  description: string | null;
  /** "Decision", "Observation" … */
  kind: string | null;
  /** The original the note was extracted from. */
  source: string | null;
  /** The topic that holds it. */
  topic: string | null;
};

export type Contradiction = {
  id: string;
  title: string;
  status: ContradictionStatus;
  observedAt: string | null;
  observedBy: string | null;
  claims: Claim[];
  /** The reason recorded on the CONTRADICTS link between two of the claims. */
  why: string | null;
};

export type ContradictionLookups = {
  noteMap: ReadonlyMap<string, KnowledgeNoteInfo>;
  /** note id → the topic that holds it (`noteTopicIndex`) */
  topicOf: ReadonlyMap<string, MocInfo>;
  /** source id → its original (`sourceDocuments().bySource`) */
  sourceOf: ReadonlyMap<string, SourceDocument>;
};

/** A status the reader can filter by; anything unknown reads as open. */
export function contradictionStatus(raw: string | null | undefined): ContradictionStatus {
  return raw === "RESOLVED" || raw === "DISSOLVED" ? raw : "OPEN";
}

function claimOf(id: string, lookups: ContradictionLookups): Claim {
  const note = lookups.noteMap.get(id);
  if (!note) {
    return { id, exists: false, title: id, description: null, kind: null, source: null, topic: null };
  }
  return {
    id,
    exists: true,
    title: note.title ?? note.name,
    description: note.description,
    kind: kindLabel(note.noteType),
    source: noteSourceDocument(note, lookups.sourceOf)?.name ?? null,
    topic: lookups.topicOf.get(id)?.title ?? null,
  };
}

/**
 * Why the claims disagree: the reason on a CONTRADICTS link between two of
 * them, in either direction, the first claim's own link first.
 */
function reasonBetween(ids: readonly string[], noteMap: ReadonlyMap<string, KnowledgeNoteInfo>): string | null {
  const involved = new Set(ids);
  for (const id of ids) {
    const note = noteMap.get(id);
    for (const link of note?.links ?? []) {
      if (link.linkType !== "CONTRADICTS" || !link.targetDocumentId) continue;
      if (link.targetDocumentId === id || !involved.has(link.targetDocumentId)) continue;
      const reason = link.reason?.trim();
      if (reason) return reason;
    }
  }
  return null;
}

/** Every contradiction as the reader sees it, newest first (the hook's order). */
export function buildContradictions(
  tensions: readonly TensionInfo[],
  lookups: ContradictionLookups,
): Contradiction[] {
  return tensions.map((t) => ({
    id: t.id,
    title: t.title,
    status: contradictionStatus(t.status),
    observedAt: t.observedAt,
    observedBy: t.observedBy,
    claims: t.involvedRefs.map((ref) => claimOf(ref, lookups)),
    why: reasonBetween(t.involvedRefs, lookups.noteMap),
  }));
}

export type ContradictionCounts = Record<ContradictionStatus, number>;

export function countContradictions(items: readonly { status: ContradictionStatus }[]): ContradictionCounts {
  const counts: ContradictionCounts = { OPEN: 0, RESOLVED: 0, DISSOLVED: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/**
 * A contradiction in one line, for the sidebar: the claims it sets against
 * each other ("A / B"), or its own title while it has none to name.
 */
export function contradictionLabel(c: Contradiction): string {
  const named = c.claims.filter((claim) => claim.exists).map((claim) => claim.title);
  return named.length >= 2 ? named.join(" / ") : c.title;
}

const DAY_MS = 86_400_000;

/**
 * When it was found, as a phrase that follows "…recorded, ": "today at
 * 10:02 PM", "yesterday at 9:15 AM", "on Thursday", "on 4 Oct",
 * "on 4 Oct 2025". Empty when the date is missing or unreadable.
 */
export function foundWhen(iso: string | null | undefined, now: Date = new Date(), locale?: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY_MS);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days < 7) return `on ${at.toLocaleDateString(locale, { weekday: "long" })}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  return `on ${at.toLocaleDateString(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

/** The card's opening line: who found it, and when. */
export function foundLine(c: Pick<Contradiction, "observedAt" | "observedBy">, now?: Date, locale?: string): string {
  const when = foundWhen(c.observedAt, now, locale);
  const by = c.observedBy?.trim();
  if (!by || by === "graph-indexer") {
    // The graph-indexer opens one the moment two notes are linked as contradicting.
    return when
      ? `Found when the link between these notes was recorded, ${when}`
      : "Found when the link between these notes was recorded";
  }
  return when ? `Recorded by ${by}, ${when}` : `Recorded by ${by}`;
}
