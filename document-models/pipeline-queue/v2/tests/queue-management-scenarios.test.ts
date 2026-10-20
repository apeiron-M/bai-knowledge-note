import {
  addTask,
  advancePhase,
  assignTask,
  blockTask,
  completeTask,
  failTask,
  isPipelineQueueDocument,
  reducer,
  unblockTask,
  utils,
} from "document-models/pipeline-queue/v2";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";
const T4 = "2026-01-04T00:00:00.000Z";
const T5 = "2026-01-05T00:00:00.000Z";

function makeHandoff(id: string, phase: string, completedBy?: string) {
  return {
    id,
    phase,
    workDone: `Completed phase ${phase}`,
    filesModified: [`notes/${phase}.md`],
    completedAt: T2,
    ...(completedBy ? { completedBy } : {}),
  };
}

describe("QueueManagement scenarios", () => {
  it("should drive a claim task through every phase to completion", () => {
    let document = utils.createDocument();

    // Task without explicit currentPhase picks the first phase from phaseOrder
    document = reducer(
      document,
      addTask({
        id: "task-1",
        taskType: "claim",
        target: "inbox/source-a.md",
        batchId: "batch-1",
        documentRef: "doc-ref-1",
        createdAt: T1,
      }),
    );
    let task = document.state.global.tasks[0];
    expect(task.status).toBe("PENDING");
    expect(task.currentPhase).toBe("create");
    expect(task.batchId).toBe("batch-1");
    expect(task.documentRef).toBe("doc-ref-1");
    expect(task.assignedTo).toBeNull();
    expect(task.updatedAt).toBeNull();
    expect(document.state.global.activeCount).toBe(1);

    // Second task with explicit currentPhase, no batchId/documentRef
    document = reducer(
      document,
      addTask({
        id: "task-2",
        taskType: "claim",
        target: "inbox/source-b.md",
        currentPhase: "verify",
        createdAt: T1,
      }),
    );
    const task2 = document.state.global.tasks[1];
    expect(task2.currentPhase).toBe("verify");
    expect(task2.batchId).toBeNull();
    expect(task2.documentRef).toBeNull();
    expect(document.state.global.activeCount).toBe(2);

    document = reducer(
      document,
      assignTask({ taskId: "task-1", assignedTo: "agent-a", updatedAt: T2 }),
    );
    task = document.state.global.tasks[0];
    expect(task.status).toBe("IN_PROGRESS");
    expect(task.assignedTo).toBe("agent-a");
    expect(task.updatedAt).toBe(T2);
    expect(document.state.global.lastProcessedAt).toBe(T2);

    // create -> reflect (handoff with completedBy)
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1",
        handoff: makeHandoff("handoff-1", "create", "agent-a"),
        updatedAt: T2,
      }),
    );
    task = document.state.global.tasks[0];
    expect(task.currentPhase).toBe("reflect");
    expect(task.status).toBe("PENDING");
    expect(task.assignedTo).toBeNull();
    expect(task.completedPhases).toStrictEqual(["create"]);
    expect(task.handoffs[0].completedBy).toBe("agent-a");
    expect(task.handoffs[0].learnings).toStrictEqual([]);

    // reflect -> reweave (handoff without completedBy)
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1",
        handoff: makeHandoff("handoff-2", "reflect"),
        updatedAt: T3,
      }),
    );
    task = document.state.global.tasks[0];
    expect(task.currentPhase).toBe("reweave");
    expect(task.handoffs[1].completedBy).toBeNull();

    // reweave -> verify
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1",
        handoff: makeHandoff("handoff-3", "reweave"),
        updatedAt: T3,
      }),
    );
    expect(document.state.global.tasks[0].currentPhase).toBe("verify");

    // verify -> no next phase: task is DONE
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1",
        handoff: makeHandoff("handoff-4", "verify"),
        updatedAt: T4,
      }),
    );
    task = document.state.global.tasks[0];
    expect(task.status).toBe("DONE");
    expect(task.currentPhase).toBeNull();
    expect(task.completedPhases).toStrictEqual([
      "create",
      "reflect",
      "reweave",
      "verify",
    ]);
    expect(document.state.global.completedCount).toBe(1);
    expect(document.state.global.activeCount).toBe(1);

    // task-2 was created on its last phase: advancing completes it too
    document = reducer(
      document,
      advancePhase({
        taskId: "task-2",
        handoff: makeHandoff("handoff-5", "verify", "agent-b"),
        updatedAt: T4,
      }),
    );
    expect(document.state.global.tasks[1].status).toBe("DONE");
    expect(document.state.global.completedCount).toBe(2);
    expect(document.state.global.activeCount).toBe(0);

    // Advancing a DONE task is refused — it used to resurrect the task at the
    // first phase because indexOf(null || "") is -1.
    document = reducer(
      document,
      advancePhase({
        taskId: "task-2",
        handoff: makeHandoff("handoff-6", "restart"),
        updatedAt: T5,
      }),
    );
    task = document.state.global.tasks[1];
    expect(document.operations.global.at(-1)?.error).toBe(
      "Task task-2 is DONE; only PENDING or IN_PROGRESS tasks advance",
    );
    expect(task.status).toBe("DONE");
    expect(task.currentPhase).toBeNull();
    expect(task.completedPhases).toStrictEqual(["verify"]);
    expect(document.state.global.completedCount).toBe(2);

    // Failing a DONE task is refused too, so activeCount is never decremented twice
    document = reducer(
      document,
      failTask({ taskId: "task-2", reason: "verification failed", updatedAt: T5 }),
    );
    expect(document.operations.global.at(-1)?.error).toBe(
      "Task task-2 is already DONE",
    );
    expect(document.state.global.tasks[1].status).toBe("DONE");
    expect(document.state.global.activeCount).toBe(0);
    expect(document.state.global.lastProcessedAt).toBe(T4);

    expect(isPipelineQueueDocument(document)).toBe(true);
    for (const operation of document.operations.global.slice(0, -2)) {
      expect(operation.error).toBeUndefined();
    }
  });

  it("refuses a task type without a phase-order entry instead of creating an unphased task", () => {
    // Such a task used to be created with currentPhase null: it could never
    // advance or complete and held an activeCount slot forever.
    const document = reducer(
      utils.createDocument(),
      addTask({
        id: "task-custom",
        taskType: "custom",
        target: "inbox/custom.md",
        createdAt: T1,
      }),
    );
    expect(document.operations.global[0].error).toBe(
      "No phase order is defined for task type custom",
    );
    expect(document.state.global.tasks).toHaveLength(0);
    expect(document.state.global.activeCount).toBe(0);
  });

  it("should block and unblock a task", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      addTask({
        id: "task-1",
        taskType: "enrichment",
        target: "notes/note-1.md",
        createdAt: T1,
      }),
    );
    expect(document.state.global.tasks[0].currentPhase).toBe("enrich");

    document = reducer(
      document,
      blockTask({ taskId: "task-1", reason: "waiting on source", updatedAt: T2 }),
    );
    expect(document.state.global.tasks[0].status).toBe("BLOCKED");
    expect(document.state.global.tasks[0].updatedAt).toBe(T2);

    document = reducer(document, unblockTask({ taskId: "task-1", updatedAt: T3 }));
    expect(document.state.global.tasks[0].status).toBe("PENDING");
    expect(document.state.global.tasks[0].updatedAt).toBe(T3);

    for (const operation of document.operations.global) {
      expect(operation.error).toBeUndefined();
    }
  });

  it("refuses to settle a task that is already terminal, so the counters stay consistent", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      addTask({
        id: "task-1",
        taskType: "claim",
        target: "inbox/source-a.md",
        currentPhase: "verify",
        createdAt: T1,
      }),
    );
    expect(document.state.global.activeCount).toBe(1);

    document = reducer(
      document,
      failTask({ taskId: "task-1", reason: "bad source", updatedAt: T2 }),
    );
    expect(document.state.global.activeCount).toBe(0);

    // Completing the failed task used to mark it DONE and count a completion
    document = reducer(document, completeTask({ taskId: "task-1", updatedAt: T3 }));
    expect(document.operations.global[2].error).toBe("Task task-1 is already FAILED");
    expect(document.state.global.tasks[0].status).toBe("FAILED");
    expect(document.state.global.completedCount).toBe(0);
    expect(document.state.global.activeCount).toBe(0);

    // Advancing it used to restart it at the first phase
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1",
        handoff: makeHandoff("handoff-1", "verify"),
        updatedAt: T4,
      }),
    );
    expect(document.operations.global[3].error).toBe(
      "Task task-1 is FAILED; only PENDING or IN_PROGRESS tasks advance",
    );
    expect(document.state.global.tasks[0].currentPhase).toBe("verify");

    // Failing it again would have decremented activeCount a second time
    document = reducer(
      document,
      failTask({ taskId: "task-1", reason: "flaky", updatedAt: T4 }),
    );
    expect(document.operations.global[4].error).toBe("Task task-1 is already FAILED");
    expect(document.state.global.activeCount).toBe(0);

    // A retry is a new task
    document = reducer(
      document,
      addTask({
        id: "task-1-retry",
        taskType: "claim",
        target: "inbox/source-a.md",
        currentPhase: "verify",
        createdAt: T5,
      }),
    );
    expect(document.state.global.activeCount).toBe(1);
    document = reducer(
      document,
      advancePhase({
        taskId: "task-1-retry",
        handoff: makeHandoff("handoff-2", "verify"),
        updatedAt: T5,
      }),
    );
    expect(document.state.global.tasks[1].status).toBe("DONE");
    expect(document.state.global.completedCount).toBe(1);
    expect(document.state.global.activeCount).toBe(0);

    for (const [i, operation] of document.operations.global.entries()) {
      if (i === 2 || i === 3 || i === 4) continue;
      expect(operation.error).toBeUndefined();
    }
  });

  it("should record TaskNotFoundError when operating on a missing task", () => {
    const document = utils.createDocument();

    const afterAssign = reducer(
      document,
      assignTask({ taskId: "missing", assignedTo: "agent-a", updatedAt: T1 }),
    );
    expect(afterAssign.operations.global[0].error).toBe("Task not found");
    expect(afterAssign.state.global.tasks).toStrictEqual([]);

    const afterAdvance = reducer(
      document,
      advancePhase({
        taskId: "missing",
        handoff: makeHandoff("handoff-x", "create"),
        updatedAt: T1,
      }),
    );
    expect(afterAdvance.operations.global[0].error).toBe("Task not found");

    const afterComplete = reducer(
      document,
      completeTask({ taskId: "missing", updatedAt: T1 }),
    );
    expect(afterComplete.operations.global[0].error).toBe("Task not found");
    expect(afterComplete.state.global.completedCount).toBe(0);

    const afterFail = reducer(
      document,
      failTask({ taskId: "missing", reason: "nope", updatedAt: T1 }),
    );
    expect(afterFail.operations.global[0].error).toBe("Task not found");

    const afterBlock = reducer(
      document,
      blockTask({ taskId: "missing", reason: "nope", updatedAt: T1 }),
    );
    expect(afterBlock.operations.global[0].error).toBe("Task not found");

    const afterUnblock = reducer(
      document,
      unblockTask({ taskId: "missing", updatedAt: T1 }),
    );
    expect(afterUnblock.operations.global[0].error).toBe("Task not found");
  });

  it("should record InvalidTaskStatusError when unblocking a task that is not blocked", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      addTask({
        id: "task-1",
        taskType: "claim",
        target: "inbox/source-a.md",
        createdAt: T1,
      }),
    );

    document = reducer(document, unblockTask({ taskId: "task-1", updatedAt: T2 }));

    // Second operation failed; state is unchanged
    expect(document.operations.global[1].error).toBe("Task is not blocked");
    expect(document.state.global.tasks[0].status).toBe("PENDING");
    expect(document.state.global.tasks[0].updatedAt).toBeNull();
  });
});
