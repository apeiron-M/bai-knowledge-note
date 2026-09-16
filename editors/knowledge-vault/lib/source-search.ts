/**
 * Filtering the Sources list.
 *
 * A query matches a source when every whitespace-separated term appears,
 * case-insensitively, somewhere in the fields a reader would search by:
 * title, description, author, URL, source type, status, who ingested it.
 * Multi-term queries narrow ("pdf onboarding" = both), which is what people
 * expect from a filter box; there is no ranking, order is preserved.
 */

export interface SearchableSource {
  title: string;
  description?: string | null;
  author?: string | null;
  url?: string | null;
  sourceType?: string | null;
  status?: string | null;
  createdBy?: string | null;
}

/** A row of the Sources list: what it searches by, plus what it shows. */
export interface SourceRow extends SearchableSource {
  id: string;
  name: string;
  claimCount: number;
  /** Always present — the list groups by it, so it is narrowed from the
   * optional field on `SearchableSource` and defaults to INBOX. */
  status: string;
  /** Always present — falls back to the document name. */
  title: string;
}

/**
 * Project one `bai/source` document into a list row.
 *
 * Lives here, beside the shape it has to satisfy. It used to be inline in
 * SourceList, and the two drifted: the projection read `state.author` and
 * `state.url`, but the model keeps both under `provenance`, so every row was
 * built with nulls. Nothing looked broken — author and url are search-only —
 * except that the filter box promises "title, author, URL, type" and could
 * never match two of the four.
 */
export function toSourceRow(
  header: { id: string; name: string },
  global: Record<string, unknown>,
): SourceRow {
  const provenance = (global.provenance ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    id: header.id,
    name: header.name,
    title: str(global.title) ?? header.name,
    description: str(global.description),
    author: str(provenance.author),
    url: str(provenance.url),
    sourceType: str(global.sourceType),
    status: str(global.status) ?? "INBOX",
    claimCount: Array.isArray(global.extractedClaims)
      ? global.extractedClaims.length
      : 0,
    createdBy: str(global.createdBy),
  };
}

export function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function haystack(s: SearchableSource): string {
  return [s.title, s.description, s.author, s.url, s.sourceType, s.status, s.createdBy]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n")
    .toLowerCase();
}

export function matchesSource(source: SearchableSource, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = haystack(source);
  return terms.every((t) => text.includes(t));
}

export function filterSources<T extends SearchableSource>(sources: T[], query: string): T[] {
  const terms = normalizeQuery(query);
  if (terms.length === 0) return sources;
  return sources.filter((s) => matchesSource(s, terms));
}
