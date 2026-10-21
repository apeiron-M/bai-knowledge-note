import { describe, expect, it } from "vitest";
import { computeHealth, type HealthInput, type HealthNote } from "./health-checks.js";

/** `count` complete notes, n0…n{count-1}; `links` maps a note to the ids it links to. */
function notes(count: number, links: Record<string, string[]> = {}): HealthNote[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `Note ${i}`,
    description: "says something",
    noteType: "concept",
    topics: ["t"],
    links: links[`n${i}`] ?? [],
  }));
}
const input = (over: Partial<HealthInput>): HealthInput => ({ notes: [], mocs: [], pendingObservations: [], openTensions: [], ...over });
const check = (r: ReturnType<typeof computeHealth>, category: string) => r.checks.find((c) => c.category === category);

/** A ring: every note links to the next, so every note has one incoming link. */
const ring = (count: number, extra = 0) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, [`n${(i + 1) % count}`, ...(i < extra ? [`n${(i + 2) % count}`] : [])]]));

describe("computeHealth", () => {
  it("grades notes without an incoming link: none passes, three warn, four fail", () => {
    // n0→n1 only: n0 and n2..n4 have no incoming link.
    expect(check(computeHealth(input({ notes: notes(4, ring(4, 4)) })), "ORPHAN_DETECTION")?.status).toBe("PASS");
    const three = computeHealth(input({ notes: notes(4, { n0: ["n1"] }) }));
    expect(check(three, "ORPHAN_DETECTION")).toMatchObject({ status: "WARN", message: "3 orphan note(s)", affectedItems: ["Note 0", "Note 2", "Note 3"] });
    expect(check(computeHealth(input({ notes: notes(5, { n0: ["n1"] }) })), "ORPHAN_DETECTION")?.status).toBe("FAIL");
  });

  it("grades links per note: 2.0 passes, 1.5 warns, under 1 fails", () => {
    expect(check(computeHealth(input({ notes: notes(4, ring(4, 4)) })), "LINK_HEALTH")).toMatchObject({ status: "PASS", message: "Avg 2.0 links/note" });
    expect(check(computeHealth(input({ notes: notes(4, ring(4, 2)) })), "LINK_HEALTH")).toMatchObject({ status: "WARN", message: "Avg 1.5 links/note (target: 2+)" });
    expect(check(computeHealth(input({ notes: notes(10, ring(9)) })), "LINK_HEALTH")?.status).toBe("FAIL");
  });

  it("is FAIL when any check fails, else WARN when any warns, else PASS", () => {
    expect(computeHealth(input({ notes: notes(4, ring(4, 4)) })).overallStatus).toBe("PASS");
    expect(computeHealth(input({ notes: notes(4, ring(4, 2)) })).overallStatus).toBe("WARN");
    expect(computeHealth(input({ notes: notes(5, { n0: ["n1"] }) })).overallStatus).toBe("FAIL");
  });

  it("checks descriptions, types and topics as the dashboard did", () => {
    const bare = notes(3, ring(3, 3)).map((n, i) => (i === 0 ? { ...n, description: "", noteType: null, topics: [] } : n));
    const r = computeHealth(input({ notes: bare }));
    expect(check(r, "DESCRIPTION_QUALITY")).toMatchObject({ status: "WARN", message: "1 missing descriptions", affectedItems: ["Note 0"] });
    expect(check(r, "SCHEMA_COMPLIANCE")).toMatchObject({ status: "WARN", message: "1 note(s) missing type" });
    expect(check(r, "MOC_COHERENCE")).toMatchObject({ status: "WARN", message: "1 note(s) without topics" });
  });

  it("only reports observations and tensions when there are some", () => {
    const quiet = computeHealth(input({ notes: notes(2, ring(2)) }));
    expect(check(quiet, "PROCESSING_THROUGHPUT")).toBeUndefined();
    expect(check(quiet, "THREE_SPACE_BOUNDARIES")).toBeUndefined();
    const busy = computeHealth(input({
      notes: notes(2, ring(2)),
      pendingObservations: [{ id: "o1", title: "An observation" }],
      openTensions: [{ id: "t1", title: "T" }, { id: "t2", title: "U" }, { id: "t3", title: "V" }, { id: "t4", title: "W" }],
    }));
    expect(check(busy, "PROCESSING_THROUGHPUT")).toMatchObject({ status: "WARN", affectedItems: ["An observation"] });
    expect(check(busy, "THREE_SPACE_BOUNDARIES")).toMatchObject({ status: "FAIL", message: "4 open tension(s) — resolve or dissolve" });
  });

  it("measures the graph: links, density, dangling links and map coverage", () => {
    const r = computeHealth(input({
      notes: notes(4, { n0: ["n1", "gone", "src"], n1: ["n0"] }),
      mocs: [{ id: "m1", coreIdeas: ["n0", "n1"] }],
      otherDocumentIds: ["src"],
    }));
    expect(r.metrics).toEqual({
      noteCount: 4,
      mocCount: 1,
      connectionCount: 2,
      density: 2 / 12,
      orphanCount: 2,
      danglingLinkCount: 1,
      mocCoverage: 0.5,
      averageLinksPerNote: 0.5,
    });
  });

  it("recommends what to fix, naming the notes", () => {
    const r = computeHealth(input({ notes: notes(4, { n0: ["n1"] }) }));
    expect(r.recommendations[0]).toEqual({ text: "Connect 3 orphan note(s) — open each and add links via the Links tab", noteIds: ["n0", "n2", "n3"] });
  });

  it("handles an empty vault", () => {
    const r = computeHealth(input({}));
    expect(r.metrics).toMatchObject({ noteCount: 0, density: 0, averageLinksPerNote: 0, mocCoverage: 0 });
    expect(r.overallStatus).toBe("FAIL");
  });
});
