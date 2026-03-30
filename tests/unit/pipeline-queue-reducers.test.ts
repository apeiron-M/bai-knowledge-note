import { describe, it, expect } from "vitest";
import {
  reducer,
  utils,
  actions,
} from "@powerhousedao/knowledge-note/document-models/pipeline-queue/v1";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh PipelineQueue document and add one "claim" task to it. */
function makeDocWithTask(taskId = "task-1") {
  const doc = utils.createDocument();
  return reducer(
    doc,
    actions.addTask({
      id: taskId,
      taskType: "claim",
      target: "doc://note-abc",
      createdAt: "2026-01-01T00:00:00Z",
    }),
  );
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("PipelineQueue — queue management reducers", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("ADD_TASK creates task with PENDING status, currentPhase = 'create', increments activeCount", () => {
    const doc = utils.createDocument();
    expect(doc.state.global.activeCount).toBe(0);
    expect(doc.state.global.tasks).toHaveLength(0);

    const updated = reducer(
      doc,
      actions.addTask({
        id: "task-1",
        taskType: "claim",
        target: "doc://note-abc",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );

    expect(updated.state.global.tasks).toHaveLength(1);

    const task = updated.state.global.tasks[0];
    expect(task.id).toBe("task-1");
    expect(task.taskType).toBe("claim");
    expect(task.status).toBe("PENDING");
    expect(task.currentPhase).toBe("create"); // first phase from phaseOrder for "claim"
    expect(task.completedPhases).toEqual([]);
    expect(task.assignedTo).toBeNull();
    expect(updated.state.global.activeCount).toBe(1);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("ASSIGN_TASK transitions status to IN_PROGRESS and sets assignedTo", () => {
    const doc = makeDocWithTask("task-1");

    const updated = reducer(
      doc,
      actions.assignTask({
        taskId: "task-1",
        assignedTo: "agent-x",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    const task = updated.state.global.tasks[0];
    expect(task.status).toBe("IN_PROGRESS");
    expect(task.assignedTo).toBe("agent-x");
    expect(task.updatedAt).toBe("2026-01-01T01:00:00Z");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("ADVANCE_PHASE moves currentPhase to completedPhases and sets next phase (create→reflect→reweave→verify)", () => {
    const doc = makeDocWithTask("task-1");

    // Assign first so status is IN_PROGRESS
    const assigned = reducer(
      doc,
      actions.assignTask({
        taskId: "task-1",
        assignedTo: "agent-x",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    // Advance from "create" → should become "reflect"
    const after1 = reducer(
      assigned,
      actions.advancePhase({
        taskId: "task-1",
        updatedAt: "2026-01-01T02:00:00Z",
        handoff: {
          id: "h-1",
          phase: "create",
          workDone: "Created note",
          filesModified: [],
          completedAt: "2026-01-01T02:00:00Z",
        },
      }),
    );

    expect(after1.state.global.tasks[0].completedPhases).toContain("create");
    expect(after1.state.global.tasks[0].currentPhase).toBe("reflect");
    expect(after1.state.global.tasks[0].status).toBe("PENDING");

    // Re-assign for next phase
    const assigned2 = reducer(
      after1,
      actions.assignTask({
        taskId: "task-1",
        assignedTo: "agent-x",
        updatedAt: "2026-01-01T02:30:00Z",
      }),
    );

    // Advance from "reflect" → should become "reweave"
    const after2 = reducer(
      assigned2,
      actions.advancePhase({
        taskId: "task-1",
        updatedAt: "2026-01-01T03:00:00Z",
        handoff: {
          id: "h-2",
          phase: "reflect",
          workDone: "Reflected on note",
          filesModified: [],
          completedAt: "2026-01-01T03:00:00Z",
        },
      }),
    );

    expect(after2.state.global.tasks[0].completedPhases).toEqual([
      "create",
      "reflect",
    ]);
    expect(after2.state.global.tasks[0].currentPhase).toBe("reweave");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("ADVANCE_PHASE on final phase ('verify') auto-completes: status=DONE, currentPhase=null, completedCount increments, activeCount decrements", () => {
    const doc = makeDocWithTask("task-1");

    // Fast-forward through create, reflect, reweave
    const phases = ["create", "reflect", "reweave"];
    let current = reducer(
      doc,
      actions.assignTask({
        taskId: "task-1",
        assignedTo: "agent-x",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      current = reducer(
        current,
        actions.advancePhase({
          taskId: "task-1",
          updatedAt: `2026-01-01T0${i + 2}:00:00Z`,
          handoff: {
            id: `h-${i + 1}`,
            phase,
            workDone: `Done with ${phase}`,
            filesModified: [],
            completedAt: `2026-01-01T0${i + 2}:00:00Z`,
          },
        }),
      );

      // Re-assign for next phase (except after last)
      if (i < phases.length - 1) {
        current = reducer(
          current,
          actions.assignTask({
            taskId: "task-1",
            assignedTo: "agent-x",
            updatedAt: `2026-01-01T0${i + 2}:30:00Z`,
          }),
        );
      }
    }

    // Now on "verify" phase, assign and advance to completion
    const onVerify = reducer(
      current,
      actions.assignTask({
        taskId: "task-1",
        assignedTo: "agent-x",
        updatedAt: "2026-01-01T05:00:00Z",
      }),
    );

    const completed = reducer(
      onVerify,
      actions.advancePhase({
        taskId: "task-1",
        updatedAt: "2026-01-01T06:00:00Z",
        handoff: {
          id: "h-final",
          phase: "verify",
          workDone: "Verified note",
          filesModified: [],
          completedAt: "2026-01-01T06:00:00Z",
        },
      }),
    );

    const task = completed.state.global.tasks[0];
    expect(task.status).toBe("DONE");
    expect(task.currentPhase).toBeNull();
    expect(task.completedPhases).toEqual([
      "create",
      "reflect",
      "reweave",
      "verify",
    ]);
    expect(completed.state.global.completedCount).toBe(1);
    expect(completed.state.global.activeCount).toBe(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("BLOCK_TASK sets status to BLOCKED", () => {
    const doc = makeDocWithTask("task-1");

    const updated = reducer(
      doc,
      actions.blockTask({
        taskId: "task-1",
        reason: "Waiting for external dependency",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    expect(updated.state.global.tasks[0].status).toBe("BLOCKED");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("UNBLOCK_TASK sets status back to PENDING", () => {
    const doc = makeDocWithTask("task-1");

    const blocked = reducer(
      doc,
      actions.blockTask({
        taskId: "task-1",
        reason: "Waiting for external dependency",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    const unblocked = reducer(
      blocked,
      actions.unblockTask({
        taskId: "task-1",
        updatedAt: "2026-01-01T02:00:00Z",
      }),
    );

    expect(unblocked.state.global.tasks[0].status).toBe("PENDING");
    expect(unblocked.state.global.tasks[0].updatedAt).toBe(
      "2026-01-01T02:00:00Z",
    );
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("UNBLOCK_TASK on a non-BLOCKED task records an error", () => {
    const doc = makeDocWithTask("task-1");
    // Task is PENDING, not BLOCKED — unblock should error
    // addTask is op[0], unblockTask is op[1]
    const updated = reducer(
      doc,
      actions.unblockTask({
        taskId: "task-1",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    expect(updated.operations.global[1].error).toBeTruthy();
    // Status unchanged
    expect(updated.state.global.tasks[0].status).toBe("PENDING");
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("FAIL_TASK sets status to FAILED and decrements activeCount", () => {
    const doc = makeDocWithTask("task-1");
    expect(doc.state.global.activeCount).toBe(1);

    const failed = reducer(
      doc,
      actions.failTask({
        taskId: "task-1",
        reason: "Unrecoverable processing error",
        updatedAt: "2026-01-01T01:00:00Z",
      }),
    );

    const task = failed.state.global.tasks[0];
    expect(task.status).toBe("FAILED");
    expect(task.updatedAt).toBe("2026-01-01T01:00:00Z");
    expect(failed.state.global.activeCount).toBe(0);
  });
});
