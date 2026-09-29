import {
  addTask,
  advancePhase,
  assignTask,
  blockTask,
  failTask,
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

// Assigning a finished task used to revive it as IN_PROGRESS; every later
// operation on it then moved completedCount and activeCount for good.
describe("ASSIGN_TASK takes only a PENDING task", () => {
  it("refuses a FAILED, a DONE and a BLOCKED task, leaving state and counters as they were", () => {
    let document = utils.createDocument();
    for (const id of ["failed", "done", "blocked", "open"]) {
      document = reducer(
        document,
        addTask({ id, taskType: "claim", target: id, createdAt: T1 }),
      );
    }
    document = reducer(
      document,
      failTask({ taskId: "failed", reason: "source deleted", updatedAt: T2 }),
    );
    for (const phase of ["create", "reflect", "reweave", "verify"]) {
      document = reducer(
        document,
        advancePhase({ taskId: "done", handoff: handoff(phase), updatedAt: T2 }),
      );
    }
    document = reducer(
      document,
      blockTask({ taskId: "blocked", reason: "waiting", updatedAt: T2 }),
    );
    // 4 adds, 1 fail, 4 advances, 1 block: the next operation is index 10.
    const before = structuredClone(document.state.global);
    expect(before.tasks.map((t) => t.status)).toEqual([
      "FAILED",
      "DONE",
      "BLOCKED",
      "PENDING",
    ]);

    document = reducer(
      document,
      assignTask({ taskId: "failed", assignedTo: "agent", updatedAt: T2 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "done", assignedTo: "agent", updatedAt: T2 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "blocked", assignedTo: "agent", updatedAt: T2 }),
    );

    expect(document.operations.global[10].error).toBe(
      "Task failed is FAILED; only a PENDING task can be assigned",
    );
    expect(document.operations.global[11].error).toBe(
      "Task done is DONE; only a PENDING task can be assigned",
    );
    expect(document.operations.global[12].error).toBe(
      "Task blocked is BLOCKED; only a PENDING task can be assigned",
    );
    expect(document.state.global).toStrictEqual(before);
  });

  it("still assigns a PENDING task, and still names who holds an assigned one", () => {
    let document = reducer(
      utils.createDocument(),
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "agent-a", updatedAt: T2 }),
    );
    expect(document.operations.global[1].error).toBeUndefined();
    expect(document.state.global.tasks[0]).toMatchObject({
      status: "IN_PROGRESS",
      assignedTo: "agent-a",
    });
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "agent-b", updatedAt: T2 }),
    );
    expect(document.operations.global[2].error).toBe(
      "Task t1 is already assigned to agent-a",
    );
  });
});
