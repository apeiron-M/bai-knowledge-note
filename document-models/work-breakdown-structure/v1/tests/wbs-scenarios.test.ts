import {
  addDependencies, addNote, assignGoal, createGoal, deleteGoal, reducer,
  removeDependencies, removeNote, reorder, setGoalStatus, setOutcome,
  setOwner, setProjectRef, setReferences, updateGoalDescription, utils,
} from "document-models/work-breakdown-structure/v1";
import type { WorkBreakdownStructureDocument } from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

const ids = (doc: WorkBreakdownStructureDocument) =>
  doc.state.global.goals.map((g) => g.id);

describe("wbs full flow", () => {
  it("builds, orders, works and prunes a goal tree", () => {
    let doc = utils.createDocument();
    doc = reducer(doc, setOwner({ owner: "liberuum" }));
    doc = reducer(doc, setProjectRef({ projectRef: "proj-1" }));
    doc = reducer(doc, setReferences({ references: ["https://spec"] }));

    doc = reducer(doc, createGoal({ id: "a", description: "Design models" }));
    doc = reducer(doc, createGoal({ id: "b", description: "Build editors" }));
    doc = reducer(doc, createGoal({ id: "a1", description: "Project model", parentId: "a" }));
    doc = reducer(doc, createGoal({ id: "a2", description: "WBS model", parentId: "a", assignee: "spec-writer" }));
    // insertBefore among siblings
    doc = reducer(doc, createGoal({ id: "a0", description: "Spec review", parentId: "a", insertBefore: "a1" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "a2", "b"]); // depth-first, a0 before a1
    expect(doc.state.global.goals.find((g) => g.id === "a2")?.assignee).toBe("spec-writer");

    // reorder: move b's position - make b a child of a, before a2
    doc = reducer(doc, reorder({ id: "b", parentId: "a", insertBefore: "a2" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "b", "a2"]);
    // back to root (append at end)
    doc = reducer(doc, reorder({ id: "b" }));
    expect(ids(doc)).toEqual(["a", "a0", "a1", "a2", "b"]);

    // workflow
    doc = reducer(doc, assignGoal({ id: "a1", assignee: "knowledge-agent" }));
    doc = reducer(doc, setGoalStatus({ id: "a1", status: "IN_PROGRESS" }));
    doc = reducer(doc, setGoalStatus({ id: "a2", status: "BLOCKED", blockReason: "waiting on a1" }));
    expect(doc.state.global.goals.find((g) => g.id === "a2")?.blockReason).toBe("waiting on a1");
    doc = reducer(doc, setGoalStatus({ id: "a2", status: "TODO" }));
    expect(doc.state.global.goals.find((g) => g.id === "a2")?.blockReason).toBeNull();
    doc = reducer(doc, setGoalStatus({ id: "a1", status: "COMPLETED", outcome: "PR #42" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")).toMatchObject({
      status: "COMPLETED", outcome: "PR #42",
    });
    // no cascade: parent untouched
    expect(doc.state.global.goals.find((g) => g.id === "a")?.status).toBe("TODO");

    doc = reducer(doc, setOutcome({ id: "a1", outcome: "PR #43" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")?.outcome).toBe("PR #43");
    // clearing an outcome (omitted input) falls back to null
    doc = reducer(doc, setOutcome({ id: "a1" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")?.outcome).toBeNull();

    doc = reducer(doc, updateGoalDescription({ id: "b", description: "Build both editors" }));
    doc = reducer(doc, addDependencies({ id: "b", dependencies: ["a1", "a2"] }));
    doc = reducer(doc, removeDependencies({ id: "b", dependencies: ["a2"] }));
    expect(doc.state.global.goals.find((g) => g.id === "b")?.dependencies).toEqual(["a1"]);
    // re-adding an already-present dependency is idempotent (no duplicate)
    doc = reducer(doc, addDependencies({ id: "b", dependencies: ["a1"] }));
    expect(doc.state.global.goals.find((g) => g.id === "b")?.dependencies).toEqual(["a1"]);

    doc = reducer(doc, addNote({ goalId: "a1", noteId: "n1", note: "done", author: "agent", timestamp: "2026-08-16T12:00:00.000Z" }));
    doc = reducer(doc, removeNote({ goalId: "a1", noteId: "n1" }));
    expect(doc.state.global.goals.find((g) => g.id === "a1")?.notes).toEqual([]);

    // delete subtree "a": removes a, a0, a1, a2 and strips b's dangling dep on a1
    doc = reducer(doc, deleteGoal({ id: "a" }));
    expect(ids(doc)).toEqual(["b"]);
    expect(doc.state.global.goals[0].dependencies).toEqual([]);

    // unassign via null
    doc = reducer(doc, assignGoal({ id: "b", assignee: null }));
    expect(doc.state.global.goals[0].assignee).toBeNull();

    // clearing owner/projectRef via explicit null falls back to null
    doc = reducer(doc, setOwner({ owner: null }));
    expect(doc.state.global.owner).toBeNull();
    doc = reducer(doc, setProjectRef({ projectRef: null }));
    expect(doc.state.global.projectRef).toBeNull();
  });
});
