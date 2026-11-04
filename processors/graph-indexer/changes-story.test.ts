import { describe, expect, it } from "vitest";
import { buildChanges, firstRecorded, type ChangeContext, type ChangeScope, type OperationRow } from "./changes.js";
import { loadChangesFixture } from "../../tests/fixtures/changes/load.js";
import { areasOf, claimTokens, isDuplicateMerge, matchMapTitle, MAX_CHANGED_CLAIMS, MAX_NEW_CLAIMS, MAX_RETIRED_CLAIMS, MAX_THEN_VS_NOW, type StoryContext, type StoryNode } from "./changes-story.js";

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
    expect(d.thenVsNow?.then).toEqual([{ documentId: "n1", claim: "Delivery is exactly once, in order", gist: null }]);
    expect(d.thenVsNow?.now).toEqual([
      { documentId: "n1", claim: "Delivery is at-least-once, with a crash gap", gist: null },
      { documentId: "n6", claim: "Processors checkpoint per batch", gist: null },
    ]);
    expect(d.thenVsNow?.unchanged).toEqual([{ documentId: "n8", claim: "Processors run in the reactor's process", gist: null }]);
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

  it("caps then, now and unchanged at 12 each", () => {
    const many: [string, StoryNode][] = Array.from({ length: 15 }, (_, i) => [`p${i}`, note(`Claim ${i}`)]);
    const d = digest([], [], story(many), { q: "x", documentIds: many.map(([id]) => id) });
    expect(d.thenVsNow?.unchanged).toHaveLength(MAX_THEN_VS_NOW);
    const baseline = many.map(([id], i) => row(id, "SET_TITLE", { title: `Was ${i}` }, BEFORE));
    const rows = many.map(([id], i) => row(id, "SET_TITLE", { title: `Claim ${i}` }, IN(1, i)));
    const moved = digest(rows, baseline, story(many), { q: "x", documentIds: many.map(([id]) => id) });
    expect(moved.thenVsNow?.then).toHaveLength(MAX_THEN_VS_NOW);
    expect(moved.thenVsNow?.now).toHaveLength(MAX_THEN_VS_NOW);
    expect(MAX_THEN_VS_NOW).toBe(12);
  });
});

describe("story: review fixes (Addendum A)", () => {
  it("files a supersession under the replacement's area when the old note was in no area", () => {
    const rows = [
      row("n9", "CREATE_DOCUMENT", {}, IN(1)),
      row("n9", "ADD_RELATIONSHIP", { sourceId: "n9", targetId: "old", relationshipType: "SUPERSEDES", metadata: { reason: "better" } }, IN(2)),
      row("old", "ARCHIVE_NOTE", {}, IN(3)),
    ];
    const s = story(
      [
        ["old", note("Old loose claim", { status: "ARCHIVED" })],
        ["n9", note("New mapped claim", { addedAt: IN(1) })],
      ],
      { coreIdeas: new Map([["a2", ["n9"]]]) },
    );
    const areas = digest(rows, [], s).story?.areas ?? [];
    expect(areas.find((a) => a.id === "a2")?.changedClaims.map((c) => c.documentId)).toEqual(["old"]);
    expect(areas.find((a) => a.id === null)?.changedClaims ?? []).toEqual([]);
  });

  it("does not list a replacing note as new: it is the shift's now", () => {
    const rows = [
      row("n9", "CREATE_DOCUMENT", {}, IN(1)),
      row("n9", "ADD_RELATIONSHIP", { sourceId: "n9", targetId: "n2", relationshipType: "SUPERSEDES" }, IN(2)),
    ];
    const s = story(
      [
        ["n2", note("Storage keeps every snapshot", { status: "ARCHIVED" })],
        ["n9", note("Storage keeps snapshots per checkpoint", { addedAt: IN(1) })],
      ],
      { coreIdeas: new Map([["m2", ["n2", "n9"]]]) },
    );
    const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims.map((c) => c.replacedBy)).toEqual(["n9"]);
    expect(area?.newClaims).toEqual([]);
    expect(area?.newCount).toBe(0);
  });

  it("does not retire a note archived and restored in the window", () => {
    const rows = [row("n3", "ARCHIVE_NOTE", {}, IN(1)), row("n3", "RESTORE_NOTE", {}, IN(2))];
    const s = story([["n3", note("Processors poll")]]);
    const d = digest(rows, [], s);
    expect(d.story?.areas.flatMap((a) => a.retiredClaims)).toEqual([]);
  });

  it("does not retire a note archived in the window that was superseded before it", () => {
    const rows = [row("n3", "ARCHIVE_NOTE", {}, IN(1))];
    const s = story([["n3", note("Processors poll", { status: "ARCHIVED" })]], { superseded: new Set(["n3"]) });
    expect(digest(rows, [], s).story?.areas.flatMap((a) => a.retiredClaims)).toEqual([]);
  });

  it("is not a shift when the baseline lost the then-title (null falls back to now)", () => {
    const baseline = [row("n1", "SET_DESCRIPTION", { description: "same gist" }, BEFORE)];
    const rows = [row("n1", "SET_TITLE", { title: "Current claim" }, IN(1))];
    const s = story([["n1", note("Current claim", { description: "same gist" })]]);
    expect(digest(rows, baseline, s).story?.areas.flatMap((a) => a.changedClaims)).toEqual([]);
  });

  it("emits a description-only shift: same claim, different gist", () => {
    const baseline = [row("n1", "SET_TITLE", { title: "Same claim" }, BEFORE), row("n1", "SET_DESCRIPTION", { description: "old gist" }, BEFORE)];
    const rows = [row("n1", "SET_DESCRIPTION", { description: "new gist" }, IN(1))];
    const s = story([["n1", note("Same claim", { description: "new gist" })]]);
    expect(digest(rows, baseline, s).story?.areas[0].changedClaims).toEqual([
      { documentId: "n1", then: { claim: "Same claim", gist: "old gist" }, now: { claim: "Same claim", gist: "new gist" }, why: null },
    ]);
  });

  it("unions several hubs, and counts a note whose map sits under two areas in both", () => {
    const rows = [row("x1", "CREATE_DOCUMENT", {}, IN(1))];
    const s = story([["hub2", map("Second hub")], ["a4", map("Plugins")], ["shared", map("Shared map")], ["x1", note("Shared claim", { addedAt: IN(1) })]], {
      hubs: ["hub", "hub2"],
      childMaps: new Map([
        ["hub", ["a1", "a2"]],
        ["hub2", ["a4"]],
        ["a2", ["shared"]],
        ["a4", ["shared"]],
      ]),
      coreIdeas: new Map([["shared", ["x1"]]]),
    });
    expect(areasOf(s).areas.map((a) => a.id)).toEqual(["a4", "a2", "a1"]);
    const areas = digest(rows, [], s).story?.areas ?? [];
    expect(areas.map((a) => [a.id, a.newClaims.map((c) => c.documentId)])).toEqual([
      ["a4", ["x1"]],
      ["a2", ["x1"]],
    ]);
  });

  it("carries uncapped counts of new, changed and retired claims per area", () => {
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
    const area = digest(rows, baseline, story(nodes, { coreIdeas: new Map([["a2", ids]]) })).story?.areas[0];
    expect(area).toMatchObject({ newCount: 10, changedCount: 10, retiredCount: 10 });
  });

  it("gives no story or thenVsNow on a cursor page (the first page carried them)", () => {
    const rows = [row("n1", "SET_TITLE", { title: "A" }, IN(1)), row("n6", "CREATE_DOCUMENT", {}, IN(2))];
    const s = story([["n1", note("A")], ["n6", note("B", { addedAt: IN(2) })]]);
    const first = buildChanges(rows, [], ctx(s), W, { scope: { q: "x", documentIds: ["n1", "n6"] }, limit: 1 });
    expect(first.story).toBeDefined();
    expect(first.nextCursor).toBeTruthy();
    const next = buildChanges(rows, [], ctx(s), W, { scope: { q: "x", documentIds: ["n1", "n6"] }, limit: 1, cursor: first.nextCursor });
    expect(next.events).toHaveLength(1);
    expect(next.story).toBeUndefined();
    expect(next.thenVsNow).toBeUndefined();
  });

  it("lists a claim the vault holds unchanged once, under unchanged, not on both sides", () => {
    const baseline = [row("n1", "SET_TITLE", { title: "Then claim" }, BEFORE)];
    const rows = [row("n1", "SET_TITLE", { title: "Now claim" }, IN(1))];
    const s = story([["n1", note("Now claim")], ["n8", note("Steady claim")]]);
    const t = digest(rows, baseline, s, { q: "x", documentIds: ["n1", "n8"] }).thenVsNow;
    expect(t).toEqual({
      then: [{ documentId: "n1", claim: "Then claim", gist: null }],
      now: [{ documentId: "n1", claim: "Now claim", gist: null }],
      unchanged: [{ documentId: "n8", claim: "Steady claim", gist: null }],
    });
  });
});

describe("story: duplicate merges (Addendum B3)", () => {
  const supersede = (by: string, old: string, reason: string, at = IN(2)) =>
    row(by, "ADD_RELATIONSHIP", { sourceId: by, targetId: old, relationshipType: "SUPERSEDES", metadata: { reason } }, at);

  it("does not make a near-identical twin merged by SUPERSEDES with no reason a shift: it is counted as merged", () => {
    const rows = [supersede("n9", "n2", "")];
    const s = story([
      ["n2", note("Storage keeps every snapshot of a document", { status: "ARCHIVED" })],
      ["n9", note("Storage keeps every snapshot of each document")],
    ], { coreIdeas: new Map([["m1", ["n2", "n9"]]]) });
    const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([]);
    expect(area?.changedCount).toBe(0);
    expect(area?.mergedCount).toBe(1);
  });

  it("does not make a supersession whose reason marks a duplicate a shift, whatever the titles", () => {
    const reasons = ["Twin of the newer note", "duplicate claim", "Same claim, written earlier", "n9 already makes this claim", "Merged into the newer note"];
    for (const reason of reasons) {
      const rows = [supersede("n9", "n2", reason)];
      const s = story([
        ["n2", note("Snapshots are kept forever", { status: "ARCHIVED" })],
        ["n9", note("The reactor retains each document state indefinitely")],
      ], { coreIdeas: new Map([["m1", ["n2", "n9"]]]) });
      const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
      expect([reason, area?.changedClaims.length, area?.mergedCount]).toEqual([reason, 0, 1]);
    }
  });

  it("keeps a real replacement as a shift, and does not list a merged twin created in the window as new", () => {
    const rows = [
      supersede("n9", "n2", "checkpoints replaced full snapshots"),
      row("n7", "CREATE_DOCUMENT", {}, IN(1)),
      supersede("n1", "n7", "same claim, written earlier", IN(3)),
    ];
    const s = story([
      ["n2", note("Storage keeps every snapshot", { status: "ARCHIVED" })],
      ["n9", note("Storage keeps snapshots per checkpoint")],
      ["n7", note("A twin", { addedAt: IN(1) })],
      ["n1", note("The original")],
    ], { coreIdeas: new Map([["m1", ["n1", "n2", "n7", "n9"]]]) });
    const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims.map((c) => c.documentId)).toEqual(["n2"]);
    expect(area?.mergedCount).toBe(1);
    expect(area?.newClaims.map((c) => c.documentId)).toEqual([]);
  });
});

describe("story: first recorded vs now (Addendum B4)", () => {
  // Created at 01:00 by an extraction batch (fields within minutes), revised at 05:00.
  const created = (late: OperationRow[] = []) => [
    row("n2", "CREATE_DOCUMENT", {}, IN(1)),
    row("n2", "SET_TITLE", { title: "Draft title" }, IN(1, 1)),
    row("n2", "SET_TITLE", { title: "Delivery is exactly once, in order" }, IN(1, 5)),
    row("n2", "SET_DESCRIPTION", { description: "Each operation reaches a processor once" }, IN(1, 5)),
    row("n2", "SET_CONTENT", { content: "body\n\n## Revision history\n- v6.2.2-dev.74 (2026-09-02): first" }, IN(1, 6)),
    ...late,
  ];
  const revisedLater = [
    row("n2", "SET_TITLE", { title: "Delivery is at-least-once, with a crash gap" }, IN(5)),
    row("n2", "SET_CONTENT", { content: "body2\n\n## Revision history\n- v6.2.2-dev.74 (2026-09-02): first\n- v6.2.3-dev.91 (2026-11-03): the outbox replays after a crash" }, IN(5, 1)),
  ];
  const nodes = (): [string, StoryNode][] => [["n2", note("Delivery is at-least-once, with a crash gap", { description: "Each operation reaches a processor once", addedAt: IN(1) })]];

  it("makes a note created in the window and revised after its creating batch a shift from its first recorded state, and still new", () => {
    const area = digest(created(revisedLater), [], story(nodes())).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([
      {
        documentId: "n2",
        then: { claim: "Delivery is exactly once, in order", gist: "Each operation reaches a processor once" },
        now: { claim: "Delivery is at-least-once, with a crash gap", gist: "Each operation reaches a processor once" },
        why: "v6.2.3-dev.91 (2026-11-03): the outbox replays after a crash",
        thenAt: IN(1, 5),
      },
    ]);
    expect(area?.newClaims.map((c) => c.documentId)).toEqual(["n2"]);
  });

  it("is not a shift when the note reads now as its creating batch left it", () => {
    const s = story([["n2", note("Delivery is exactly once, in order", { description: "Each operation reaches a processor once", addedAt: IN(1) })]]);
    const area = digest(created(), [], s).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([]);
    expect(area?.newClaims.map((c) => c.documentId)).toEqual(["n2"]);
  });

  it("does not count a title written more than an hour after creation as first recorded", () => {
    const rows = [row("n2", "CREATE_DOCUMENT", {}, IN(1)), row("n2", "SET_TITLE", { title: "Late title" }, IN(2, 1))];
    const s = story([["n2", note("Now title", { addedAt: IN(1) })]]);
    expect(digest(rows, [], s).story?.areas.find((a) => a.id === "a1")?.changedClaims).toEqual([]);
  });

  it("puts a created-then-revised note's first recorded claim on the then side of thenVsNow", () => {
    const t = digest(created(revisedLater), [], story(nodes()), { q: "delivery", documentIds: ["n2"] }).thenVsNow;
    expect(t?.then).toEqual([{ documentId: "n2", claim: "Delivery is exactly once, in order", gist: "Each operation reaches a processor once", thenAt: IN(1, 5) }]);
    expect(t?.now.map((c) => c.documentId)).toEqual(["n2"]);
    expect(t?.unchanged).toEqual([]);
  });

  it("reports an area's source versions: the ref standing at since (else first in the window) → the latest", () => {
    const rows = [row("n1", "SET_TITLE", { title: "New" }, IN(1)), row("n3", "SET_TITLE", { title: "New 3" }, IN(1))];
    const baseline = [row("n1", "SET_TITLE", { title: "Old" }, BEFORE), row("n3", "SET_TITLE", { title: "Old 3" }, BEFORE)];
    const s = story([["n1", note("New")], ["n3", note("New 3")]], {
      derivedFrom: new Map([["n1", ["s1", "s2"]], ["n3", ["s3"]]]),
      ingests: new Map([
        ["s1", [{ at: "2026-06-01T00:00:00.000Z", ref: "v6.2.1" }, { at: "2026-09-02T00:00:00.000Z", ref: "v6.2.2-dev.74" }, { at: IN(4), ref: "v6.2.3-dev.91+e0f277d" }]],
        ["s2", [{ at: IN(2), ref: "v6.2.3-dev.90" }]],
        ["s3", [{ at: IN(3), ref: null }]],
      ]),
    });
    const d = buildChanges(rows, baseline, ctx(s), { since: "2026-09-01T00:00:00.000Z", until: W.until }, { scope: {} });
    const areas = d.story?.areas ?? [];
    expect(areas.find((a) => a.id === "a1")?.versions).toEqual({ first: "v6.2.1", now: "v6.2.3-dev.91+e0f277d" });
    // No git refs: no versions.
    expect(areas.find((a) => a.id === "a2")?.versions).toBeUndefined();
  });
});

describe("story: first recorded vs now on the recorded 2026-11-03 sync", () => {
  // A real note: created 19:30:26, fields written 19:30:27, body rewritten 19:34 — one batch.
  const ID = "X64lW2nOJzR5JBqM7k8HgWCW69-r7yy8H8aXHvrqRy4";
  const rowsOf = () =>
    loadChangesFixture()
      .rows.filter((r) => r.documentId === ID)
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index));
  const titleOf = (rows: OperationRow[]) => JSON.parse(rows.find((r) => r.operationType === "SET_TITLE")?.inputJson ?? "{}") as { title: string };

  it("reads its first recorded state from the creating batch, a rewrite minutes later included", () => {
    const rows = rowsOf();
    const first = firstRecorded(rows);
    expect(first?.at).toBe("2026-11-03T19:30:27.660Z");
    expect(first?.title).toBe(titleOf(rows).title);
  });

  it("is new only as recorded, and a shift once its title is revised hours later", () => {
    const rows = rowsOf();
    const { title } = titleOf(rows);
    const s = (now: string) =>
      story([[ID, note(now, { description: null, addedAt: rows[0].timestamp })]], { coreIdeas: new Map([["a2", [ID]]]) });
    const window = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-04T00:00:00.000Z" };
    const run = (r: OperationRow[], now: string) => buildChanges(r, [], ctx(s(now)), window, { scope: {} }).story?.areas.find((a) => a.id === "a2");
    // The description as now = as first recorded, so only the title decides.
    const desc = (JSON.parse(rows.find((r) => r.operationType === "SET_DESCRIPTION")?.inputJson ?? "{}") as { description: string }).description;
    const withDesc = (r: OperationRow[], now: string) =>
      buildChanges(r, [], ctx(story([[ID, note(now, { description: desc, addedAt: rows[0].timestamp })]], { coreIdeas: new Map([["a2", [ID]]]) })), window, { scope: {} }).story?.areas.find((a) => a.id === "a2");
    expect(withDesc(rows, title)?.changedClaims).toEqual([]);
    const late = [...rows, row(ID, "SET_TITLE", { title: "Read models on another handle are now fenced" }, "2026-11-03T22:00:00.000Z")];
    const shift = withDesc(late, "Read models on another handle are now fenced")?.changedClaims[0];
    expect(shift).toMatchObject({ documentId: ID, then: { claim: title }, now: { claim: "Read models on another handle are now fenced" }, thenAt: "2026-11-03T19:30:27.660Z" });
    expect(run(late, "x")?.newClaims.map((c) => c.documentId)).toEqual([ID]);
  });
});

describe("scope: a query names a map (Addendum B2)", () => {
  const maps = [
    { id: "a1", title: "Data Processing and CQRS", depth: 1 },
    { id: "a2", title: "Reactor and Drives", depth: 1 },
    { id: "m1", title: "Processors", depth: 2 },
    { id: "m2", title: "Reactor storage", depth: 2 },
    { id: "m3", title: "Processor delivery", depth: 3 },
  ];
  it("matches a map whose title holds the query's words, case-insensitive, plurals folded", () => {
    expect(matchMapTitle("data processing", maps)?.id).toBe("a1");
    expect(matchMapTitle("PROCESSOR", maps)?.id).toBe("m1");
    expect(matchMapTitle("reactor", maps)?.id).toBe("a2"); // an area before a descendant map
  });
  it("prefers the map whose title is exactly the query, then the shallower, then the shorter title", () => {
    expect(matchMapTitle("reactor storage", maps)?.id).toBe("m2");
    expect(matchMapTitle("processor delivery", maps)?.id).toBe("m3");
  });
  it("matches a map whose whole title the query contains", () => {
    expect(matchMapTitle("what changed in reactor storage lately", maps)?.id).toBe("m2");
  });
  it("matches nothing for a subject no map title names, or only stopwords", () => {
    expect(matchMapTitle("Powerhouse stack", maps)).toBeNull();
    expect(matchMapTitle("the and of", maps)).toBeNull();
    expect(matchMapTitle("proc", maps)).toBeNull(); // whole words only
  });
});

describe("story: review B fixes", () => {
  const supersede = (by: string, old: string, reason: string, at: string) =>
    row(by, "ADD_RELATIONSHIP", { sourceId: by, targetId: old, relationshipType: "SUPERSEDES", metadata: { reason } }, at);
  const LONG = { since: "2026-06-01T00:00:00.000Z", until: "2026-11-04T00:00:00.000Z" };

  describe("C1: a duplicate merge needs an anchored duplicate phrase, or no reason and a near-identical title", () => {
    it("never counts a real reversal as a merge, with no reason or a neutral one", () => {
      const reversals: [string, string][] = [
        ["Processors receive operations exactly once", "Processors receive operations at least once"],
        ["Relational processors are supported", "Relational processors are not supported"],
        ["Switchboard runs on v6.2.2-dev.74", "Switchboard runs on v6.2.3-dev.91"],
        ["Connect runs the reactor in-process", "Connect runs the reactor remotely"],
        ["Drives sync by pull responders", "Drives sync by push listeners"],
      ];
      for (const [then, now] of reversals) {
        expect([then, isDuplicateMerge(then, now, null)]).toEqual([then, false]);
        expect([then, isDuplicateMerge(then, now, "")]).toEqual([then, false]);
        expect([then, isDuplicateMerge(then, now, "dev.91 changed this")]).toEqual([then, false]);
      }
    });

    it("does not read a reason that merely mentions duplicates or merging as a merge", () => {
      for (const reason of [
        "Delivery is at-least-once: a crash replays operations, so processors see duplicate operations after a crash",
        "Replaced: the old processor API was merged into the reactor package in dev.91",
        "Duplicates the newer note",
      ]) {
        expect([reason, isDuplicateMerge("A claim", "Another claim entirely", reason)]).toEqual([reason, false]);
      }
    });

    it("reads an anchored duplicate phrase as a merge, whatever the titles", () => {
      for (const reason of [
        "Same claim, written earlier",
        "Same point, better evidence",
        "Redundant with the newer note, which says the same",
        "Identical claim written earlier",
        "n9 already makes this claim",
        "Twin of the newer note",
        "duplicate of n9",
        "Merged into the surviving note",
        // Addendum C6: rewordings whose reason says they state the same thing.
        "The newer note states the same, with the dev.91 wording",
        "Same floor as the older note, said more plainly",
        "Reworded: same rule",
        "same limit, clearer wording",
        "Same default, restated",
      ]) {
        expect([reason, isDuplicateMerge("Snapshots are kept forever", "The reactor retains each document state indefinitely", reason)]).toEqual([reason, true]);
      }
    });

    it("counts an unexplained supersession of a near-identical title as a merge (Jaccard ≥ 0.8, no negation, no number)", () => {
      expect(isDuplicateMerge("Storage keeps every snapshot of a document", "Storage keeps every snapshot of each document", null)).toBe(true);
      // 0.75 — under the bar.
      expect(isDuplicateMerge("Storage keeps snapshots", "Storage keeps all snapshots", null)).toBe(false);
      // Near-identical but negated or renumbered: a change.
      expect(isDuplicateMerge("The reactor keeps every snapshot of each document", "The reactor keeps every snapshot of each document never", null)).toBe(false);
      expect(isDuplicateMerge("The reactor keeps every snapshot of each document for every drive and remote in release v5", "The reactor keeps every snapshot of each document for every drive and remote in release v6", null)).toBe(false);
    });

    it("makes 'exactly once' → 'at least once' with a reason about duplicate operations a shift, not a merge", () => {
      const rows = [supersede("n9", "n2", "dev.91 outbox replays after a crash, so processors see duplicate operations", IN(2))];
      const s = story([
        ["n2", note("Processors receive each operation exactly once, in order", { status: "ARCHIVED" })],
        ["n9", note("Processors receive operations at least once, with a crash gap")],
      ], { coreIdeas: new Map([["m1", ["n2", "n9"]]]) });
      const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
      expect(area?.changedClaims.map((c) => c.documentId)).toEqual(["n2"]);
      expect(area?.mergedCount).toBe(0);
    });
  });

  it("I1: gives a note created in the window and superseded in it its first recorded then, with thenAt, on both surfaces", () => {
    const rows = [
      row("old", "CREATE_DOCUMENT", {}, "2026-09-02T10:00:00.000Z"),
      row("old", "SET_TITLE", { title: "Processors receive each operation exactly once, in order" }, "2026-09-02T10:00:01.000Z"),
      row("new", "CREATE_DOCUMENT", {}, "2026-11-03T10:00:00.000Z"),
      row("new", "SET_TITLE", { title: "Processors receive operations at least once, with a crash gap" }, "2026-11-03T10:00:01.000Z"),
      supersede("new", "old", "dev.91 outbox replays after a crash", "2026-11-03T10:00:02.000Z"),
      row("old", "ARCHIVE_NOTE", { comment: "superseded" }, "2026-11-03T10:00:03.000Z"),
    ];
    const s = story(
      [
        ["old", note("Processors receive each operation exactly once, in order", { status: "ARCHIVED", addedAt: "2026-09-02T10:00:00.000Z" })],
        ["new", note("Processors receive operations at least once, with a crash gap", { addedAt: "2026-11-03T10:00:00.000Z" })],
      ],
      { coreIdeas: new Map([["a2", ["old", "new"]]]), superseded: new Set(["old"]) },
    );
    const d = buildChanges(rows, [], ctx(s), LONG, { scope: { documentIds: ["old", "new"] }, thenVsNow: true });
    const area = d.story?.areas.find((a) => a.id === "a2");
    expect(area?.changedClaims).toEqual([
      {
        documentId: "old",
        then: { claim: "Processors receive each operation exactly once, in order", gist: null },
        now: { claim: "Processors receive operations at least once, with a crash gap", gist: null },
        why: "dev.91 outbox replays after a crash",
        replacedBy: "new",
        thenAt: "2026-09-02T10:00:01.000Z",
      },
    ]);
    expect(d.thenVsNow?.then).toEqual([{ documentId: "old", claim: "Processors receive each operation exactly once, in order", gist: null, thenAt: "2026-09-02T10:00:01.000Z" }]);
    expect(d.thenVsNow?.now.map((c) => c.documentId)).toEqual(["new"]);
  });

  it("I2: leaves a merged twin out of thenVsNow; its survivor reads as unchanged", () => {
    const rows = [supersede("t2", "t1", "Same claim, written earlier", "2026-11-03T10:00:00.000Z"), row("t1", "ARCHIVE_NOTE", {}, "2026-11-03T10:00:01.000Z")];
    const s = story(
      [
        ["t1", note("Drives are documents", { status: "ARCHIVED", addedAt: "2026-01-01T00:00:00.000Z" })],
        ["t2", note("A drive is a document", { addedAt: "2026-01-01T00:00:00.000Z" })],
      ],
      { coreIdeas: new Map([["a2", ["t1", "t2"]]]), superseded: new Set(["t1"]) },
    );
    const d = buildChanges(rows, [], ctx(s), LONG, { scope: { documentIds: ["t1", "t2"] }, thenVsNow: true });
    expect(d.story?.areas.find((a) => a.id === "a2")?.mergedCount).toBe(1);
    expect(d.thenVsNow).toEqual({ then: [], now: [], unchanged: [{ documentId: "t2", claim: "A drive is a document", gist: null }] });
  });

  it("M1: lists a note created, revised and archived in the window as retired only, not also changed", () => {
    const rows = [
      row("n2", "CREATE_DOCUMENT", {}, IN(1)),
      row("n2", "SET_TITLE", { title: "First claim" }, IN(1, 1)),
      row("n2", "SET_TITLE", { title: "Revised claim" }, IN(5)),
      row("n2", "ARCHIVE_NOTE", {}, IN(6)),
    ];
    const s = story([["n2", note("Revised claim", { status: "ARCHIVED", addedAt: IN(1) })]]);
    const area = digest(rows, [], s).story?.areas.find((a) => a.id === "a1");
    expect(area?.changedClaims).toEqual([]);
    expect(area?.changedCount).toBe(0);
    expect(area?.retiredClaims).toEqual([{ documentId: "n2", claim: "First claim", gist: null, thenAt: IN(1, 1) }]);
  });

  describe("I3: a query names a map only when the map covers it", () => {
    const maps = [
      { id: "rd", title: "Reactor and Drives", depth: 1 },
      { id: "rs", title: "Reactor Sync Infrastructure", depth: 2 },
      { id: "dp", title: "Data Processing and CQRS", depth: 1 },
      { id: "pr", title: "Processors", depth: 2 },
      { id: "auth", title: "Authorization", depth: 1 },
      { id: "dep", title: "Deployment", depth: 1 },
      { id: "c", title: "Connect", depth: 1 },
    ];
    it("searches when the map's title covers under half of the query's content and another map shares a word", () => {
      expect(matchMapTitle("how documents sync between Connect and Switchboard", maps)).toBeNull();
    });
    it("searches when two maps match equally (no alphabetical tie-break)", () => {
      expect(matchMapTitle("authorization in connect", maps)).toBeNull();
    });
    it("still names the map a query covers", () => {
      expect(matchMapTitle("reactor", maps)?.id).toBe("rd");
      expect(matchMapTitle("what changed in reactor sync", maps)?.id).toBe("rs");
      expect(matchMapTitle("deployment of the switchboard", maps)?.id).toBe("dep");
      expect(matchMapTitle("authorization changes", maps)?.id).toBe("auth");
      // Under half, but the only map that shares a word with the query.
      expect(matchMapTitle("How did processor delivery work in September and how does it work now?", maps)?.id).toBe("pr");
    });
  });

  it("M3: folds plurals without clipping 'does', 'status' or 'analysis'", () => {
    expect([...claimTokens("does process address status analysis processors drives")]).toEqual(["does", "process", "address", "status", "analysis", "processor", "drive"]);
  });
});
