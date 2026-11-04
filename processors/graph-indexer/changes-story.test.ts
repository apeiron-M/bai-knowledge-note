import { describe, expect, it } from "vitest";
import { buildChanges, type ChangeContext, type ChangeScope, type OperationRow } from "./changes.js";
import { areasOf, MAX_CHANGED_CLAIMS, MAX_NEW_CLAIMS, MAX_RETIRED_CLAIMS, MAX_THEN_VS_NOW, type StoryContext, type StoryNode } from "./changes-story.js";

let seq = 0;
function row(documentId: string, operationType: string, input: Record<string, unknown>, timestamp: string): OperationRow {
  return { documentId, documentType: "bai/knowledge-note", operationType, timestamp, index: seq++, inputJson: JSON.stringify(input), signerAddress: "0xabc" };
}

const W = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };
const BEFORE = "2026-10-01T00:00:00.000Z";
const IN = (h: number, m = 0) => `2026-11-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

function note(title: string, extra: Partial<StoryNode> = {}): StoryNode {
  return { title, description: null, documentType: "bai/knowledge-note", status: "CANONICAL", addedAt: BEFORE, incoming: 0, ...extra };
}
function map(title: string, extra: Partial<StoryNode> = {}): StoryNode {
  return note(title, { documentType: "bai/moc", ...extra });
}

/**
 * hub ─CHILD_MOC→ a1 "Reactor" ─CHILD_MOC→ m1 ─CHILD_MOC→ m2
 *     ─CHILD_MOC→ a2 "Processors"
 * m1 holds n1, m2 holds n2 (two levels down), a2 holds n3.
 */
function story(nodes: [string, StoryNode][], extra: Partial<StoryContext> = {}): StoryContext {
  return {
    nodes: new Map<string, StoryNode>([
      ["hub", map("Hub")],
      ["a1", map("Reactor")],
      ["a2", map("Processors")],
      ["m1", map("Reactor internals")],
      ["m2", map("Reactor storage")],
      ...nodes,
    ]),
    hubs: ["hub"],
    childMaps: new Map([
      ["hub", ["a1", "a2"]],
      ["a1", ["m1"]],
      ["m1", ["m2"]],
    ]),
    coreIdeas: new Map([
      ["m1", ["n1"]],
      ["m2", ["n2"]],
      ["a2", ["n3"]],
    ]),
    archivedAtSince: new Set(),
    superseded: new Set(),
    ...extra,
  };
}

function ctx(s: StoryContext, partial: Partial<ChangeContext> = {}): ChangeContext {
  const nodes: ChangeContext["nodes"] = new Map();
  for (const [id, n] of s.nodes) nodes.set(id, { title: n.title, documentType: n.documentType, status: n.status, topics: [] });
  return { nodes, sources: new Map(), mocsByNote: new Map(), derivedFrom: new Map(), edgeReason: () => null, story: s, ...partial };
}

function digest(rows: OperationRow[], baseline: OperationRow[], s: StoryContext, scope: ChangeScope = {}, partial: Partial<ChangeContext> = {}) {
  return buildChanges(rows, baseline, ctx(s, partial), W, { scope });
}

describe("story: areas", () => {
  it("assigns a note to the hub's top-level area through descendant maps", () => {
    const s = story([
      ["n1", note("One")],
      ["n2", note("Two")],
      ["n3", note("Three")],
      ["n5", note("Loose")],
    ]);
    const { areas, areasByDoc } = areasOf(s);
    expect(areas.map((a) => a.id)).toEqual(["a2", "a1"]); // by title
    expect(areasByDoc.get("n1")).toEqual(["a1"]);
    expect(areasByDoc.get("n2")).toEqual(["a1"]);
    expect(areasByDoc.get("m2")).toEqual(["a1"]);
    expect(areasByDoc.get("n3")).toEqual(["a2"]);
    expect(areasByDoc.has("n5")).toBe(false);
  });

  it("puts a created note two maps down under its area, and a note in no area under Elsewhere", () => {
    const rows = [row("n2", "CREATE_DOCUMENT", {}, IN(1)), row("n5", "CREATE_DOCUMENT", {}, IN(2))];
    const s = story([
      ["n2", note("Storage is append-only", { addedAt: IN(1) })],
      ["n5", note("A loose claim", { addedAt: IN(2) })],
    ]);
    expect(digest(rows, [], s).story?.areas.map((a) => [a.id, a.title, a.newClaims.map((c) => c.documentId)])).toEqual([
      ["a1", "Reactor", ["n2"]],
      [null, "Elsewhere", ["n5"]],
    ]);
  });
});

describe("story: shifts", () => {
  it("turns a title/description revision into a then → now shift, with the revision-history line as why", () => {
    const baseline = [
      row("n1", "SET_TITLE", { title: "Delivery is exactly once, in order" }, BEFORE),
      row("n1", "SET_DESCRIPTION", { description: "Processors see each operation once" }, BEFORE),
      row("n1", "SET_CONTENT", { content: "body\n\n## Revision history\n- v1 (2026-09-01): first" }, BEFORE),
    ];
    const rows = [
      row("n1", "SET_TITLE", { title: "Delivery is at-least-once, with a crash gap" }, IN(1)),
      row("n1", "SET_DESCRIPTION", { description: "Processors may see an operation twice" }, IN(1)),
      row("n1", "SET_CONTENT", { content: "body2\n\n## Revision history\n- v1 (2026-09-01): first\n- v2 (2026-11-03): the outbox replays after a crash" }, IN(2)),
    ];
    const s = story([["n1", note("Delivery is at-least-once, with a crash gap", { description: "Processors may see an operation twice" })]]);
    const area = digest(rows, baseline, s).story?.areas[0];
    expect(area?.id).toBe("a1");
    expect(area?.changedClaims).toEqual([
      {
        documentId: "n1",
        then: { claim: "Delivery is exactly once, in order", gist: "Processors see each operation once" },
        now: { claim: "Delivery is at-least-once, with a crash gap", gist: "Processors may see an operation twice" },
        why: "v2 (2026-11-03): the outbox replays after a crash",
      },
    ]);
  });

  it("makes a supersession a shift from the old note to the replacement, with the SUPERSEDES reason", () => {
    const rows = [
      row("n9", "CREATE_DOCUMENT", {}, IN(1)),
      row("n9", "ADD_RELATIONSHIP", { sourceId: "n9", targetId: "n2", relationshipType: "SUPERSEDES", metadata: { reason: "row reason" } }, IN(2)),
      row("n2", "ARCHIVE_NOTE", {}, IN(3)),
    ];
    const s = story([
      ["n2", note("Storage keeps every snapshot", { description: "old gist", status: "ARCHIVED" })],
      ["n9", note("Storage keeps snapshots per checkpoint", { description: "new gist", addedAt: IN(1) })],
    ]);
    const d = digest(rows, [], s, {}, { edgeReason: (a, b, t) => (a === "n9" && b === "n2" && t === "SUPERSEDES" ? "checkpoints replaced full snapshots" : null) });
    const area = d.story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([
      {
        documentId: "n2",
        then: { claim: "Storage keeps every snapshot", gist: "old gist" },
        now: { claim: "Storage keeps snapshots per checkpoint", gist: "new gist" },
        why: "checkpoints replaced full snapshots",
        replacedBy: "n9",
      },
    ]);
    // Archived and replaced: a shift, not a retirement.
    expect(area?.retiredClaims).toEqual([]);
  });

  it("is not a shift when only the version stamp or only the body changed", () => {
    const baseline = [
      row("n1", "SET_TITLE", { title: "Same claim" }, BEFORE),
      row("n1", "SET_METADATA_FIELD", { field: "version", value: "v1" }, BEFORE),
      row("n3", "SET_TITLE", { title: "Body claim" }, BEFORE),
      row("n3", "SET_CONTENT", { content: "a" }, BEFORE),
    ];
    const rows = [
      row("n1", "SET_METADATA_FIELD", { field: "version", value: "v2" }, IN(1)),
      row("n3", "SET_CONTENT", { content: "b" }, IN(1)),
    ];
    const s = story([["n1", note("Same claim")], ["n3", note("Body claim")]]);
    const d = digest(rows, baseline, s);
    expect(d.events).toBeUndefined();
    expect(d.totals).toMatchObject({ reverified: 1, revised: 1 });
    expect(d.story?.areas).toEqual([]);
  });

  it("lists a note archived with no replacement as retired", () => {
    const rows = [row("n3", "ARCHIVE_NOTE", { comment: "obsolete" }, IN(1))];
    const s = story([["n3", note("Processors poll", { status: "ARCHIVED", description: "every second" })]]);
    const area = digest(rows, [], s).story?.areas[0];
    expect(area).toMatchObject({ id: "a2", notesThen: 1, notesNow: 0, retiredClaims: [{ documentId: "n3", claim: "Processors poll", gist: "every second" }] });
  });
});

describe("story: new claims and growth", () => {
  it("orders new claims by incoming knowledge edges, ties by recency", () => {
    const rows = [row("c1", "CREATE_DOCUMENT", {}, IN(1)), row("c2", "CREATE_DOCUMENT", {}, IN(2)), row("c3", "CREATE_DOCUMENT", {}, IN(3))];
    const s = story(
      [
        ["c1", note("C1", { incoming: 1, addedAt: IN(1) })],
        ["c2", note("C2", { incoming: 5, addedAt: IN(2) })],
        ["c3", note("C3", { incoming: 5, addedAt: IN(3) })],
      ],
      { coreIdeas: new Map([["a2", ["c1", "c2", "c3"]]]) },
    );
    expect(digest(rows, [], s).story?.areas[0].newClaims.map((c) => c.documentId)).toEqual(["c3", "c2", "c1"]);
  });

  it("counts live notes then and now, and names the new areas and maps", () => {
    const rows = [
      row("a3", "CREATE_MOC", { title: "Workflow Automation" }, IN(1)),
      row("m3", "CREATE_MOC", { title: "Workflow triggers" }, IN(1)),
      row("w1", "CREATE_DOCUMENT", {}, IN(2)),
    ];
    const s = story(
      [
        ["a3", map("Workflow Automation", { addedAt: IN(1) })],
        ["m3", map("Workflow triggers", { addedAt: IN(1) })],
        ["w1", note("Workflows run on hosts", { addedAt: IN(2) })],
        ["n1", note("Old claim")],
        ["n3", note("Gone before", { status: "ARCHIVED" })],
      ],
      {
        childMaps: new Map([
          ["hub", ["a1", "a2", "a3"]],
          ["a1", ["m1"]],
          ["a3", ["m3"]],
        ]),
        coreIdeas: new Map([
          ["m1", ["n1"]],
          ["a2", ["n3"]],
          ["m3", ["w1"]],
        ]),
        archivedAtSince: new Set(["n3"]),
      },
    );
    const d = digest(rows, [], s);
    expect(d.story?.growth).toEqual({
      notesThen: 1,
      notesNow: 2,
      newAreas: [{ id: "a3", title: "Workflow Automation" }],
      newMaps: [{ id: "m3", title: "Workflow triggers", area: "Workflow Automation" }],
    });
    expect(d.story?.areas.map((a) => [a.id, a.notesThen, a.notesNow])).toEqual([["a3", 0, 1]]);
  });

  it("caps new, changed and retired claims per area at 8, 8 and 5", () => {
    const rows: OperationRow[] = [];
    const baseline: OperationRow[] = [];
    const nodes: [string, StoryNode][] = [];
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row(`new${i}`, "CREATE_DOCUMENT", {}, IN(1, i)));
      nodes.push([`new${i}`, note(`New ${i}`, { addedAt: IN(1, i) })]);
      baseline.push(row(`chg${i}`, "SET_TITLE", { title: `Old ${i}` }, BEFORE));
      rows.push(row(`chg${i}`, "SET_TITLE", { title: `Changed ${i}` }, IN(2, i)));
      nodes.push([`chg${i}`, note(`Changed ${i}`)]);
      rows.push(row(`ret${i}`, "ARCHIVE_NOTE", {}, IN(3, i)));
      nodes.push([`ret${i}`, note(`Retired ${i}`, { status: "ARCHIVED" })]);
      ids.push(`new${i}`, `chg${i}`, `ret${i}`);
    }
    const s = story(nodes, { coreIdeas: new Map([["a2", ids]]) });
    const area = digest(rows, baseline, s).story?.areas[0];
    expect(area?.newClaims).toHaveLength(MAX_NEW_CLAIMS);
    expect(area?.changedClaims).toHaveLength(MAX_CHANGED_CLAIMS);
    expect(area?.retiredClaims).toHaveLength(MAX_RETIRED_CLAIMS);
    expect([MAX_NEW_CLAIMS, MAX_CHANGED_CLAIMS, MAX_RETIRED_CLAIMS]).toEqual([8, 8, 5]);
  });
});

describe("story: scope and then-vs-now", () => {
  const baseline = [row("n1", "SET_TITLE", { title: "Delivery is exactly once, in order" }, BEFORE)];
  const rows = [
    row("n1", "SET_TITLE", { title: "Delivery is at-least-once, with a crash gap" }, IN(1)),
    row("n6", "CREATE_DOCUMENT", {}, IN(2)),
  ];
  const nodes: [string, StoryNode][] = [
    ["n1", note("Delivery is at-least-once, with a crash gap", { incoming: 3 })],
    ["n6", note("Processors checkpoint per batch", { addedAt: IN(2) })],
    ["n7", note("Processors poll the reactor", { status: "ARCHIVED" })],
    ["n8", note("Processors run in the reactor's process", { incoming: 1 })],
    ["n3", note("Outside the scope")],
  ];

  it("answers then vs now for a q scope: then-titles at since, without notes archived before or created after", () => {
    const s = story(nodes, { archivedAtSince: new Set(["n7"]), coreIdeas: new Map([["a2", ["n1", "n6", "n7", "n8", "n3"]]]) });
    const d = digest(rows, baseline, s, { q: "processor delivery", documentIds: ["n1", "n6", "n7", "n8"] });
    expect(d.thenVsNow?.then).toEqual([
      { documentId: "n1", claim: "Delivery is exactly once, in order", gist: null },
      { documentId: "n8", claim: "Processors run in the reactor's process", gist: null },
    ]);
    expect(d.thenVsNow?.now).toEqual([
      { documentId: "n1", claim: "Delivery is at-least-once, with a crash gap", gist: null },
      { documentId: "n6", claim: "Processors checkpoint per batch", gist: null },
      { documentId: "n8", claim: "Processors run in the reactor's process", gist: null },
    ]);
    // The story is restricted to the scope: n3 is not counted.
    expect(d.story?.areas[0]).toMatchObject({ id: "a2", notesThen: 2, notesNow: 3 });
  });

  it("gives no thenVsNow for an unscoped or map-scoped call", () => {
    const s = story(nodes);
    expect(digest(rows, baseline, s).thenVsNow).toBeUndefined();
    expect(digest(rows, baseline, s, { moc: "a2", documentIds: ["n1"] }).thenVsNow).toBeUndefined();
  });

  it("leaves out notes superseded before since from then, and every superseded note from now", () => {
    const s = story(nodes, { superseded: new Set(["n8"]) });
    const d = digest(rows, baseline, s, { topic: "processors", documentIds: ["n1", "n8"] });
    expect(d.thenVsNow?.then.map((c) => c.documentId)).toEqual(["n1"]);
    expect(d.thenVsNow?.now.map((c) => c.documentId)).toEqual(["n1"]);
  });

  it("caps then and now at 12 each", () => {
    const many: [string, StoryNode][] = Array.from({ length: 15 }, (_, i) => [`p${i}`, note(`Claim ${i}`)]);
    const d = digest([], [], story(many), { q: "x", documentIds: many.map(([id]) => id) });
    expect(d.thenVsNow?.then).toHaveLength(MAX_THEN_VS_NOW);
    expect(d.thenVsNow?.now).toHaveLength(MAX_THEN_VS_NOW);
    expect(MAX_THEN_VS_NOW).toBe(12);
  });
});
