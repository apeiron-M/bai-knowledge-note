import { describe, expect, it } from "vitest";
import { healthInputFromGraph, writeHealthReport, type GraphEdge, type GraphNode } from "./health.js";

const note = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  documentId: id,
  title: `Note ${id}`,
  description: "d",
  noteType: "concept",
  status: "IN_REVIEW",
  documentType: "bai/knowledge-note",
  topics: ["t"],
  ...over,
});
const edge = (from: string, to: string, linkType: string): GraphEdge => ({ sourceDocumentId: from, targetDocumentId: to, linkType });

const nodes: GraphNode[] = [
  note("n1"),
  note("n2"),
  note("n3", { status: "ARCHIVED" }),
  { documentId: "m1", title: "Map", description: "", noteType: "MOC (TOPIC)", status: "MOC", documentType: "bai/moc", topics: [] },
  { documentId: "o1", title: "An observation", description: "", noteType: null, status: "PENDING", documentType: "bai/observation", topics: [] },
  { documentId: "o2", title: "Done", description: "", noteType: null, status: "IMPLEMENTED", documentType: "bai/observation", topics: [] },
  { documentId: "t1", title: "A tension", description: "", noteType: null, status: "OPEN", documentType: "bai/tension", topics: [] },
];
const edges: GraphEdge[] = [
  edge("n1", "n2", "RELATES_TO"),
  edge("n1", "s1", "DERIVED_FROM"),
  edge("n2", "n1", "BUILDS_ON"),
  edge("m1", "n1", "CORE_IDEA"),
  edge("t1", "n1", "INVOLVES"),
];

describe("healthInputFromGraph", () => {
  const input = healthInputFromGraph({ nodes, edges, driveFileIds: ["n1", "n2", "n3", "m1", "s1", "hr"] });

  it("reads the vault's live notes and the links between them", () => {
    expect(input.notes.map((n) => [n.id, n.links])).toEqual([["n1", ["n2"]], ["n2", ["n1"]]]);
  });
  it("reads maps' core ideas, waiting observations and open tensions", () => {
    expect(input.mocs).toEqual([{ id: "m1", coreIdeas: ["n1"] }]);
    expect(input.pendingObservations).toEqual([{ id: "o1", title: "An observation" }]);
    expect(input.openTensions).toEqual([{ id: "t1", title: "A tension" }]);
  });
  it("knows every document in the drive, so a link to a source is not dangling", () => {
    expect(input.otherDocumentIds).toEqual(expect.arrayContaining(["s1", "hr"]));
  });
});

describe("writeHealthReport", () => {
  it("writes one report, then one check per check, to the drive's health report", async () => {
    const executed: { id: string; actions: { type: string; input: Record<string, unknown> }[] }[] = [];
    const client = {
      get: () => Promise.resolve({
        header: { id: "drive" },
        state: { global: { nodes: [
          { id: "n1", kind: "file", documentType: "bai/knowledge-note" },
          { id: "n2", kind: "file", documentType: "bai/knowledge-note" },
          { id: "s1", kind: "file", documentType: "bai/source" },
          { id: "hr", kind: "file", documentType: "bai/health-report" },
          { id: "f", kind: "folder" },
        ] } },
      }),
      execute: (id: string, _branch: string, actions: { type: string; input: Record<string, unknown> }[]) => {
        executed.push({ id, actions });
        return Promise.resolve({});
      },
    };
    const knowledgeGraph = { execute: () => Promise.resolve({ data: { knowledgeGraphNodes: nodes.slice(0, 2), knowledgeGraphEdges: edges.slice(0, 3) } }) };
    const result = await writeHealthReport({ client: client as never, knowledgeGraph, driveId: "drive", now: () => new Date("2030-01-02T03:04:05.000Z") });
    if (!result) throw new Error("no report was written");

    expect(executed).toHaveLength(1);
    expect(executed[0].id).toBe("hr");
    const [report, ...checks] = executed[0].actions;
    expect(report.type).toBe("GENERATE_REPORT");
    expect(report.input).toMatchObject({ generatedAt: "2030-01-02T03:04:05.000Z", generatedBy: "knowledge-vault-web", mode: "browser", overallStatus: result.overallStatus });
    expect(report.input.graphMetrics).toEqual(result.metrics);
    expect(checks.map((c) => c.type)).toEqual(result.checks.map(() => "ADD_CHECK"));
    expect(new Set(checks.map((c) => c.input.id)).size).toBe(checks.length);
    expect(checks.map((c) => c.input.category)).toEqual(result.checks.map((c) => c.category));
  });

  it("writes nothing when the drive has no health report", async () => {
    const executed: unknown[] = [];
    const client = { get: () => Promise.resolve({ state: { global: { nodes: [] } } }), execute: (...a: unknown[]) => Promise.resolve(executed.push(a)) };
    const knowledgeGraph = { execute: () => Promise.resolve({ data: { knowledgeGraphNodes: [], knowledgeGraphEdges: [] } }) };
    expect(await writeHealthReport({ client: client as never, knowledgeGraph, driveId: "drive" })).toBeNull();
    expect(executed).toEqual([]);
  });
});
