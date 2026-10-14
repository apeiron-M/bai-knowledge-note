import { describe, expect, it } from "vitest";
import { filterSources, normalizeQuery, toSourceRow, matchesSource, sortSources } from "./source-search.js";

const sources = [
  { id: "a", title: "Reactor authorization deep dive", description: "Policies at boot", author: "Anna", url: "https://docs.powerhouse.io/auth", sourceType: "DOCUMENTATION", status: "EXTRACTED", createdBy: "liberuum" },
  { id: "b", title: "Onboarding call transcript", description: null, author: null, url: null, sourceType: "TRANSCRIPT", status: "INBOX", createdBy: "agent" },
  { id: "c", title: "PGlite storage notes", description: "snapshot.bin and the read-storage cache", author: "Paul", url: null, sourceType: "MANUAL_ENTRY", status: "EXTRACTED", createdBy: null },
];

describe("filterSources", () => {
  it("returns everything for an empty or blank query", () => {
    expect(filterSources(sources, "")).toBe(sources);
    expect(filterSources(sources, "   ")).toBe(sources);
    expect(normalizeQuery("  ")).toEqual([]);
  });

  it("matches case-insensitively across title, description, author, url, type, status and ingester", () => {
    expect(filterSources(sources, "AUTHORIZATION").map((s) => s.id)).toEqual(["a"]);
    expect(filterSources(sources, "snapshot").map((s) => s.id)).toEqual(["c"]);
    expect(filterSources(sources, "paul").map((s) => s.id)).toEqual(["c"]);
    expect(filterSources(sources, "docs.powerhouse").map((s) => s.id)).toEqual(["a"]);
    expect(filterSources(sources, "transcript").map((s) => s.id)).toEqual(["b"]);
    expect(filterSources(sources, "extracted").map((s) => s.id)).toEqual(["a", "c"]);
    expect(filterSources(sources, "liberuum").map((s) => s.id)).toEqual(["a"]);
  });

  it("narrows with every additional term and preserves order", () => {
    expect(filterSources(sources, "extracted notes").map((s) => s.id)).toEqual(["c"]);
    expect(filterSources(sources, "extracted nothing-here")).toEqual([]);
  });
});

describe("toSourceRow", () => {
  const header = { id: "s1", name: "moby-dick-ch-3" };

  it("reads author and url from provenance, where the model keeps them", () => {
    // The bug: these were read from the top level, so every row carried null
    // and the filter box could not match two of the four fields it advertises.
    const row = toSourceRow(header, {
      title: "Moby Dick, chapter 3",
      provenance: { author: "Herman Melville", url: "https://example.org/md/3" },
    });
    expect(row.author).toBe("Herman Melville");
    expect(row.url).toBe("https://example.org/md/3");
    expect(matchesSource(row, normalizeQuery("melville"))).toBe(true);
    expect(matchesSource(row, normalizeQuery("example.org"))).toBe(true);
  });

  it("does not read them from the top level, where they do not exist", () => {
    const row = toSourceRow(header, {
      title: "t",
      author: "wrong",
      url: "wrong",
      provenance: {},
    });
    expect(row.author).toBeNull();
    expect(row.url).toBeNull();
  });

  it("survives a source with no provenance at all", () => {
    const row = toSourceRow(header, { title: "t" });
    expect(row.author).toBeNull();
    expect(row.url).toBeNull();
    expect(row.status).toBe("INBOX");
    expect(row.claimCount).toBe(0);
  });

  it("falls back to the document name when the state has no title", () => {
    expect(toSourceRow(header, {}).title).toBe("moby-dick-ch-3");
  });

  it("counts extracted claims", () => {
    expect(toSourceRow(header, { extractedClaims: ["a", "b"] }).claimCount).toBe(2);
  });
});

describe("sortSources", () => {
  const rows = [
    toSourceRow({ id: "one", name: "zzz" }, { title: "Zulu", sourceType: "PAPER", status: "INBOX", createdAt: "2024-01-20", extractionStats: { extractedAt: null }, provenance: { publishedAt: "2020-01-01" }, originalAttachedAt: "2024-02-01", originalSizeBytes: 2000, createdBy: "zeta", extractedClaims: ["a"] }),
    toSourceRow({ id: "two", name: "aaa" }, { title: "Apple", sourceType: "ARTICLE", status: "EXTRACTED", createdAt: "2024-01-10", extractionStats: { extractedAt: "2024-03-01" }, provenance: { publishedAt: "2024-04-01" }, originalAttachedAt: "2024-01-15", originalSizeBytes: 100, createdBy: "alpha", extractedClaims: ["a", "b"] }),
    toSourceRow({ id: "three", name: "mid" }, { title: "Middle", status: "ARCHIVED", createdBy: null }),
  ];

  it("sorts titles alphabetically", () => {
    expect(sortSources(rows, "title", "asc").map((r) => r.title)).toEqual(["Apple", "Middle", "Zulu"]);
  });

  it("puts new ingestion first by default", () => {
    expect(sortSources(rows, "created", "desc").map((r) => r.title)).toEqual(["Zulu", "Apple", "Middle"]);
  });

  it("keeps missing dates last in either direction", () => {
    const asc = sortSources(rows, "created", "asc").map((r) => r.id);
    const desc = sortSources(rows, "created", "desc").map((r) => r.id);
    expect(asc[2]).toBe("three");
    expect(desc[2]).toBe("three");
  });

  it("sorts numeric claims descending and ascending", () => {
    expect(sortSources(rows, "claims", "desc").map((r) => r.id)).toEqual(["two", "one", "three"]);
    expect(sortSources(rows, "claims", "asc").map((r) => r.id)).toEqual(["three", "one", "two"]);
  });

  it("sorts modified dates and does not mutate the input", () => {
    const before = rows.map((r) => r.id);
    const result = sortSources(rows, "modified", "desc");
    expect(rows.map((r) => r.id)).toEqual(before);
    // `three` has no extracted/modified timestamps, so it should sort last.
    expect(result[result.length - 1].id).toBe("three");
  });
});
