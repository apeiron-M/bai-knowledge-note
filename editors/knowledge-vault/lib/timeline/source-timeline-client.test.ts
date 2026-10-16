import { describe, expect, it, vi } from "vitest";
import { browserTimelineReady, shownBrowserTimeline, fetchSourceTimeline, readTimelineAnswer, timelineInputFromBrowser, withSourceNames } from "./source-timeline-client.js";

const timeline = { additions: [], notes: [], topics: [], totals: { sources: 0, notes: 0, topics: 0, links: 0 } };
const OLD_SERVER = { errors: [{ message: 'Cannot query field "knowledgeGraphSourceTimeline" on type "Query". Did you mean "knowledgeGraphStats"?' }] };

describe("readTimelineAnswer", () => {
  it("returns the timeline the server sent", () => {
    expect(readTimelineAnswer({ data: { knowledgeGraphSourceTimeline: timeline } })).toEqual({ kind: "timeline", timeline });
  });

  it("recognises a server that predates the query", () => {
    expect(readTimelineAnswer(OLD_SERVER)).toEqual({ kind: "unsupported" });
  });

  it("throws any other error, with the server's words", () => {
    expect(() => readTimelineAnswer({ errors: [{ message: "Forbidden: no read access" }, { message: "and another" }] })).toThrow("Forbidden: no read access; and another");
    expect(() => readTimelineAnswer({ data: null })).toThrow(/no timeline/i);
  });
});

describe("fetchSourceTimeline", () => {
  const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;

  it("posts the query for the drive and reads the answer", async () => {
    const post = vi.fn(() => Promise.resolve(response(200, { data: { knowledgeGraphSourceTimeline: timeline } })));
    await expect(fetchSourceTimeline("drive-1", post)).resolves.toEqual({ kind: "timeline", timeline });
    const [body] = post.mock.calls[0] as unknown as [{ query: string; variables: unknown }];
    expect(body.variables).toEqual({ driveId: "drive-1" });
    expect(body.query).toContain("knowledgeGraphSourceTimeline(driveId: $driveId)");
  });

  it("reads a validation failure's body, which an older server sends with status 400", async () => {
    await expect(fetchSourceTimeline("d", () => Promise.resolve(response(400, OLD_SERVER)))).resolves.toEqual({ kind: "unsupported" });
  });

  it("throws on a failure that is not about the query", async () => {
    await expect(fetchSourceTimeline("d", () => Promise.resolve(response(502, {})))).rejects.toThrow("HTTP 502");
  });
});

describe("timelineInputFromBrowser", () => {
  it("builds the builder's input from the tree, the source documents and the graph the editor already holds", () => {
    const input = timelineInputFromBrowser({
      treeNodes: [
        { id: "root", name: "sources", kind: "folder", parentFolder: null },
        { id: "f", name: "Book", kind: "folder", parentFolder: "root" },
        { id: "s1", name: "ch1", kind: "file", documentType: "bai/source", parentFolder: "f" },
        { id: "n1", name: "note", kind: "file", documentType: "bai/knowledge-note", parentFolder: null },
      ],
      sourceDocs: [
        { header: { id: "s1", name: "ch1", createdAtUtcIso: "2026-10-15T19:04:00.000Z" }, state: { global: { title: "Chapter 1", status: "EXTRACTED", extractedClaims: [] } } },
        { header: { id: "stranger", name: "x", createdAtUtcIso: "2026-10-15T19:04:00.000Z" }, state: { global: { title: "Not in this drive" } } },
      ],
      graphNodes: [{ documentId: "n1", title: "A note", description: null, noteType: "concept", status: "IN_REVIEW", topics: ["ML"], author: null, sourceOrigin: "DERIVED", createdAt: "2026-10-15T19:06:00.000Z", updatedAt: null }],
      graphEdges: [{ id: "e", sourceDocumentId: "n1", targetDocumentId: "s1", linkType: "DERIVED_FROM", targetTitle: null, reason: null, confidence: null }],
    });
    expect(input.sourcesFolderId).toBe("root");
    expect(input.folders.map((f) => f.id)).toEqual(["root", "f"]);
    expect(input.sources.map((s) => [s.id, s.parentFolder, s.title])).toEqual([["s1", "f", "Chapter 1"]]);
    expect(input.nodes).toEqual([
      { documentId: "n1", documentType: "bai/knowledge-note", title: "A note", status: "IN_REVIEW", noteType: "concept", topics: ["ML"], addedAt: null, createdAt: "2026-10-15T19:06:00.000Z", sourceOrigin: "DERIVED" },
    ]);
    expect(input.edges).toEqual([{ source: "n1", target: "s1", type: "DERIVED_FROM" }]);
  });
});

describe("browserTimelineReady", () => {
  it("waits for the graph and for every source document, so a half-loaded vault never reads as notes without sources", () => {
    expect(browserTimelineReady({ graphLoading: true, graphHasNodes: false, docsLoading: false })).toBe(false);
    expect(browserTimelineReady({ graphLoading: false, graphHasNodes: true, docsLoading: true })).toBe(false);
    expect(browserTimelineReady({ graphLoading: false, graphHasNodes: true, docsLoading: false })).toBe(true);
  });

  it("does not wait for a graph refresh when a graph is already on screen", () => {
    expect(browserTimelineReady({ graphLoading: true, graphHasNodes: true, docsLoading: false })).toBe(true);
  });
});

describe("shownBrowserTimeline", () => {
  const a = { additions: [] as unknown[] };
  const b = { additions: [] as unknown[] };
  it("shows a complete build as soon as there is one", () => {
    expect(shownBrowserTimeline(a, { driveId: "d1", timeline: b }, "d1")).toBe(a);
  });
  it("keeps the last complete timeline while a new source is being read, instead of going back to loading", () => {
    expect(shownBrowserTimeline(null, { driveId: "d1", timeline: b }, "d1")).toBe(b);
  });
  it("never shows another vault's timeline", () => {
    expect(shownBrowserTimeline(null, { driveId: "d2", timeline: b }, "d1")).toBeNull();
    expect(shownBrowserTimeline(null, null, "d1")).toBeNull();
  });
});

describe("fetchSourceTimeline against a server a release behind", () => {
  it("asks again without the newer fields, and fills them in empty", async () => {
    const older = { additions: [{ id: "a", sources: 3 }], notes: [], topics: [], totals: { sources: 3, notes: 0, topics: 0, links: 0 } };
    const post = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "firstSources" on type "KnowledgeGraphTimelineAddition". Did you mean "sources"?' }] }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { knowledgeGraphSourceTimeline: older } }), { status: 200 }));
    const answer = await fetchSourceTimeline("d1", post);
    expect(post).toHaveBeenCalledTimes(2);
    const second = post.mock.calls[1][0] as { query: string };
    expect(second.query).not.toContain("firstSources");
    expect(answer).toEqual({ kind: "timeline", timeline: { ...older, additions: [{ id: "a", sources: 3, firstSources: [] }] } });
  });
});

describe("withSourceNames", () => {
  const base = { id: "a", sources: 7, sourceIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"], firstSources: [] as { documentId: string; title: string }[] };
  const tree = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `s${i}`, name: `Chapter ${i}`, kind: "file", documentType: "bai/source", parentFolder: "f" }));

  it("names an addition's first sources from the drive tree when the server did not", () => {
    const t = { additions: [base], notes: [], topics: [], totals: { sources: 7, notes: 0, topics: 0, links: 0 } };
    const named = withSourceNames(t as never, tree as never);
    expect(named?.additions[0].firstSources).toEqual([1, 2, 3, 4, 5].map((i) => ({ documentId: `s${i}`, title: `Chapter ${i}` })));
  });

  it("keeps what the server sent, and the same timeline when nothing is missing", () => {
    const sent = { ...base, firstSources: [{ documentId: "s1", title: "From the server" }] };
    const t = { additions: [sent], notes: [], topics: [], totals: { sources: 7, notes: 0, topics: 0, links: 0 } };
    expect(withSourceNames(t as never, tree as never)).toBe(t);
    expect(withSourceNames(null, tree as never)).toBeNull();
  });
});
