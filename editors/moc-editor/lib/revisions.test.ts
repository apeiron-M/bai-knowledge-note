import { describe, expect, it } from "vitest";
import { actions } from "document-models/moc";
import { effectiveOperations } from "../../shared/document-revisions.js";
import type { DocumentOperation } from "../../shared/document-revisions.js";
import { describeOperation, operationKind, replayToRevision } from "./revisions.js";

const T = "2026-09-02T10:00:00.000Z";

let counter = 0;
function op(
  index: number,
  action: { type: string; input: unknown; scope?: string },
  extra: Partial<DocumentOperation> = {},
): DocumentOperation {
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

const history: DocumentOperation[] = [
  op(
    0,
    actions.createMoc({
      title: "Reactor internals",
      description: "How the reactor stores and syncs operations",
      orientation: "First framing.\nStill thin.",
      tier: "TOPIC",
      createdAt: T,
    }),
  ),
  op(
    1,
    actions.addCoreIdea({
      id: "idea-1",
      noteRef: "note-aaaa-bbbb-cccc",
      contextPhrase: "the operation store is append-only",
      sortOrder: 0,
      addedAt: T,
    }),
  ),
  op(
    2,
    actions.updateOrientation({
      orientation: "Second framing.\nMuch fuller now.",
      updatedAt: T,
    }),
  ),
  op(
    3,
    actions.addTension({
      id: "tension-1",
      description: "Two notes disagree on skip semantics",
      involvedRefs: ["note-aaaa-bbbb-cccc"],
      addedAt: T,
    }),
  ),
  op(4, actions.addOpenQuestion({ question: "Where does GC run?" })),
];

describe("replayToRevision", () => {
  it("reconstructs the MoC as it stood at each revision", () => {
    const r0 = replayToRevision(history, 0).document.state.global;
    expect(r0.title).toBe("Reactor internals");
    expect(r0.tier).toBe("TOPIC");
    expect(r0.orientation).toBe("First framing.\nStill thin.");

    const r2 = replayToRevision(history, 2).document.state.global;
    expect(r2.orientation).toBe("Second framing.\nMuch fuller now.");
    expect(r2.coreIdeas).toHaveLength(1);
    expect(r2.tensions).toEqual([]);

    const r4 = replayToRevision(history, 4).document.state.global;
    expect(r4.tensions).toHaveLength(1);
    expect(r4.openQuestions).toEqual(["Where does GC run?"]);
  });

  it("recovers a superseded orientation — the framing the vault once had", () => {
    // UPDATE_ORIENTATION overwrites; only the log remembers the old synthesis.
    expect(replayToRevision(history, 1).document.state.global.orientation).toBe(
      "First framing.\nStill thin.",
    );
  });

  it("is order-insensitive in its input", () => {
    const shuffled = [history[3], history[0], history[4], history[2], history[1]];
    expect(replayToRevision(shuffled, 4).document.state.global.orientation).toBe(
      "Second framing.\nMuch fuller now.",
    );
  });

  it("skips operations the reactor recorded as errored and reports them", () => {
    const withError = [
      ...history,
      op(5, actions.updateOrientation({ orientation: "never applied", updatedAt: T }), {
        error: "boom",
      }),
    ];
    const r = replayToRevision(withError, 5);
    expect(r.document.state.global.orientation).toBe("Second framing.\nMuch fuller now.");
    expect(r.failures).toEqual([
      { index: 5, type: "UPDATE_ORIENTATION", reason: "boom" },
    ]);
  });

  it("records a reducer refusal instead of throwing", () => {
    const r = replayToRevision(
      [...history, op(5, actions.removeCoreIdea({ id: "does-not-exist" }))],
      5,
    );
    expect(r.document.state.global.coreIdeas).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].index).toBe(5);
  });

  it("folds skip (undo) into the effective list", () => {
    const undone = [
      ...history,
      // index 5 with skip 1: undo index 4 (the open question)
      op(5, actions.removeTension({ id: "tension-1" }), { skip: 1 }),
    ];
    expect(effectiveOperations(undone).map((o) => o.index)).not.toContain(4);
    const r = replayToRevision(undone, 5).document.state.global;
    expect(r.openQuestions).toEqual([]);
    expect(r.tensions).toEqual([]);
  });
});

describe("presentation helpers", () => {
  it("describes operations in one line", () => {
    expect(describeOperation(history[0])).toBe(
      "Created “Reactor internals” as TOPIC",
    );
    expect(describeOperation(history[1])).toBe(
      "Core idea added — the operation store is append-only",
    );
    expect(describeOperation(history[2])).toBe("Orientation rewritten (32 chars)");
    expect(describeOperation(history[3])).toBe(
      "Tension noted: Two notes disagree on skip semantics",
    );
    expect(describeOperation(history[4])).toBe("Question added: Where does GC run?");
    expect(describeOperation(op(9, { type: "SOME_NEW_OP", input: {} }))).toBe(
      "Some new op",
    );
  });

  it("classifies operation kinds", () => {
    expect(operationKind("CREATE_MOC")).toBe("content");
    expect(operationKind("UPDATE_ORIENTATION")).toBe("content");
    expect(operationKind("ADD_CORE_IDEA")).toBe("links");
    expect(operationKind("ADD_CHILD_MOC")).toBe("links");
    expect(operationKind("ADD_TENSION")).toBe("annotation");
    expect(operationKind("REMOVE_OPEN_QUESTION")).toBe("annotation");
    expect(operationKind("SET_METADATA_FIELD")).toBe("metadata");
    expect(operationKind("WHATEVER")).toBe("other");
  });
});
