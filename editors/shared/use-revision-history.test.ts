import { describe, expect, it } from "vitest";
import { actions } from "document-models/source";
import type { DocumentOperation } from "./document-revisions.js";
import { SOURCE_REVISION_MODEL as M } from "../source-editor/lib/revision-model.js";
import { buildRevisionDiff, fieldChanges } from "./use-revision-history.js";

const T = "2026-09-02T10:00:00.000Z";

let counter = 0;
function op(index: number, action: { type: string; input: unknown }): DocumentOperation {
  counter++;
  return {
    index,
    skip: 0,
    timestampUtcMs: T,
    hash: `h${index}`,
    error: null,
    action: {
      id: `a${counter}`,
      type: action.type,
      scope: "global",
      timestampUtcMs: T,
      input: action.input as Record<string, unknown>,
      context: null,
    },
  };
}

const ingest = (content: string, title = "Notes") =>
  actions.ingestSource({ title, content, sourceType: "ARTICLE", createdAt: T });

// A small log in the shape of the real one: a text edit surrounded by
// bookkeeping operations that never touch the text.
const log: DocumentOperation[] = [
  op(0, ingest("one\ntwo")),
  op(1, actions.setSourceStatus({ status: "EXTRACTING" })),
  op(2, actions.addExtractedClaim({ claimRef: "c1" })),
  op(3, ingest("one\ntwo revised\nthree")),
  op(4, actions.setSourceStatus({ status: "EXTRACTED" })),
];
const at = (i: number) => M.replay(log, i).snapshot;

describe("buildRevisionDiff — what one operation changed", () => {
  it("attributes a text edit to the operation that made it", () => {
    const d = buildRevisionDiff(M, at(2), at(3), "previous");
    expect(d.summary).toEqual({ added: 2, removed: 1, changed: true });
    expect(d.rows.map((r) => r.kind)).toEqual(["same", "changed", "added"]);
    // Re-ingesting resets the status: a field change alongside the text.
    expect(d.fields.map((f) => `${f.label}: ${f.before} → ${f.after}`)).toEqual([
      "Status: EXTRACTING → INBOX",
    ]);
    expect(d.anyChange).toBe(true);
  });

  it("reports a bookkeeping operation honestly: no text, one field", () => {
    const d = buildRevisionDiff(M, at(1), at(2), "previous");
    expect(d.summary.changed).toBe(false);
    expect(d.fields).toHaveLength(1);
    expect(d.fields[0]).toMatchObject({ label: "Claims linked", before: "0", after: "1" });
    expect(d.fields[0].tokens).not.toBeNull();
    expect(d.anyChange).toBe(true);
  });

  it("shows revision 1 as everything added, from the empty document", () => {
    const empty = M.replay(log, -1).snapshot;
    const d = buildRevisionDiff(M, empty, at(0), "previous", true);
    expect(d.fromEmpty).toBe(true);
    expect(d.rows.every((r) => r.kind === "added")).toBe(true);
    // Status is absent on purpose: an empty source already defaults to INBOX,
    // so the ingest setting INBOX is not a change — and the diff must not
    // invent one.
    expect(d.fields.map((f) => f.label)).toEqual(["Title", "Type"]);
    expect(d.fields.every((f) => f.before === null)).toBe(true);
  });

  it("says so when an operation changed nothing visible", () => {
    // Re-linking a claim already listed is an idempotent no-op.
    const noop = [...log, op(5, actions.addExtractedClaim({ claimRef: "c1" }))];
    const d = buildRevisionDiff(
      M,
      M.replay(noop, 4).snapshot,
      M.replay(noop, 5).snapshot,
      "previous",
    );
    expect(d.anyChange).toBe(false);
    expect(d.rows.every((r) => r.kind === "same" || r.kind === "gap")).toBe(true);
  });

  it("still answers the cumulative question when asked", () => {
    const d = buildRevisionDiff(M, at(0), at(4), "current");
    expect(d.base).toBe("current");
    expect(d.summary.changed).toBe(true);
    expect(d.fields.map((f) => f.label)).toEqual(["Status", "Claims linked"]);
  });
});

describe("fieldChanges", () => {
  it("keeps only what differs, in declared order, with word alignment", () => {
    const out = fieldChanges(
      [
        { label: "Status", value: "INBOX" },
        { label: "Topics", value: "#a #b" },
        { label: "Author", value: "x" },
      ],
      [
        { label: "Status", value: "INBOX" },
        { label: "Topics", value: "#a #b #c" },
        { label: "Author", value: "x" },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Topics");
    expect(out[0].tokens?.filter((t) => t.kind === "added").map((t) => t.text)).toEqual([" #c"]);
  });

  it("treats an empty string and null as the same 'unset'", () => {
    expect(fieldChanges([{ label: "A", value: null }], [{ label: "A", value: null }])).toEqual([]);
  });

  it("reports a field the newer side gained and the older never had", () => {
    const out = fieldChanges([], [{ label: "Skip rate", value: "12.0%" }]);
    expect(out).toEqual([
      { label: "Skip rate", before: null, after: "12.0%", tokens: null },
    ]);
  });

  it("skips word alignment for values too long to read inline", () => {
    const long = "w ".repeat(400);
    const out = fieldChanges([{ label: "D", value: long }], [{ label: "D", value: `${long}x` }]);
    expect(out[0].tokens).toBeNull();
  });
});
