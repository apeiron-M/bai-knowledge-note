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
