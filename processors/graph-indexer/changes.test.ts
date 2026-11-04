import { describe, expect, it } from "vitest";
import {
  buildChanges,
  ChangeInputError,
  cursorUntil,
  diffLines,
  parseWindow,
  type ChangeContext,
  type OperationRow,
} from "./changes.js";
import { fixtureContext, loadChangesFixture } from "../../tests/fixtures/changes/load.js";

const fixture = loadChangesFixture();

// ---- Hand-built rows ----

let seq = 0;
function row(documentId: string, operationType: string, input: Record<string, unknown>, timestamp: string, documentType = "bai/knowledge-note"): OperationRow {
  return { documentId, documentType, operationType, timestamp, index: seq++, inputJson: JSON.stringify(input), signerAddress: "0xabc" };
}

function ctx(partial: Partial<ChangeContext> = {}): ChangeContext {
  return {
    nodes: new Map(),
    sources: new Map(),
    mocsByNote: new Map(),
    derivedFrom: new Map(),
    edgeReason: () => null,
    ...partial,
  };
}

const W = { since: "2026-11-03T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" };

describe("parseWindow", () => {
  it("reads date-only bounds as whole UTC days", () => {
    expect(parseWindow("2026-09-01", "2026-11-03")).toEqual({
      since: "2026-09-01T00:00:00.000Z",
      until: "2026-11-03T23:59:59.999Z",
    });
  });

  it("defaults until to now and keeps full timestamps", () => {
    expect(parseWindow("2026-11-03T18:00:00Z", null, new Date("2026-11-04T01:02:03.000Z"))).toEqual({
      since: "2026-11-03T18:00:00.000Z",
      until: "2026-11-04T01:02:03.000Z",
    });
  });

  it("refuses what is not a date, and a window that ends before it starts", () => {
    expect(() => parseWindow("summer")).toThrow(/not a date/);
    expect(() => parseWindow("2026-11-04", "2026-11-01")).toThrow(/after until/);
  });
});

describe("diffLines", () => {
  it("counts added and removed lines and shows them as hunks", () => {
    const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d).toEqual({ added: 2, removed: 1, hunks: ["-b\n+B", "+e"] });
  });

  it("finds the first hunks of a large text without tabling the whole of it", () => {
    const before = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 20_000 }, (_, i) => (i % 500 === 250 ? `changed ${i}` : `line ${i}`)).join("\n");
    const started = performance.now();
    const d = diffLines(before, after);
    expect(performance.now() - started).toBeLessThan(250);
    expect(d.hunks.slice(0, 2)).toEqual(["-line 250\n+changed 250", "-line 750\n+changed 750"]);
    expect(d.hunks).toHaveLength(6);
    expect(d).toMatchObject({ added: 40, removed: 40 });
  });

  it("keeps hunks in order across windows, and shows a wholly replaced stretch", () => {
    const before = Array.from({ length: 1500 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 1500 }, (_, i) => (i >= 700 && i < 1300 ? `b${i}` : `a${i}`)).join("\n");
    const d = diffLines(before, after);
    expect(d.hunks.length).toBeGreaterThan(0);
    expect(d.hunks[0].startsWith("-a700")).toBe(true);
    expect(d).toMatchObject({ added: 600, removed: 600 });
  });

  it("caps hunks at six of at most 400 characters", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 20 }, (_, i) => (i % 2 ? `changed ${i} ${"x".repeat(500)}` : `line ${i}`)).join("\n");
    const d = diffLines(before, after);
    expect(d.hunks).toHaveLength(6);
    for (const h of d.hunks) expect(h.length).toBeLessThanOrEqual(400);
  });
});

describe("buildChanges on the 2026-11-03 sync (Data Processing and CQRS)", () => {
  const digest = buildChanges(fixture.rows, fixture.baseline, fixtureContext(), fixture.window, { scope: { moc: fixture.moc.id }, limit: 200 });

  // Re-derived from the rows directly, not through buildChanges.
  const notes = (rows: OperationRow[]) => rows.filter((r) => r.documentType !== "bai/source");
  const createdIds = new Set(notes(fixture.rows).filter((r) => r.operationType === "CREATE_DOCUMENT").map((r) => r.documentId));
  const lastValue = (rows: OperationRow[], id: string, op: string, key: string): string | null => {
    const hit = rows.filter((r) => r.documentId === id && r.operationType === op).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index).at(-1);
    return hit ? ((JSON.parse(hit.inputJson ?? "{}") as Record<string, string>)[key] ?? null) : null;
  };
  // A MoC's description is set by UPDATE_DESCRIPTION; it is a claim field too.
  const claimFields: [string, string][] = [
    ["SET_TITLE", "title"],
    ["SET_DESCRIPTION", "description"],
    ["UPDATE_DESCRIPTION", "description"],
    ["SET_CONTENT", "content"],
    ["UPDATE_CLAIM_CONTENT", "content"],
  ];
  const revisedIds = new Set(
    notes(fixture.rows)
      .filter((r) => !createdIds.has(r.documentId))
      .map((r) => r.documentId)
      .filter((id) =>
        claimFields.some(([op, key]) => {
          const after = lastValue(fixture.rows, id, op, key);
          return after !== null && after !== lastValue(fixture.baseline, id, op, key);
        }),
      ),
  );

  it("leads with the map the question named", () => {
    expect(digest.groups[0].title).toBe("Data Processing and CQRS");
  });

  it("re-derives from a window with no content patches (patches are covered on hand-built rows)", () => {
    // The re-derivation above compares last values and does not replay
    // PATCH_CONTENT; it is complete only while the fixture holds none.
    expect([...fixture.rows, ...fixture.baseline].some((r) => r.operationType === "PATCH_CONTENT")).toBe(false);
  });

  it("counts revised and created notes as the rows say", () => {
    expect(createdIds.size).toBeGreaterThan(0);
    expect(revisedIds.size).toBeGreaterThan(0);
    expect(digest.totals.created).toBe(createdIds.size);
    expect(digest.totals.revised).toBe(revisedIds.size);
  });

  it("attaches the revision-history lines a revision added", () => {
    const revised = (digest.events ?? []).filter((e) => e.kind === "revised");
    let withNotes = 0;
    for (const e of revised) {
      const after = lastValue(fixture.rows, e.documentId, "SET_CONTENT", "content");
      const before = lastValue(fixture.baseline, e.documentId, "SET_CONTENT", "content") ?? "";
      if (!after?.includes("## Revision history")) continue;
      const added = after
        .slice(after.indexOf("## Revision history"))
        .split("\n")
        .filter((l) => l.startsWith("- ") && !before.includes(l));
      if (added.length === 0) continue;
      withNotes++;
      expect(e.revisionNotes?.length).toBe(added.length);
    }
    expect(withNotes).toBeGreaterThan(0);
  });

  it("reports source revisions with the refs they moved between", () => {
    const revisions = (digest.events ?? []).filter((e) => e.kind === "source-revised");
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.some((e) => e.source?.refBefore === "v6.2.2-dev.74" && e.source.refAfter === "v6.2.3-dev.91+e0f277d")).toBe(true);
  });

  it("names the replacement and the reason of a superseded note", () => {
    // Re-derived from the SUPERSEDES rows: the replacing note is the edge's
    // source; the reason is the edge's current one, else the row's.
    const expected = new Map<string, { documentId: string; reason: string | null }>();
    for (const r of fixture.rows) {
      if (r.operationType !== "ADD_RELATIONSHIP") continue;
      const input = JSON.parse(r.inputJson ?? "{}") as { sourceId?: string; targetId?: string; relationshipType?: string; metadata?: { reason?: string } };
      if (input.relationshipType !== "SUPERSEDES" || !input.sourceId || !input.targetId) continue;
      const edge = fixture.context.edges.find((e) => e.type === "SUPERSEDES" && e.source === input.sourceId && e.target === input.targetId);
      expected.set(input.targetId, { documentId: input.sourceId, reason: edge?.reason ?? input.metadata?.reason ?? null });
    }
    const sup = (digest.events ?? []).filter((e) => e.kind === "superseded");
    expect(sup.length).toBeGreaterThan(0);
    for (const e of sup) {
      const want = expected.get(e.documentId);
      expect(want).toBeDefined();
      expect(e.supersededBy?.documentId).toBe(want?.documentId);
      expect(e.supersededBy?.reason).toBe(want?.reason);
    }
    // One, pinned: the duplicate retired at verify on 2026-11-03.
    expect(sup.find((e) => e.documentId === "w7dOjx0xIZyj0dRo_eY0M7G_aGag0egNIUsR1A46czQ")?.supersededBy).toMatchObject({
      documentId: "cba7b65a-7071-4790-b61f-055cde3b4cae",
      reason: expect.stringMatching(/^Retires a duplicate at verify: both say processors derive read models by folding operations/) as unknown,
    });
  });
});

describe("buildChanges: review focus", () => {
  it("reports one revision against the pre-window value, however many edits the window holds", () => {
    const baseline = [row("n1", "SET_CONTENT", { content: "original claim" }, "2026-10-01T00:00:00.000Z")];
    const rows = [
      row("n1", "SET_CONTENT", { content: "first edit" }, "2026-11-03T01:00:00.000Z"),
      row("n1", "SET_CONTENT", { content: "second edit" }, "2026-11-03T02:00:00.000Z"),
      row("n1", "SET_CONTENT", { content: "final claim" }, "2026-11-03T03:00:00.000Z"),
    ];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["n1"] } });
    expect(d.events).toHaveLength(1);
    expect(d.events?.[0]).toMatchObject({ kind: "revised", fields: { content: { before: "original claim", added: 1, removed: 1 } } });
    expect(d.events?.[0].fields?.content?.hunks).toEqual(["-original claim\n+final claim"]);
    expect(d.totals).toMatchObject({ revised: 1, documents: 1, operations: 3 });
  });

  it("says 'not set before' (null) for a note with no baseline row, without failing", () => {
    const rows = [row("n2", "SET_TITLE", { title: "A title" }, "2026-11-03T01:00:00.000Z")];
    const d = buildChanges(rows, [], ctx(), W, { scope: { documentIds: ["n2"] } });
    expect(d.events?.[0].fields?.title).toEqual({ before: null, after: "A title" });
  });

  it("reports a source re-ingested with identical text as revised with no lines changed, after other source events", () => {
    const S = "bai/source";
    const baseline = [
      row("s1", "INGEST_SOURCE", { title: "Same", content: "x\ny", method: "sha256:1 git:v6.2.2-dev.74" }, "2026-08-01T00:00:00.000Z", S),
      row("s2", "INGEST_SOURCE", { title: "Changed", content: "x\ny", method: "sha256:2 git:v6.2.2-dev.74" }, "2026-08-01T00:00:00.000Z", S),
    ];
    const rows = [
      row("s1", "INGEST_SOURCE", { title: "Same", content: "x\ny", method: "sha256:1 git:v6.2.3-dev.91+e0f277d" }, "2026-11-03T05:00:00.000Z", S),
      row("s2", "INGEST_SOURCE", { title: "Changed", content: "x\nz", method: "sha256:3 git:v6.2.3-dev.91+e0f277d" }, "2026-11-03T01:00:00.000Z", S),
      row("s3", "INGEST_SOURCE", { title: "New", content: "q" }, "2026-11-03T02:00:00.000Z", S),
      row("s4", "SET_SOURCE_STATUS", { status: "ARCHIVED" }, "2026-11-03T03:00:00.000Z", S),
    ];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { types: [S], documentIds: ["s1", "s2", "s3", "s4"] } });
    const events = d.events ?? [];
    expect(events.at(-1)).toMatchObject({
      kind: "source-revised",
      documentId: "s1",
      source: { refBefore: "v6.2.2-dev.74", refAfter: "v6.2.3-dev.91+e0f277d", added: 0, removed: 0 },
    });
    expect(events.map((e) => e.kind)).toEqual(["source-revised", "source-added", "source-archived", "source-revised"]);
    expect(d.totals).toMatchObject({ sourcesRevised: 2, sourcesAdded: 1, archived: 1 });
  });

  it("returns zero totals and no groups for an empty window or a scope matching nothing", () => {
    const empty = buildChanges([], [], ctx(), W, { scope: {} });
    expect(empty.totals).toEqual({ created: 0, revised: 0, superseded: 0, archived: 0, reverified: 0, sourcesRevised: 0, sourcesAdded: 0, documents: 0, operations: 0 });
    expect(empty.groups).toEqual([]);
    expect(empty.events).toBeUndefined();

    const rows = [row("n1", "SET_TITLE", { title: "x" }, "2026-11-03T01:00:00.000Z")];
    const none = buildChanges(rows, [], ctx(), W, { scope: { documentIds: ["nobody"] } });
    expect(none.totals.documents).toBe(0);
    expect(none.groups).toEqual([]);
    expect(none.events).toEqual([]);
    expect(none.nextCursor).toBeNull();
  });
});

describe("buildChanges: events and groups", () => {
  it("reports a created note as created only, with what it derives from", () => {
    const rows = [
      row("n1", "CREATE_DOCUMENT", {}, "2026-11-03T01:00:00.000Z"),
      row("n1", "SET_TITLE", { title: "New claim" }, "2026-11-03T01:00:01.000Z"),
      row("n1", "SET_CONTENT", { content: "body" }, "2026-11-03T01:00:02.000Z"),
      row("n1", "APPROVE_NOTE", { actor: "alice" }, "2026-11-03T01:00:03.000Z"),
      row("n1", "ADD_TOPIC", { name: "x" }, "2026-11-03T01:00:04.000Z"),
    ];
    const d = buildChanges(rows, [], ctx({ derivedFrom: new Map([["n1", ["s1"]]]) }), W, { scope: { documentIds: ["n1"] } });
    expect(d.events?.map((e) => e.kind)).toEqual(["created"]);
    expect(d.events?.[0]).toMatchObject({ title: "New claim", derivedFrom: ["s1"], at: "2026-11-03T01:00:00.000Z" });
  });

  it("reports a version stamp without a claim change as reverified, and folds the rest", () => {
    const baseline = [row("n1", "SET_METADATA_FIELD", { field: "version", value: "v1" }, "2026-10-01T00:00:00.000Z")];
    const rows = [
      row("n1", "SET_METADATA_FIELD", { field: "version", value: "v2" }, "2026-11-03T01:00:00.000Z"),
      row("n1", "SET_METADATA_FIELD", { field: "filePath", value: "a.md" }, "2026-11-03T01:00:01.000Z"),
      row("n1", "ADD_TOPIC", { name: "t" }, "2026-11-03T01:00:02.000Z"),
    ];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["n1"] } });
    expect(d.events).toEqual([
      expect.objectContaining({ kind: "reverified", version: { before: "v1", after: "v2" }, folded: { SET_METADATA_FIELD: 1, ADD_TOPIC: 1 } }),
    ]);
  });

  it("applies content patches on top of the baseline", () => {
    const baseline = [row("n1", "SET_CONTENT", { content: "hello world" }, "2026-10-01T00:00:00.000Z")];
    const rows = [row("n1", "PATCH_CONTENT", { offset: 6, removeCount: 5, insert: "vault" }, "2026-11-03T01:00:00.000Z")];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["n1"] } });
    expect(d.events?.[0].fields?.content?.hunks).toEqual(["-hello world\n+hello vault"]);
  });

  it("reports supersession, archive, restore and approval, most significant first", () => {
    const rows = [
      row("n2", "ADD_RELATIONSHIP", { sourceId: "n2", targetId: "n1", relationshipType: "SUPERSEDES", metadata: { reason: "row reason" } }, "2026-11-03T01:00:00.000Z"),
      row("n1", "ARCHIVE_NOTE", { comment: "replaced" }, "2026-11-03T02:00:00.000Z"),
      row("n3", "ARCHIVE_NOTE", {}, "2026-11-03T02:00:00.000Z"),
      row("n3", "RESTORE_NOTE", {}, "2026-11-03T03:00:00.000Z"),
      row("n4", "APPROVE_NOTE", { actor: "alice", comment: "ok" }, "2026-11-03T03:00:00.000Z"),
    ];
    const c = ctx({
      nodes: new Map([["n2", { title: "Replacement", documentType: "bai/knowledge-note", status: null, topics: [] }]]),
      edgeReason: (s, t, type) => (s === "n2" && t === "n1" && type === "SUPERSEDES" ? "edge reason" : null),
    });
    const d = buildChanges(rows, [], c, W, { scope: { documentIds: ["n1", "n2", "n3", "n4"] } });
    expect(d.events?.map((e) => [e.documentId, e.kind])).toEqual([
      ["n1", "superseded"],
      ["n1", "archived"],
      ["n3", "restored"],
      ["n4", "approved"],
    ]);
    expect(d.events?.[0].supersededBy).toEqual({ documentId: "n2", title: "Replacement", reason: "edge reason" });
    expect(d.events?.[1].comment).toBe("replaced");
    expect(d.events?.[3]).toMatchObject({ by: "alice", comment: "ok" });
  });

  it("falls back to the row's reason, and reports a deleted source", () => {
    const rows = [
      row("n2", "ADD_RELATIONSHIP", { sourceId: "n2", targetId: "n1", relationshipType: "SUPERSEDES", metadata: { reason: "row reason" } }, "2026-11-03T01:00:00.000Z"),
      row("s9", "DELETE_DOCUMENT", {}, "2026-11-03T01:00:00.000Z", "bai/source"),
    ];
    const d = buildChanges(rows, [], ctx(), W, { scope: { documentIds: ["n1", "s9"] } });
    expect(d.events?.find((e) => e.kind === "superseded")?.supersededBy?.reason).toBe("row reason");
    expect(d.events?.find((e) => e.documentId === "s9")?.kind).toBe("source-deleted");
  });

  it("groups a note under its most specific map, else its first topic, and a source with its notes", () => {
    const rows = [
      row("n1", "SET_TITLE", { title: "a" }, "2026-11-03T01:00:00.000Z"),
      row("n2", "SET_TITLE", { title: "b" }, "2026-11-03T01:00:00.000Z"),
      row("n3", "SET_TITLE", { title: "c" }, "2026-11-03T01:00:00.000Z"),
      row("s1", "INGEST_SOURCE", { title: "S", content: "x" }, "2026-11-03T01:00:00.000Z", "bai/source"),
      row("s2", "INGEST_SOURCE", { title: "S2", content: "x" }, "2026-11-03T01:00:00.000Z", "bai/source"),
    ];
    const c = ctx({
      nodes: new Map([
        ["n2", { title: "b", documentType: "bai/knowledge-note", status: null, topics: ["caching", "other"] }],
      ]),
      sources: new Map([
        ["s1", { title: "S", folder: null, claimIds: ["n1", "n2", "n1x"] }],
        ["s2", { title: "S2", folder: "/sources/docs", claimIds: [] }],
      ]),
      mocsByNote: new Map([
        ["n1", [{ id: "hub", title: "Hub", tier: "HUB" as const }, { id: "topic", title: "Processors", tier: "TOPIC" as const }]],
        ["n1x", [{ id: "topic", title: "Processors", tier: "TOPIC" as const }]],
      ]),
    });
    const d = buildChanges(rows, [], c, W, { scope: {} });
    const byKey = Object.fromEntries(d.groups.map((g) => [g.key, g.highlights.map((e) => e.documentId).sort()]));
    expect(byKey).toEqual({
      "moc:topic": ["n1", "s1"],
      "topic:caching": ["n2"],
      "folder:/sources/docs": ["s2"],
      unplaced: ["n3"],
    });
    expect(d.groups.at(-1)?.kind).toBe("unplaced");
    expect(d.events).toBeUndefined();
  });

  it("narrows to a map's notes and their sources, or a topic", () => {
    const rows = [
      row("n1", "SET_TITLE", { title: "a" }, "2026-11-03T01:00:00.000Z"),
      row("n2", "SET_TITLE", { title: "b" }, "2026-11-03T01:00:00.000Z"),
      row("s1", "INGEST_SOURCE", { title: "S", content: "x" }, "2026-11-03T01:00:00.000Z", "bai/source"),
    ];
    const c = ctx({
      nodes: new Map([["n2", { title: "b", documentType: "bai/knowledge-note", status: null, topics: ["caching"] }]]),
      sources: new Map([["s1", { title: "S", folder: null, claimIds: ["n1"] }]]),
      mocsByNote: new Map([["n1", [{ id: "m", title: "M", tier: "TOPIC" as const }]]]),
    });
    expect(buildChanges(rows, [], c, W, { scope: { moc: "m" } }).events?.map((e) => e.documentId).sort()).toEqual(["n1", "s1"]);
    expect(buildChanges(rows, [], c, W, { scope: { topic: "caching" } }).events?.map((e) => e.documentId)).toEqual(["n2"]);
  });

  it("pages events with an opaque cursor, without overlap", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id, i) => row(id, "SET_TITLE", { title: id }, `2026-11-03T0${i}:00:00.000Z`));
    const scope = { documentIds: ["a", "b", "c", "d", "e"] };
    const first = buildChanges(rows, [], ctx(), W, { scope, limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = buildChanges(rows, [], ctx(), W, { scope, limit: 2, cursor: first.nextCursor });
    expect(second.events).toHaveLength(2);
    const third = buildChanges(rows, [], ctx(), W, { scope, limit: 2, cursor: second.nextCursor });
    expect(third.events).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    const ids = [...(first.events ?? []), ...(second.events ?? []), ...(third.events ?? [])].map((e) => e.documentId);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(["e", "d", "c", "b", "a"]);
  });
});

describe("buildChanges: review fixes", () => {
  const S = "bai/source";

  it("ships at most 400 characters of a revised body's earlier text", () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i} of the original claim`).join("\n");
    const baseline = [row("n1", "SET_CONTENT", { content: long }, "2026-10-01T00:00:00.000Z")];
    const rows = [row("n1", "SET_CONTENT", { content: `${long}\nnew line` }, "2026-11-03T01:00:00.000Z")];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["n1"] } });
    const content = d.events?.[0].fields?.content;
    expect(content?.before?.length).toBeLessThanOrEqual(400);
    expect(content?.before?.startsWith("line 0 of the original claim")).toBe(true);
    expect(content).toMatchObject({ added: 1, removed: 0, hunks: ["+new line"] });
  });

  it("names at most 20 of a revised source's notes, and says how many there are", () => {
    const claimIds = Array.from({ length: 45 }, (_, i) => `n${i}`);
    const baseline = [row("s1", "INGEST_SOURCE", { title: "Big", content: "a" }, "2026-08-01T00:00:00.000Z", S)];
    const rows = [row("s1", "INGEST_SOURCE", { title: "Big", content: "b" }, "2026-11-03T01:00:00.000Z", S)];
    const d = buildChanges(rows, baseline, ctx({ sources: new Map([["s1", { title: "Big", folder: null, claimIds }]]) }), W, { scope: { documentIds: ["s1"] } });
    expect(d.events?.[0].source?.noteIds).toEqual(claimIds.slice(0, 20));
    expect(d.events?.[0].source?.noteCount).toBe(45);
  });

  it("does not claim '0 lines changed' for a source whose earlier version was never recorded", () => {
    const rows = [row("s1", "INGEST_SOURCE", { title: "Guide", content: "b", method: "sha256:2 git:v6.2.3-dev.91+e0f277d" }, "2026-11-03T01:00:00.000Z", S)];
    const c = ctx({ sources: new Map([["s1", { title: "Guide", folder: null, claimIds: [], addedAt: "2026-08-01T00:00:00.000Z" }]]) });
    const d = buildChanges(rows, [], c, W, { scope: { documentIds: ["s1"] } });
    expect(d.events?.[0]).toMatchObject({ kind: "source-revised", significance: 3, source: { refBefore: null, added: null, removed: null, hunks: [] } });
  });

  it("starts a created map's, claim's, tension's or observation's baseline at its CREATE_* input", () => {
    const baseline = [
      row("m1", "CREATE_MOC", { title: "Processors", description: "old map description", orientation: "", tier: "TOPIC" }, "2026-08-01T00:00:00.000Z", "bai/moc"),
      row("c1", "CREATE_CLAIM", { title: "Claim", description: "d", content: "old claim body" }, "2026-08-01T00:00:00.000Z", "bai/research-claim"),
    ];
    const rows = [
      row("m1", "UPDATE_DESCRIPTION", { description: "new map description" }, "2026-11-03T01:00:00.000Z", "bai/moc"),
      row("c1", "UPDATE_CLAIM_CONTENT", { content: "new claim body" }, "2026-11-03T01:00:00.000Z", "bai/research-claim"),
    ];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["m1", "c1"] } });
    expect(d.events?.find((e) => e.documentId === "m1")?.fields?.description).toEqual({ before: "old map description", after: "new map description" });
    expect(d.events?.find((e) => e.documentId === "c1")?.fields?.content?.before).toBe("old claim body");
  });

  it("drops a supersession removed later in the same window", () => {
    const rows = [
      row("n2", "ADD_RELATIONSHIP", { sourceId: "n2", targetId: "n1", relationshipType: "SUPERSEDES" }, "2026-11-03T01:00:00.000Z"),
      row("n2", "REMOVE_RELATIONSHIP", { sourceId: "n2", targetId: "n1", relationshipType: "SUPERSEDES" }, "2026-11-03T02:00:00.000Z"),
      row("n4", "ADD_RELATIONSHIP", { sourceId: "n4", targetId: "n3", relationshipType: "SUPERSEDES" }, "2026-11-03T01:00:00.000Z"),
      row("n4", "REMOVE_RELATIONSHIP", { sourceId: "n4", targetId: "n3", relationshipType: "SUPERSEDES" }, "2026-11-03T02:00:00.000Z"),
      row("n4", "ADD_RELATIONSHIP", { sourceId: "n4", targetId: "n3", relationshipType: "SUPERSEDES" }, "2026-11-03T03:00:00.000Z"),
    ];
    const d = buildChanges(rows, [], ctx(), W, { scope: { documentIds: ["n1", "n3"] } });
    expect(d.events?.map((e) => [e.documentId, e.kind])).toEqual([["n3", "superseded"]]);
  });

  it("groups a map's own revision under the map", () => {
    const rows = [row("m1", "UPDATE_DESCRIPTION", { description: "x" }, "2026-11-03T01:00:00.000Z", "bai/moc")];
    const c = ctx({
      nodes: new Map([["m1", { title: "Processors", documentType: "bai/moc", status: "MOC", topics: ["infra"] }]]),
      mocsByNote: new Map([["m1", [{ id: "hub", title: "Hub", tier: "HUB" as const }]]]),
    });
    const d = buildChanges(rows, [], c, W, { scope: {} });
    expect(d.groups.map((g) => g.key)).toEqual(["moc:m1"]);
    expect(d.groups[0].title).toBe("Processors");
  });

  it("ignores rows whose timestamp is not an ISO date (an epoch stamp is not 'before' the window)", () => {
    const baseline = [row("n1", "SET_TITLE", { title: "Epoch title" }, "1762128000000")];
    const rows = [row("n1", "SET_TITLE", { title: "New" }, "2026-11-03T01:00:00.000Z")];
    const d = buildChanges(rows, baseline, ctx(), W, { scope: { documentIds: ["n1"] } });
    expect(d.events?.[0].fields?.title).toEqual({ before: null, after: "New" });
  });

  it("keeps the window's end in the cursor, and refuses a cursor it cannot read", () => {
    const rows = ["a", "b", "c"].map((id, i) => row(id, "SET_TITLE", { title: id }, `2026-11-03T0${i}:00:00.000Z`));
    const scope = { documentIds: ["a", "b", "c"] };
    const first = buildChanges(rows, [], ctx(), W, { scope, limit: 1 });
    expect(cursorUntil(first.nextCursor as string)).toBe(W.until);
    expect(() => cursorUntil("not a cursor")).toThrow(ChangeInputError);
    expect(() => buildChanges(rows, [], ctx(), W, { scope, limit: 1, cursor: "bm9wZQ==" })).toThrow(ChangeInputError);
  });
});

describe("parseWindow: offsets", () => {
  it("reads a timestamp without an offset as UTC, and keeps an explicit offset", () => {
    expect(parseWindow("2026-11-03T18:00:00", "2026-11-03T20:00:00.5")).toEqual({
      since: "2026-11-03T18:00:00.000Z",
      until: "2026-11-03T20:00:00.500Z",
    });
    expect(parseWindow("2026-11-03T18:00:00+02:00", "2026-11-04").since).toBe("2026-11-03T16:00:00.000Z");
  });

  it("refuses a malformed date as a ChangeInputError", () => {
    expect(() => parseWindow("summer")).toThrow(ChangeInputError);
  });
});
