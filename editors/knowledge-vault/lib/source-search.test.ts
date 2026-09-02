import { describe, expect, it } from "vitest";
import { filterSources, normalizeQuery } from "./source-search.js";

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
