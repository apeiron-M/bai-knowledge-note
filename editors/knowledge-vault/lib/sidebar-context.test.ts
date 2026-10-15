import type { Node } from "@powerhousedao/shared/document-drive";
import { describe, expect, it, vi } from "vitest";
import { indexNotes, type KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { indexMocs, type MocInfo } from "../hooks/use-knowledge-mocs.js";
import { buildSidebarContext, sourceTitleMap, type SidebarContextInput } from "./sidebar-context.js";
import type { Contradiction } from "./contradictions.js";

function file(id: string, name: string, documentType: string, parentFolder: string | null = null): Node {
  return { kind: "file", id, name, documentType, parentFolder } as unknown as Node;
}

function folder(id: string, name: string, parentFolder: string | null = null): Node {
  return { kind: "folder", id, name, parentFolder } as unknown as Node;
}

function note(id: string, title: string, links: KnowledgeNoteInfo["links"] = []): KnowledgeNoteInfo {
  return {
    id, name: id, title, noteType: "CONCEPT", status: "CANONICAL", description: null,
    topics: [], links, provenance: null,
  } as unknown as KnowledgeNoteInfo;
}

function moc(id: string, title: string, tier: MocInfo["tier"], noteCount = 0): MocInfo {
  return { id, title, tier, noteCount, coreIdeas: [], childRefs: [] };
}

const nodes: Node[] = [
  folder("f1", "State of AI Report 2026"),
  file("s1", "Section one", "bai/source", "f1"),
  file("s2", "Section two", "bai/source", "f1"),
  file("s3", "Elsewhere", "bai/source", null),
  file("n1", "A note", "bai/knowledge-note", "f1"),
];

/** The input the shell builds: the notes and topics as the hooks index them. */
function input({
  notes = [],
  mocs = [],
  ...overrides
}: Partial<Omit<SidebarContextInput, "noteMap" | "mocMap">> & { notes?: KnowledgeNoteInfo[] }): SidebarContextInput {
  return {
    nodes,
    noteMap: indexNotes(notes),
    mocs,
    mocMap: indexMocs(mocs),
    selected: undefined,
    graphFocus: null,
    open: () => {},
    close: () => {},
    clearGraph: () => {},
    ...overrides,
  };
}

describe("buildSidebarContext", () => {
  it("builds nothing when no context is active", () => {
    expect(buildSidebarContext(input({}))).toBeUndefined();
    expect(buildSidebarContext(input({ selected: nodes[4] }))).toBeUndefined();
  });

  it("builds a sources context: the open source's folder, with the open one active", () => {
    const ctx = buildSidebarContext(input({ selected: nodes[1] }));
    expect(ctx?.place).toBe("sources");
    expect(ctx?.title).toBe("State of AI Report 2026");
    expect(ctx?.items.map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(ctx?.activeId).toBe("s1");
  });

  it("labels each source by its title, in file order; a source not read yet shows its file name", () => {
    const chapters: Node[] = [
      folder("book", "Design for How People Think"),
      file("c10", "10-ch08-user-research", "bai/source", "book"),
      file("c2", "02-part-i-rethinking", "bai/source", "book"),
      file("c7", "07-ch05-language-i-told-you-so", "bai/source", "book"),
    ];
    const titles = sourceTitleMap([
      { header: { id: "c7" }, state: { global: { title: "Design for How People Think - Ch. 05: Language: I Told You So" } } },
      { header: { id: "c2" }, state: { global: { title: "  Part I: Rethinking the Experience " } } },
      { header: { id: "c10" }, state: { global: { title: "" } } },
    ]);
    const ctx = buildSidebarContext(input({ nodes: chapters, selected: chapters[3], sourceTitles: titles }));
    expect(ctx?.title).toBe("Design for How People Think");
    expect(ctx?.items.map((i) => i.label)).toEqual([
      "Part I: Rethinking the Experience",
      "Design for How People Think - Ch. 05: Language: I Told You So",
      "10-ch08-user-research",
    ]);
    expect(ctx?.activeId).toBe("c7");
  });

  it("titles a root-level source list as Sources", () => {
    const ctx = buildSidebarContext(input({ selected: nodes[3] }));
    expect(ctx?.title).toBe("Sources");
    expect(ctx?.items.map((i) => i.id)).toEqual(["s3"]);
  });

  it("builds a topics context: the overview first, then every topic largest first, with a filter", () => {
    const mocs = [
      moc("m2", "Liberuum", "HUB", 0),
      moc("m1", "Topic leaf", "TOPIC", 3),
      moc("m3", "Domain", "DOMAIN", 9),
    ];
    const selected = file("m1", "Topic leaf", "bai/moc");
    const ctx = buildSidebarContext(input({ mocs, selected }));
    expect(ctx?.place).toBe("topics");
    expect(ctx?.title).toBe("Topics");
    expect(ctx?.subtitle).toBe("2 topics and the overview");
    expect(ctx?.filterPlaceholder).toBe("Filter topics");
    expect(ctx?.items).toEqual([
      { id: "m2", label: "Liberuum overview", detail: "every topic", marker: "hub" },
      { id: "m3", label: "Domain", detail: "9 notes", marker: "map" },
      { id: "m1", label: "Topic leaf", detail: "3 notes", marker: "map" },
    ]);
    expect(ctx?.activeId).toBe("m1");
  });

  it("lists the open contradictions inside one, and keeps a place's list for a note opened from it", () => {
    const claim = (id: string): Contradiction["claims"][number] => ({
      id, exists: true, title: `Claim ${id}`, description: null, kind: null, source: null, topic: null,
    });
    const contradictions: Contradiction[] = [
      { id: "t1", title: "T1", status: "OPEN", observedAt: null, observedBy: null, claims: [claim("a"), claim("b")], why: null },
      { id: "t2", title: "T2", status: "RESOLVED", observedAt: null, observedBy: null, claims: [], why: null },
    ];
    const showPlace = vi.fn();
    const inTension = buildSidebarContext(
      input({ contradictions, showPlace, selected: file("t1", "T1", "bai/tension") }),
    );
    expect(inTension?.place).toBe("contradictions");
    expect(inTension?.subtitle).toBe("1 open");
    expect(inTension?.items).toEqual([{ id: "t1", label: "Claim a / Claim b", detail: "Open", marker: "warn" }]);
    inTension?.onBack();
    expect(showPlace).toHaveBeenCalledWith("contradictions");

    // A closed one is listed while it is the one you are in.
    const inClosed = buildSidebarContext(input({ contradictions, selected: file("t2", "T2", "bai/tension") }));
    expect(inClosed?.items.map((i) => i.id)).toEqual(["t1", "t2"]);

    // A claim opened from the contradiction: its list stays, the contradiction current.
    const inNote = buildSidebarContext(
      input({ contradictions, selected: nodes[4], origin: { place: "contradictions", id: "t1" } }),
    );
    expect(inNote?.place).toBe("contradictions");
    expect(inNote?.activeId).toBe("t1");
    // Without an origin a note makes no context.
    expect(buildSidebarContext(input({ contradictions, selected: nodes[4] }))).toBeUndefined();
  });

  it("builds a graph context: the selected node first, then its neighbours with the link", () => {
    const notes = [
      note("a", "Alpha", [
        { id: "l1", targetDocumentId: "b", targetTitle: "Beta", linkType: "BUILDS_ON", reason: "extends it", confidence: null },
      ]),
      note("b", "Beta"),
    ];
    const clear = vi.fn();
    const ctx = buildSidebarContext(
      input({ notes, graphFocus: { selectedId: "a", focusedIds: ["b"] }, clearGraph: clear }),
    );
    expect(ctx?.place).toBe("graph");
    expect(ctx?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(ctx?.title).toBe("Alpha");
    expect(ctx?.activeId).toBe("a");
    expect(ctx?.items[1].detail).toContain("→ builds on");
    expect(ctx?.items[1].detail).toContain("extends it");
    ctx?.onBack();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("gives the graph precedence over an open source", () => {
    const ctx = buildSidebarContext(
      input({ selected: nodes[1], graphFocus: { selectedId: "n1", focusedIds: [] } }),
    );
    expect(ctx?.place).toBe("graph");
  });

  it("forwards open and close to the list's handlers", () => {
    const open = vi.fn();
    const close = vi.fn();
    const ctx = buildSidebarContext(input({ selected: nodes[1], open, close }));
    ctx?.onOpen("s2");
    ctx?.onBack();
    expect(open).toHaveBeenCalledWith("s2");
    expect(close).toHaveBeenCalledOnce();
  });
});
