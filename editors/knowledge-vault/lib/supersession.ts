/**
 * What replaced a note, if anything.
 *
 * A `SUPERSEDES` edge points from the newer claim to the one it retires. The
 * graph projection carries edges outgoing per source note, so "what
 * supersedes X" is found by scanning every note's links for a SUPERSEDES
 * edge whose target is X. The vault holds ~1,000 notes with a handful of
 * links each; a linear scan per lookup is cheap, and `supersessionIndex`
 * turns it into one pass when many lookups are needed (a chat's chips).
 */

export interface SupersedingNote {
  documentId: string;
  title: string;
  /** The edge's articulation: why the newer note retires this one. */
  reason: string | null;
}

type NoteLike = {
  id: string;
  title: string | null;
  name?: string | null;
  links: { targetDocumentId: string | null; linkType: string | null; reason?: string | null }[];
};

export type SupersessionIndex = Map<string, SupersedingNote[]>;

/** target documentId → the notes that supersede it, in note-map order. */
export function supersessionIndex(notes: Iterable<NoteLike>): SupersessionIndex {
  const index: SupersessionIndex = new Map();
  for (const note of notes) {
    for (const link of note.links) {
      if (link.linkType !== "SUPERSEDES" || !link.targetDocumentId) continue;
      const entry: SupersedingNote = {
        documentId: note.id,
        title: note.title ?? note.name ?? note.id,
        reason: link.reason ?? null,
      };
      const list = index.get(link.targetDocumentId);
      if (list) list.push(entry);
      else index.set(link.targetDocumentId, [entry]);
    }
  }
  return index;
}

/** The notes that supersede `documentId` — empty when it is current. */
export function supersededBy(notes: Iterable<NoteLike>, documentId: string): SupersedingNote[] {
  return supersessionIndex(notes).get(documentId) ?? [];
}

/** What a reader should know before trusting a cited document. */
export interface CitationCurrency {
  archived: boolean;
  supersededBy: SupersedingNote[];
}

/**
 * One pass over the notes → a lookup the chat's chips can call per citation.
 * Documents the graph does not know (sources, projects) are `null`: no claim
 * about their currency is made.
 */
export function currencyLookup(
  notes: Iterable<NoteLike & { status?: string | null }>,
): (documentId: string) => CitationCurrency | null {
  const list = [...notes];
  const index = supersessionIndex(list);
  const known = new Map(list.map((n) => [n.id, n.status ?? null]));
  return (documentId) => {
    if (!known.has(documentId)) return null;
    return {
      archived: known.get(documentId) === "ARCHIVED",
      supersededBy: index.get(documentId) ?? [],
    };
  };
}
