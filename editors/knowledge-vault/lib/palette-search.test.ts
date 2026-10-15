import { describe, expect, it } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { foldText, paletteGroups, paletteRows, stepRow, type PaletteData } from "./palette-search.js";
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

  it("moves through the rows with ↑ and ↓, wrapping at both ends", () => {
    expect(stepRow(3, 0, 1)).toBe(1);
    expect(stepRow(3, 2, 1)).toBe(0);
    expect(stepRow(3, 0, -1)).toBe(2);
    expect(stepRow(3, -1, -1)).toBe(2);
    expect(stepRow(0, 0, 1)).toBe(-1);
  });
});
