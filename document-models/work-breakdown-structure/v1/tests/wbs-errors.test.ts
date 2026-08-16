import {
  addDependencies, addNote, assignGoal, createGoal, deleteGoal, reducer,
  removeDependencies, removeNote, reorder, setGoalStatus, setOutcome,
  updateGoalDescription, utils,
} from "document-models/work-breakdown-structure/v1";
import type { WorkBreakdownStructureDocument } from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

/** Fixture: goal "a" (root) with child "a1". Two ops -> next op lands at index 2. */
const init = (): WorkBreakdownStructureDocument => {
  let doc = reducer(
    utils.createDocument(),
    createGoal({ id: "a", description: "Root goal" }),
  );
  doc = reducer(
    doc,
    createGoal({ id: "a1", description: "Child goal", parentId: "a" }),
  );
  return doc;
};

const ids = (doc: WorkBreakdownStructureDocument) =>
  doc.state.global.goals.map((g) => g.id);

describe("wbs errors (state unchanged, error recorded)", () => {
  it("DUPLICATE_GOAL_ID when creating a goal with an id that already exists", () => {
    const doc = reducer(
      init(),
      createGoal({ id: "a", description: "duplicate" }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
  });

  it("GOAL_NOT_FOUND when createGoal's parentId does not exist", () => {
    const doc = reducer(
      init(),
      createGoal({ id: "x", description: "d", parentId: "nope" }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
  });

  it("GOAL_NOT_FOUND when createGoal's insertBefore does not exist", () => {
    const doc = reducer(
      init(),
      createGoal({ id: "x", description: "d", insertBefore: "nope" }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
  });

  it("GOAL_NOT_FOUND on every goal-targeting operation given an unknown id", () => {
    let doc = reducer(
      init(),
      updateGoalDescription({ id: "nope", description: "d" }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    doc = reducer(doc, deleteGoal({ id: "nope" }));
    expect(doc.operations.global[3].error).toBeTruthy();
    doc = reducer(doc, setGoalStatus({ id: "nope", status: "TODO" }));
    expect(doc.operations.global[4].error).toBeTruthy();
    doc = reducer(doc, assignGoal({ id: "nope" }));
    expect(doc.operations.global[5].error).toBeTruthy();
    doc = reducer(doc, setOutcome({ id: "nope" }));
    expect(doc.operations.global[6].error).toBeTruthy();
    doc = reducer(doc, addDependencies({ id: "nope", dependencies: [] }));
    expect(doc.operations.global[7].error).toBeTruthy();
    doc = reducer(doc, removeDependencies({ id: "nope", dependencies: [] }));
    expect(doc.operations.global[8].error).toBeTruthy();
    doc = reducer(doc, addNote({ goalId: "nope", noteId: "n", note: "x" }));
    expect(doc.operations.global[9].error).toBeTruthy();
    doc = reducer(doc, removeNote({ goalId: "nope", noteId: "n" }));
    expect(doc.operations.global[10].error).toBeTruthy();
    doc = reducer(doc, reorder({ id: "nope" }));
    expect(doc.operations.global[11].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
  });

  it("INVALID_PARENT when reorder targets itself or its own descendant", () => {
    let doc = reducer(init(), reorder({ id: "a", parentId: "a" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    doc = reducer(doc, reorder({ id: "a", parentId: "a1" }));
    expect(doc.operations.global[3].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
    expect(doc.state.global.goals.find((g) => g.id === "a")?.parentId).toBeNull();
  });

  it("GOAL_NOT_FOUND when reorder's insertBefore does not exist", () => {
    const doc = reducer(init(), reorder({ id: "a", insertBefore: "nope" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(ids(doc)).toEqual(["a", "a1"]);
  });

  // Beyond the brief's table: reorderOperation also validates that a supplied
  // parentId exists at all (distinct from the self/descendant check above,
  // which only fires once the parent is known to exist). Needed for branch
  // coverage on that guard.
  it("GOAL_NOT_FOUND when reorder's parentId does not exist", () => {
    const doc = reducer(init(), reorder({ id: "a1", parentId: "nope" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(
      doc.state.global.goals.find((g) => g.id === "a1")?.parentId,
    ).toBe("a");
  });

  it("MISSING_BLOCK_REASON when status is BLOCKED without a usable reason", () => {
    let doc = reducer(init(), setGoalStatus({ id: "a", status: "BLOCKED" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.goals.find((g) => g.id === "a")?.status).toBe(
      "TODO",
    );
    doc = reducer(
      doc,
      setGoalStatus({ id: "a", status: "BLOCKED", blockReason: "  " }),
    );
    expect(doc.operations.global[3].error).toBeTruthy();
    expect(doc.state.global.goals.find((g) => g.id === "a")?.status).toBe(
      "TODO",
    );
  });

  it("INVALID_DEPENDENCY when a goal is made to depend on itself", () => {
    const doc = reducer(
      init(),
      addDependencies({ id: "a", dependencies: ["a"] }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(
      doc.state.global.goals.find((g) => g.id === "a")?.dependencies,
    ).toEqual([]);
  });

  it("DEPENDENCY_NOT_FOUND when the dependency goal does not exist", () => {
    const doc = reducer(
      init(),
      addDependencies({ id: "a", dependencies: ["nope"] }),
    );
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(
      doc.state.global.goals.find((g) => g.id === "a")?.dependencies,
    ).toEqual([]);
  });

  it("DUPLICATE_NOTE_ID when the same note id is added twice", () => {
    let doc = reducer(
      init(),
      addNote({ goalId: "a", noteId: "n1", note: "first" }),
    );
    doc = reducer(
      doc,
      addNote({ goalId: "a", noteId: "n1", note: "second" }),
    );
    expect(doc.operations.global[3].error).toBeTruthy();
    expect(
      doc.state.global.goals.find((g) => g.id === "a")?.notes,
    ).toHaveLength(1);
  });

  it("NOTE_NOT_FOUND when removing an id that was never added", () => {
    const doc = reducer(init(), removeNote({ goalId: "a", noteId: "nope" }));
    expect(doc.operations.global[2].error).toBeTruthy();
    expect(doc.state.global.goals.find((g) => g.id === "a")?.notes).toEqual(
      [],
    );
  });
});
