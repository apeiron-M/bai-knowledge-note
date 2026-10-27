import { describe, expect, it } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { foldText, paletteGroups, paletteRows, paletteSemanticFrom, stepRow, type PaletteData } from "./palette-search.js";
import type { SourceDocument } from "./vault-lookups.js";

function note(id: string, title: string, description = "", createdAt = "2026-10-01T00:00:00Z"): KnowledgeNoteInfo {
  return {
    id, name: id, title, description, noteType: "concept", status: "DRAFT", topics: [],
    links: [{ id: `${id}-d`, targetDocumentId: "src-1", targetTitle: null, linkType: "DERIVED_FROM", reason: null, confidence: null }],
    provenance: { author: null, createdAt, updatedAt: createdAt },
  };
}
const moc = (id: string, title: string, tier: MocInfo["tier"], noteCount: number, description = ""): MocInfo =>
  ({ id, title, tier, noteCount, description, coreIdeas: [], childRefs: [] });

const report: SourceDocument = { id: "f-1", name: "State of AI Report 2026", fileName: "State-of-AI-Report-2026", kind: "folder", sourceIds: ["src-1"] };
const data = (over: Partial<PaletteData> = {}): PaletteData => ({
  notes: [
    note("n1", "Gas turbine orders exceed annual build capacity", "Backlogs stretch to 2029", "2026-10-02T00:00:00Z"),
    note("n2", "Large‑frame turbines are sold out", "Data centers buy them first", "2026-10-03T00:00:00Z"),
    note("n3", "Robots build data centers", "Construction speeds up", "2026-10-01T00:00:00Z"),
  ],
  topicOf: new Map(),
  sourceOf: new Map([["src-1", report]]),
  topics: [moc("t1", "AI data center power", "TOPIC", 15, "Turbine demand"), moc("t2", "Crypto markets", "TOPIC", 30)],
  hub: moc("h", "Liberuum", "HUB", 0),
  sources: [report],
  notesPerSource: new Map([["f-1", 3]]),
  chats: [{ id: "c1", title: "Can turbine makers keep up?", updatedAt: "2026-10-04T00:00:00Z" }],
  ...over,
});

describe("the Ctrl K palette", () => {
  it("folds dashes, quotes, accents and case, so what you type finds how it was written", () => {
    expect(foldText("Large‑frame")).toBe("large-frame");
    expect(foldText("Café “quote” it’s")).toBe('cafe "quote" it\'s');
  });

  it("asks first, then ranks notes whose title holds every word above the rest, and offers the full search", () => {
    const groups = paletteGroups("turbines", data());
    expect(groups.map((g) => g.heading)).toEqual([null, "Notes", "Topics", "Chats"]);
    const [ask, notes, topics, chats] = groups;
    expect(ask.rows[0]).toMatchObject({ kind: "ask", query: "turbines" });
    // "turbines" finds "turbine"; both title hits, newest first; the description-only note does not match.
    expect(notes.rows.map((r) => (r.kind === "note" ? r.id : r.kind))).toEqual(["n2", "n1", "more"]);
    expect(notes.rows[0]).toMatchObject({ detail: "State of AI Report 2026" });
    // A topic found by its description; the overview only when named.
    expect(topics.rows).toEqual([expect.objectContaining({ kind: "topic", id: "t1", detail: "15 notes" })]);
    expect(chats.rows).toEqual([expect.objectContaining({ kind: "chat", id: "c1" })]);
    // Words across title and description, in any order; an ASCII hyphen finds U+2011.
    expect(paletteRows(paletteGroups("centers robots", data())).some((r) => r.kind === "note" && r.id === "n3")).toBe(true);
    expect(paletteRows(paletteGroups("large-frame", data())).some((r) => r.kind === "note" && r.id === "n2")).toBe(true);
    expect(paletteRows(paletteGroups("overview", data()))).toContainEqual(
      expect.objectContaining({ kind: "topic", id: "h", title: "Liberuum overview" }),
    );
  });

  it("shows the newest, the largest and where to go while nothing is typed; typing narrows Go to", () => {
    const groups = paletteGroups("  ", data());
    expect(groups.map((g) => g.heading)).toEqual(["Notes", "Topics", "Sources", "Recent chats", "Go to"]);
    expect(groups[0].rows.map((r) => (r.kind === "note" ? r.id : ""))).toEqual(["n2", "n1", "n3"]);
    expect(groups[1].rows.map((r) => (r.kind === "topic" ? r.id : ""))).toEqual(["t1", "t2"]);
    expect(groups[2].rows[0]).toMatchObject({ kind: "source", title: "State of AI Report 2026", detail: "3 notes" });
    expect(groups[4].rows).toHaveLength(6);
    const goto = paletteGroups("queue", data()).find((g) => g.key === "goto");
    expect(goto?.rows).toEqual([expect.objectContaining({ goto: "processing-queue" })]);
  });

  it("lists the server's semantic answer first as Best matches, notes and maps in its order, like the search page", () => {
    const question = "who makes the turbines for AI power?";
    const semantic = paletteSemanticFrom(question, [
      { documentId: "t1", title: "AI data center power", status: "MOC", matchedBy: ["semantic"] },
      { documentId: "n3", title: "Robots build data centers", status: "DRAFT", matchedBy: ["semantic"] },
      { documentId: "s1", title: "A scope of work", status: "SCOPE", matchedBy: ["semantic"] },
      { documentId: "x1", title: null, status: "MOC", matchedBy: ["semantic"] },
      { documentId: "n1", title: "Gas turbine orders exceed annual build capacity", status: "CANONICAL", matchedBy: ["semantic", "keyword"] },
      { documentId: "n9", title: "A note the palette has not loaded", status: "DRAFT", matchedBy: ["semantic"] },
      { documentId: "n2", title: "Large-frame turbines are sold out", status: "DRAFT", matchedBy: ["semantic"] },
    ]);
    expect(semantic?.hits.map((h) => h.id)).toEqual(["t1", "n3", "x1", "n1", "n9", "n2"]);
    const groups = paletteGroups(question, data(), "all", semantic);
    expect(groups.map((g) => g.heading)).toEqual([null, "Best matches"]);
    const best = groups[1];
    // The server's order, maps included (a scope, and a map the palette does not list, are left out); four, then the full search.
    expect(best.rows.map((r) => `${r.kind}:${"id" in r ? r.id : ""}`)).toEqual(["topic:t1", "note:n3", "note:n1", "note:n9", "more:"]);
    expect(best.rows[0]).toMatchObject({ title: "AI data center power", detail: "15 notes" });
    expect(best.rows[1]).toMatchObject({ detail: "State of AI Report 2026" });
    expect(best.rows[3]).toMatchObject({ title: "A note the palette has not loaded", detail: null });
    // A map among the best matches is not listed again under Topics; the overview keeps its name.
    const power = paletteGroups("power", data(), "all", paletteSemanticFrom("power", [
      { documentId: "t1", title: "AI data center power", status: "MOC", matchedBy: ["semantic"] },
      { documentId: "h", title: "Liberuum", status: "MOC", matchedBy: ["semantic"] },
    ]));
    expect(power.find((g) => g.key === "notes")?.rows.map((r) => ("title" in r ? r.title : r.kind))).toEqual(["AI data center power", "Liberuum overview", "more"]);
    expect(power.find((g) => g.key === "topics")).toBeUndefined();
  });

  it("keeps its own word matches until the answer is for what is typed, and where the server ranks by words alone", () => {
    const answer = paletteSemanticFrom("turbin", [{ documentId: "n3", title: "Robots", status: "DRAFT", matchedBy: ["semantic"] }]);
    // Still typing: the answer to "turbin" does not replace the matches for "turbines".
    const typing = paletteGroups("turbines", data(), "all", answer);
    expect(typing.find((g) => g.key === "notes")).toMatchObject({ heading: "Notes" });
    expect(typing.find((g) => g.key === "notes")?.rows.map((r) => (r.kind === "note" ? r.id : r.kind))).toEqual(["n2", "n1", "more"]);
    // A keyword-only answer (no embeddings on that server) is not used at all.
    expect(paletteSemanticFrom("turbines", [{ documentId: "n3", title: "Robots", status: "DRAFT", matchedBy: ["keyword"] }])).toBeNull();
    expect(paletteSemanticFrom("turbines", [{ documentId: "n3", title: "Robots", status: "DRAFT" }])).toBeNull();
    expect(paletteSemanticFrom("turbines", null)).toBeNull();
    // An answer holding nothing the palette can show leaves the words in charge.
    const nothing = paletteSemanticFrom("turbines", [{ documentId: "x1", title: "Unknown map", status: "MOC", matchedBy: ["semantic"] }]);
    expect(paletteGroups("turbines", data(), "all", nothing).find((g) => g.key === "notes")?.heading).toBe("Notes");
  });

  it("moves through the rows with ↑ and ↓, wrapping at both ends", () => {
    expect(stepRow(3, 0, 1)).toBe(1);
    expect(stepRow(3, 2, 1)).toBe(0);
    expect(stepRow(3, 0, -1)).toBe(2);
    expect(stepRow(3, -1, -1)).toBe(2);
    expect(stepRow(0, 0, 1)).toBe(-1);
  });
});
