import { describe, expect, it } from "vitest";
import { actions } from "document-models/knowledge-note";
import {
  describeOperation,
  effectiveOperations,
  lastSignature,
  operationKind,
  replayToRevision,
  type NoteOperation,
} from "./revisions.js";

const T = "2026-09-02T10:00:00.000Z";

let counter = 0;
function op(
  index: number,
  action: { type: string; input: unknown; scope?: string },
  extra: Partial<NoteOperation> = {},
): NoteOperation {
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
      scope: action.scope ?? "global",
      timestampUtcMs: T,
      input: action.input as Record<string, unknown>,
      context: null,
    },
    ...extra,
  };
}

const history: NoteOperation[] = [
  op(0, actions.setTitle({ title: "First title", updatedAt: T })),
  op(1, actions.setDescription({ description: "A description", updatedAt: T })),
  op(2, actions.setContent({ content: "line one\nline two", updatedAt: T })),
  op(3, actions.setTitle({ title: "Second title", updatedAt: T })),
  op(4, actions.setContent({ content: "line one\nline 2\nline three", updatedAt: T })),
];

describe("replayToRevision", () => {
  it("reconstructs the note as it stood at each revision", () => {
    expect(replayToRevision(history, 0).document.state.global.title).toBe("First title");
    const r2 = replayToRevision(history, 2).document.state.global;
    expect(r2.title).toBe("First title");
    expect(r2.description).toBe("A description");
    expect(r2.content).toBe("line one\nline two");
    const r4 = replayToRevision(history, 4).document.state.global;
    expect(r4.title).toBe("Second title");
    expect(r4.content).toBe("line one\nline 2\nline three");
  });

  it("is order-insensitive in its input", () => {
    const shuffled = [history[3], history[0], history[4], history[1], history[2]];
    expect(replayToRevision(shuffled, 4).document.state.global.title).toBe("Second title");
  });

  it("skips operations the reactor recorded as errored and reports them", () => {
    const withError = [
      ...history,
      op(5, actions.setTitle({ title: "never applied", updatedAt: T }), { error: "boom" }),
    ];
    const r = replayToRevision(withError, 5);
    expect(r.document.state.global.title).toBe("Second title");
    expect(r.failures).toEqual([{ index: 5, type: "SET_TITLE", reason: "boom" }]);
  });

  it("records a reducer refusal instead of throwing", () => {
    const tooLong = "x".repeat(201);
    const r = replayToRevision(
      [...history, op(5, actions.setDescription({ description: tooLong, updatedAt: T }))],
      5,
    );
    expect(r.document.state.global.description).toBe("A description");
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].index).toBe(5);
  });

  it("folds skip (undo) into the effective list", () => {
    const undone = [
      ...history,
      // index 5 with skip 1: undo index 4 (the second content edit)
      op(5, actions.setTitle({ title: "Third title", updatedAt: T }), { skip: 1 }),
    ];
    const effective = effectiveOperations(undone).map((o) => o.index);
    expect(effective).not.toContain(4);
    const r = replayToRevision(undone, 5).document.state.global;
    expect(r.title).toBe("Third title");
    expect(r.content).toBe("line one\nline two");
  });
});

describe("presentation helpers", () => {
  it("describes operations in one line", () => {
    expect(describeOperation(history[0])).toBe("Title → “First title”");
    expect(describeOperation(history[2])).toBe("Content updated (17 chars)");
    expect(describeOperation(op(9, { type: "SOME_NEW_OP", input: {} }))).toBe("Some new op");
  });
  it("classifies operation kinds", () => {
    expect(operationKind("SET_CONTENT")).toBe("content");
    expect(operationKind("SET_TITLE")).toBe("content");
    // A type is a classification, not text — the steppers must skip it.
    expect(operationKind("SET_NOTE_TYPE")).toBe("metadata");
    expect(operationKind("APPROVE_NOTE")).toBe("lifecycle");
    expect(operationKind("ADD_TOPIC")).toBe("topics");
    expect(operationKind("SET_METADATA_FIELD")).toBe("metadata");
    expect(operationKind("ADD_LINK")).toBe("links");
    expect(operationKind("WHATEVER")).toBe("other");
  });
  it("returns the last signature or null", () => {
    expect(lastSignature(history[0])).toBeNull();
    const signed = op(0, actions.setTitle({ title: "t", updatedAt: T }));
    signed.action.context = {
      signer: { user: null, app: { name: "switchboard", key: "did:key:z1" }, signatures: ["a, b, c, d, e", "f, g, h, i, j"] },
    };
    expect(lastSignature(signed)).toBe("f, g, h, i, j");
  });
});
