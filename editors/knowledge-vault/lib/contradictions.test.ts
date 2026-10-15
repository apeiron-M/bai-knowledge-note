import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import type { TensionInfo } from "../hooks/use-knowledge-tensions.js";
import { buildContradictions, countContradictions, foundLine, foundWhen } from "./contradictions.js";
import { noteTopicIndex, originalName, rankedTopics, sourceDocuments, topicSize, type TreeNodeLike } from "./vault-lookups.js";
import {
  clearTensionClose,
  pendingTensionClose,
  requestTensionClose,
} from "../../shared/tension-intent.js";

type Link = KnowledgeNoteInfo["links"][number];
const link = (linkType: string, targetDocumentId: string, reason: string | null = null): Link =>
  ({ id: `${linkType}-${targetDocumentId}`, targetDocumentId, targetTitle: null, linkType, reason, confidence: null });
const note = (id: string, title: string, noteType: string, links: Link[]): KnowledgeNoteInfo =>
  ({ id, name: id, title, description: `About ${title}`, noteType, status: "DRAFT", topics: [], links, provenance: null });
const moc = (id: string, title: string, tier: MocInfo["tier"], ideas: string[], childRefs: string[] = []): MocInfo =>
  ({ id, title, tier, noteCount: ideas.length, coreIdeas: ideas.map((noteRef) => ({ noteRef, contextPhrase: "" })), childRefs });

const tree: TreeNodeLike[] = [
  { id: "root", name: "sources", kind: "folder", parentFolder: null },
  { id: "book", name: "2026 Global Tech Report", kind: "folder", parentFolder: "root" },
  { id: "part", name: "Part one", kind: "folder", parentFolder: "book" },
  { id: "s1", name: "Tech investment", kind: "file", documentType: "bai/source", parentFolder: "part" },
  { id: "s2", name: "Pasted text", kind: "file", documentType: "bai/source", parentFolder: "root" },
];

describe("contradictions", () => {
  it("finds each note's original, under /sources, and its narrowest topic", () => {
    const { bySource, documents } = sourceDocuments(tree);
    expect(bySource.get("s1")?.name).toBe("2026 Global Tech Report");
    expect(bySource.get("s2")).toMatchObject({ name: "Pasted text", kind: "source" });
    expect(documents).toHaveLength(2);
    const mocs = [moc("hub", "Vault", "HUB", ["a"]), moc("dom", "Strategy", "DOMAIN", ["a"]), moc("top", "Investment", "TOPIC", ["a"])];
    expect(noteTopicIndex(mocs).get("a")?.id).toBe("top");
    // The overview is left out; equal counts go by title.
    expect(rankedTopics(mocs).map((m) => m.id)).toEqual(["top", "dom"]);
    expect(topicSize(moc("d", "D", "DOMAIN", [], ["x", "y"]))).toBe("2 maps");
    // A file-style name reads as words; one that already does is left alone.
    expect(originalName("2026-global-tech-report-technology.pdf.coredownload.inline")).toBe("2026 global tech report technology");
    expect(originalName("SkyEcosystem_SFF-Q1-Report")).toBe("SkyEcosystem SFF Q1 Report");
    expect(originalName("bai-knowledge-note — how the vault works")).toBe("bai-knowledge-note — how the vault works");
  });

  it("sets the two notes side by side as claims, with the reason on the link between them", () => {
    const a = note("a", "Data-driven investment maximizes value", "decision", [link("DERIVED_FROM", "s1")]);
    // The CONTRADICTS link may run either way; the reason is read from whichever has it.
    const b = note("b", "Legacy systems diminish investment", "bug-pattern", [
      link("CONTRADICTS", "a", "Maximizing value conflicts with legacy drag"),
    ]);
    const tensions: TensionInfo[] = [
      { id: "t1", title: "Contradiction on investment", description: null, status: "OPEN", involvedRefs: ["a", "b"], observedBy: "graph-indexer", observedAt: "2026-10-10T22:02:57Z" },
      { id: "t2", title: "Old one", description: null, status: "DISSOLVED", involvedRefs: ["a", "gone"], observedBy: "liberuum", observedAt: null },
    ];
    const [open, closed] = buildContradictions(tensions, {
      noteMap: new Map([["a", a], ["b", b]]),
      topicOf: noteTopicIndex([moc("top", "Technology Investment Strategy", "TOPIC", ["a"])]),
      sourceOf: sourceDocuments(tree).bySource,
    });
    expect(open.claims[0]).toMatchObject({ title: "Data-driven investment maximizes value", kind: "Decision", source: "2026 Global Tech Report", topic: "Technology Investment Strategy" });
    expect(open.claims[1]).toMatchObject({ kind: "Bug pattern", source: null, topic: null });
    expect(open.why).toBe("Maximizing value conflicts with legacy drag");
    expect(closed.claims[1]).toMatchObject({ id: "gone", exists: false });
    expect(closed.why).toBeNull();
    expect(countContradictions([open, closed])).toEqual({ OPEN: 1, RESOLVED: 0, DISSOLVED: 1 });
  });

  it("says when it was found in words that read after a comma", () => {
    const now = new Date(2026, 9, 11, 9, 0);
    expect(foundWhen(new Date(2026, 9, 11, 8, 5).toISOString(), now, "en-US")).toBe("today at 8:05 AM");
    expect(foundWhen(new Date(2026, 9, 10, 22, 2).toISOString(), now, "en-US")).toBe("yesterday at 10:02 PM");
    expect(foundWhen(new Date(2026, 9, 8, 12, 0).toISOString(), now, "en-US")).toBe("on Thursday");
    expect(foundWhen(new Date(2026, 8, 1).toISOString(), now, "en-GB")).toBe("on 1 Sept");
    expect(foundWhen(new Date(2025, 8, 1).toISOString(), now, "en-GB")).toBe("on 1 Sept 2025");
    expect(foundWhen("not a date", now)).toBe("");
    expect(foundLine({ observedBy: "graph-indexer", observedAt: null })).toBe("Found when the link between these notes was recorded");
    expect(foundLine({ observedBy: "liberuum", observedAt: new Date(2026, 9, 11, 8, 5).toISOString() }, now, "en-US")).toBe("Recorded by liberuum, today at 8:05 AM");
  });
});

describe("opening a contradiction on its closing form", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("applies to that document only, for a few seconds, until the form is done", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    requestTensionClose("t1", "resolve", 1_000);
    expect(pendingTensionClose("t1", 1_500)).toBe("resolve");
    // Read twice (React's development mode runs effects twice): still there.
    expect(pendingTensionClose("t1", 1_600)).toBe("resolve");
    expect(pendingTensionClose("t2", 1_500)).toBeNull();
    expect(pendingTensionClose("t1", 20_000)).toBeNull();
    clearTensionClose();
    expect(pendingTensionClose("t1", 1_500)).toBeNull();
  });
});
