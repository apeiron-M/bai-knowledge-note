import {
  addTask,
  advancePhase,
  blockTask,
  failTask,
  reconcileCounters,
  reducer,
  utils,
} from "document-models/pipeline-queue/v2";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const handoff = (phase: string) => ({
  id: `h-${phase}`,
  phase,
  workDone: "done",
  filesModified: [],
  completedAt: T2,
});

// `taskType` and `handoff.phase` are Strings the model cannot enumerate (the
// valid set is the `phaseOrder` state), so the reducer checks them.
describe("queue phase guards", () => {
  it("rejects a task type with no phase order — such a task could never advance", () => {
    const document = reducer(
      utils.createDocument(),
      addTask({ id: "t1", taskType: "bogus", target: "doc", createdAt: T1 }),
    );
    expect(document.operations.global[0].error).toBe(
      "No phase order is defined for task type bogus",
    );
    expect(document.state.global.tasks).toHaveLength(0);
    expect(document.state.global.activeCount).toBe(0);
  });

  it("rejects a starting phase that is not in the task type's phase order", () => {
    const document = reducer(
      utils.createDocument(),
      addTask({
        id: "t1",
        taskType: "claim",
        target: "doc",
        currentPhase: "polish",
        createdAt: T1,
      }),
    );
    expect(document.operations.global[0].error).toBe(
      "polish is not a phase of task type claim",
    );
    expect(document.state.global.tasks).toHaveLength(0);
  });

  it("rejects a handoff for a phase the task is not at", () => {
    let document = reducer(
      utils.createDocument(),
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    document = reducer(
      document,
      advancePhase({ taskId: "t1", handoff: handoff("reflect"), updatedAt: T2 }),
    );
    expect(document.operations.global[1].error).toBe(
      "Handoff is for phase reflect but the task is at create",
    );
    const task = document.state.global.tasks[0];
    expect(task.currentPhase).toBe("create");
    expect(task.handoffs).toHaveLength(0);
    expect(task.completedPhases).toStrictEqual([]);
  });

  it("only blocks a PENDING or IN_PROGRESS task", () => {
    let document = reducer(
      utils.createDocument(),
      addTask({
        id: "t1",
        taskType: "claim",
        target: "doc",
        currentPhase: "verify",
        createdAt: T1,
      }),
    );
    document = reducer(
      document,
      advancePhase({ taskId: "t1", handoff: handoff("verify"), updatedAt: T2 }),
    );
    expect(document.state.global.tasks[0].status).toBe("DONE");

    document = reducer(document, blockTask({ taskId: "t1", reason: "x", updatedAt: T2 }));
    expect(document.operations.global[2].error).toBe(
      "Task t1 is DONE; only PENDING or IN_PROGRESS tasks can be blocked",
    );
    expect(document.state.global.tasks[0].status).toBe("DONE");
  });
});

// Tasks created before ADD_TASK checked `taskType` can still sit in a queue:
// no phaseOrder entry, and possibly no current phase.
describe("legacy tasks that predate the guards", () => {
  const legacy = (currentPhase: string | null) => {
    const document = utils.createDocument();
    document.state.global.tasks = [
      {
        id: "legacy",
        taskType: "custom",
        status: "PENDING",
        target: "old",
        batchId: null,
        documentRef: null,
        currentPhase,
        completedPhases: [],
        handoffs: [],
        assignedTo: null,
        createdAt: T1,
        updatedAt: null,
      },
    ];
    document.state.global.activeCount = 0; // the slot was never counted
    return document;
  };

  it("settles a task whose type has no phase order on its first advance, without driving activeCount negative", () => {
    const updated = reducer(
      legacy("adhoc"),
      advancePhase({ taskId: "legacy", handoff: handoff("adhoc"), updatedAt: T2 }),
    );
    expect(updated.operations.global[0].error).toBeUndefined();
    const task = updated.state.global.tasks[0];
    expect(task.status).toBe("DONE");
    expect(task.currentPhase).toBeNull();
    expect(task.completedPhases).toStrictEqual(["adhoc"]);
    expect(updated.state.global.completedCount).toBe(1);
    expect(updated.state.global.activeCount).toBe(0);
  });

  it("cannot advance a task with no current phase — COMPLETE_TASK or FAIL_TASK is its exit", () => {
    const updated = reducer(
      legacy(null),
      advancePhase({ taskId: "legacy", handoff: handoff("adhoc"), updatedAt: T2 }),
    );
    expect(updated.operations.global[0].error).toBe(
      "Handoff is for phase adhoc but the task is at null",
    );
    expect(updated.state.global.tasks[0].status).toBe("PENDING");
  });
});

describe("RECONCILE_COUNTERS", () => {
  it("recomputes completedCount and activeCount from the tasks", () => {
    let document = utils.createDocument();
    document = reducer(document, addTask({ id: "a", taskType: "claim", target: "x", currentPhase: "verify", createdAt: T1 }));
    document = reducer(document, addTask({ id: "b", taskType: "claim", target: "y", createdAt: T1 }));
    document = reducer(document, addTask({ id: "c", taskType: "claim", target: "z", createdAt: T1 }));
    document = reducer(document, advancePhase({ taskId: "a", handoff: handoff("verify"), updatedAt: T2 }));
    document = reducer(document, failTask({ taskId: "c", reason: "r", updatedAt: T2 }));
    document = reducer(document, blockTask({ taskId: "b", reason: "r", updatedAt: T2 }));
    // drift from history that predates the guards
    document.state.global.completedCount = 139;
    document.state.global.activeCount = 0;

    document = reducer(document, reconcileCounters({ updatedAt: T2 }));
    expect(document.operations.global.at(-1)?.error).toBeUndefined();
    expect(document.state.global.completedCount).toBe(1); // a
    expect(document.state.global.activeCount).toBe(1); // b — BLOCKED still holds a slot
    expect(document.state.global.lastProcessedAt).toBe(T2);
  });
});
