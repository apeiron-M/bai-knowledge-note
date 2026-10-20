import { describe, expect, it } from "vitest";
import { neighbourhood } from "./neighbourhood.js";
import type {
  GraphEdgeMetadata,
  GraphNodeMetadata,
} from "../../knowledge-vault/hooks/use-graph-metadata.js";

const node = (
  documentId: string,
  title: string,
  documentType: string,
  noteType: string | null = null,
  status: string | null = "CANONICAL",
): GraphNodeMetadata => ({
  documentId,
  title,
  description: null,
  noteType,
  status,
  topics: [],
  author: null,
  sourceOrigin: null,
  createdAt: null,
  updatedAt: null,
  documentType,
});

const edge = (
  sourceDocumentId: string,
  targetDocumentId: string,
  linkType: string,
  reason: string | null = null,
  targetTitle: string | null = null,
): GraphEdgeMetadata => ({
  id: `${sourceDocumentId}-${targetDocumentId}-${linkType}`,
  sourceDocumentId,
  targetDocumentId,
  linkType,
  targetTitle,
  reason,
  confidence: reason ? "grounded" : null,
});

// The real neighbourhood of note c661bdd5 in the live vault, 2026-09-18.
const NOTE = "c661bdd5";
const nodes = new Map<string, GraphNodeMetadata>([
  [NOTE, node(NOTE, "Because the processor manager has no drive dimension…", "bai/knowledge-note", "BUG_PATTERN")],
  ["4eec5924", node("4eec5924", "The graph indexer is a materialized read model", "bai/knowledge-note", "ARCHITECTURE")],
  ["eb931bfd", node("eb931bfd", "The graph indexer writes documents itself", "bai/knowledge-note", "ARCHITECTURE")],
  ["5cb7f10c", node("5cb7f10c", "The Knowledge Vault: model, pipeline and use", "bai/moc", "MOC (DOMAIN)", "MOC")],
  ["8950c759", node("8950c759", "Storage, Indexing & Search", "bai/moc", "MOC (TOPIC)", "MOC")],
]);
const edges: GraphEdgeMetadata[] = [
  edge(NOTE, "37ffd01c", "DERIVED_FROM", "Ch. 4 § The graph indexer — membership", "bai-knowledge-note — the book"),
  edge(NOTE, "4eec5924", "BUILDS_ON", "per-drive namespaces only isolate vaults if each instance indexes its own"),
  edge("eb931bfd", NOTE, "BUILDS_ON", "the automation's same-drive check reuses the indexer's membership set"),
  edge("5cb7f10c", NOTE, "CORE_IDEA"),
  edge("8950c759", NOTE, "CORE_IDEA"),
  edge("other", "unrelated", "BUILDS_ON"),
];

describe("neighbourhood", () => {
  it("splits the drive's edges into the four questions a reader asks", () => {
    const n = neighbourhood(NOTE, edges, nodes);
    expect(n.outgoing.map((x) => x.linkType)).toEqual(["DERIVED_FROM", "BUILDS_ON"]);
    expect(n.incoming.map((x) => x.linkType)).toEqual(["BUILDS_ON"]);
    expect(n.mocs).toHaveLength(2);
    expect(n.tensions).toEqual([]);
  });

  it("names the incoming note, which the edge itself never carries", () => {
    // targetTitle is the *target's* title, so an incoming edge has no title on
    // it at all — it has to be resolved through the node map.
    const [from] = neighbourhood(NOTE, edges, nodes).incoming;
    expect(from.title).toBe("The graph indexer writes documents itself");
    expect(from.reason).toContain("same-drive check");
  });

  it("puts the broader map of content first", () => {
    const n = neighbourhood(NOTE, edges, nodes);
    expect(n.mocs.map((m) => m.tier)).toEqual(["DOMAIN", "TOPIC"]);
    expect(n.mocs[0].title).toBe("The Knowledge Vault: model, pipeline and use");
  });

  it("falls back to the edge's title for a target that is not indexed", () => {
    // 260 DERIVED_FROM edges point at bai/source documents, which the graph
    // does not index — the edge's own title is all there is.
    const [derived] = neighbourhood(NOTE, edges, nodes).outgoing;
    expect(derived.title).toBe("bai-knowledge-note — the book");
    expect(derived.documentType).toBeNull();
  });

  it("keeps another note's edges out of this note's neighbourhood", () => {
    const n = neighbourhood(NOTE, edges, nodes);
    expect([...n.outgoing, ...n.incoming, ...n.mocs].map((x) => x.documentId)).not.toContain("unrelated");
  });

  it("buckets a tension by its type and by its document type", () => {
    const withTension = new Map(nodes);
    withTension.set("t1", node("t1", "Contradiction on membership", "bai/tension", null, "OPEN"));
    const n = neighbourhood(NOTE, [...edges, edge("t1", NOTE, "INVOLVES")], withTension);
    expect(n.tensions.map((t) => t.title)).toEqual(["Contradiction on membership"]);
    expect(n.incoming).toHaveLength(1);
  });

  it("returns empty buckets for a note with no edges yet", () => {
    expect(neighbourhood("brand-new", edges, nodes)).toEqual({
      outgoing: [], incoming: [], mocs: [], tensions: [],
    });
  });
});
