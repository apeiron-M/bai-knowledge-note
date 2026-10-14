import type { Node } from "@powerhousedao/shared/document-drive";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { buildSidebarContext, type SidebarContextInput } from "./sidebar-context.js";

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

function input(overrides: Partial<SidebarContextInput>): SidebarContextInput {
  return {
    nodes,
    notes: [],
    mocs: [],
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

  it("titles a root-level source list as Sources", () => {
    const ctx = buildSidebarContext(input({ selected: nodes[3] }));
    expect(ctx?.title).toBe("Sources");
    expect(ctx?.items.map((i) => i.id)).toEqual(["s3"]);
  });

  it("builds a topics context: every map, overview tier first, with note counts", () => {
    const mocs = [
      moc("m1", "Topic leaf", "TOPIC", 3),
      moc("m2", "Hub", "HUB", 40),
      moc("m3", "Domain", "DOMAIN", 9),
    ];
    const selected = file("m1", "Topic leaf", "bai/moc");
    const ctx = buildSidebarContext(input({ mocs, selected }));
    expect(ctx?.place).toBe("topics");
    expect(ctx?.items.map((i) => i.id)).toEqual(["m2", "m3", "m1"]);
    expect(ctx?.items[0]).toEqual({ id: "m2", label: "Hub", detail: "40 notes" });
    expect(ctx?.activeId).toBe("m1");
    expect(ctx?.subtitle).toBe("3 topics");
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
