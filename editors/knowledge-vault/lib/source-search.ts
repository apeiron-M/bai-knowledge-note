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
  /** Sort anchors taken from `bai/source` fields and document metadata. */
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  extractedAt: string | null;
  publishedAt: string | null;
  originalAttachedAt: string | null;
  sourceType: string | null;
  author: string | null;
  originalSizeBytes: number | null;
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
  header: { id: string; name: string; createdAtUtcIso?: string; lastModifiedAtUtcIso?: string },
  global: Record<string, unknown>,
): SourceRow {
  const provenance = (global.provenance ?? {}) as Record<string, unknown>;
  const extractionStats = (global.extractionStats ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
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
    createdAt: str(global.createdAt) ?? str(header.createdAtUtcIso),
    updatedAt: str(header.lastModifiedAtUtcIso),
    extractedAt: str(extractionStats.extractedAt),
    publishedAt: str(provenance.publishedAt),
    originalAttachedAt: str(global.originalAttachedAt),
    originalSizeBytes: num(global.originalSizeBytes),
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


export type SourceSortDirection = "asc" | "desc";

export type SourceSortField =
  | "title"
  | "sourceType"
  | "author"
  | "createdBy"
  | "created"
  | "extracted"
  | "published"
  | "attached"
  | "modified"
  | "claims"
  | "size";

/** Native `<select>` option: field plus direction, so each choice reads as a decision. */
export interface SourceSortOption {
  value: string;
  label: string;
  field: SourceSortField | "pipeline";
  direction: SourceSortDirection;
}

export const SOURCE_SORT_OPTIONS: SourceSortOption[] = [
  { value: "pipeline", label: "Pipeline order", field: "pipeline", direction: "desc" },
  { value: "title-asc", label: "Title A–Z", field: "title", direction: "asc" },
  { value: "title-desc", label: "Title Z–A", field: "title", direction: "desc" },
  { value: "type-asc", label: "Source type A–Z", field: "sourceType", direction: "asc" },
  { value: "type-desc", label: "Source type Z–A", field: "sourceType", direction: "desc" },
  { value: "author-asc", label: "Author A–Z", field: "author", direction: "asc" },
  { value: "by-asc", label: "Added by A–Z", field: "createdBy", direction: "asc" },
  { value: "created-desc", label: "Recently ingested", field: "created", direction: "desc" },
  { value: "created-asc", label: "Oldest ingested", field: "created", direction: "asc" },
  { value: "modified-desc", label: "Recently modified", field: "modified", direction: "desc" },
  { value: "extracted-desc", label: "Recently extracted", field: "extracted", direction: "desc" },
  { value: "published-desc", label: "Latest published", field: "published", direction: "desc" },
  { value: "attached-desc", label: "Recent original file", field: "attached", direction: "desc" },
  { value: "original-desc", label: "Largest original file", field: "size", direction: "desc" },
  { value: "claims-desc", label: "Most claims", field: "claims", direction: "desc" },
  { value: "claims-asc", label: "Fewest claims", field: "claims", direction: "asc" },
];

const DATE_FIELDS = new Set<SourceSortField>(["created", "extracted", "published", "attached", "modified"]);

function strValue(value: string | null): string {
  return (value ?? "").toLowerCase();
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortSources<T extends SourceRow>(
  sources: readonly T[],
  field: SourceSortField,
  direction: SourceSortDirection,
): T[] {
  const copy = [...sources];
  const sign = direction === "asc" ? 1 : -1;

  function compare(a: T, b: T): number {
    if (field === "title") {
      return sign * strValue(a.title).localeCompare(strValue(b.title));
    }
    if (field === "sourceType") {
      return sign * strValue(a.sourceType).localeCompare(strValue(b.sourceType));
    }
    if (field === "author") {
      const la = a.author == null, lb=b.author==null;
      if (la && lb) return 0;
      if (la) return 1;
      if (lb) return -1;
      return sign * strValue(a.author).localeCompare(strValue(b.author));
    }
    if (field === "createdBy") {
      const la = a.createdBy==null, lb=b.createdBy==null;
      if (la !== lb) return la ? 1 : -1;
      return sign * strValue(a.createdBy).localeCompare(strValue(b.createdBy));
    }
    if (DATE_FIELDS.has(field)) {
      const keyMap = {
        created: "createdAt",
        extracted: "extractedAt",
        published: "publishedAt",
        attached: "originalAttachedAt",
        modified: "updatedAt",
      } as const;
      const column = keyMap[field as keyof typeof keyMap];
      const av = dateValue((a as Record<string, unknown>)[column] as string | null);
      const bv = dateValue((b as Record<string, unknown>)[column] as string | null);
      if (av === bv) return 0;
      // Null/zero dates should stay below real dates.
      const aMissing = av === 0, bMissing = bv === 0;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      return sign * (av - bv);
    }
    if (field === "claims") {
      return sign * ((a.claimCount ?? 0) - (b.claimCount ?? 0));
    }
    if (field === "size") {
      return sign * ((a.originalSizeBytes ?? 0) - (b.originalSizeBytes ?? 0));
    }
    return 0;
  }

  return copy.sort(compare);
}
