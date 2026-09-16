import { describe, expect, it } from "vitest";
import { filterSources, normalizeQuery, toSourceRow, matchesSource } from "./source-search.js";

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
