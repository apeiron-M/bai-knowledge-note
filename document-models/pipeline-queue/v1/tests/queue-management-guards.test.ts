import {
  addTask,
  assignTask,
  reducer,
  utils,
} from "document-models/pipeline-queue/v1";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("queue guards", () => {
  it("rejects a duplicate task id and leaves state unchanged", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    const before = document.state.global.tasks.length;
    const count = document.state.global.activeCount;

    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T2 }),
    );

    expect(document.operations.global).toHaveLength(2);
    expect(document.operations.global[1].error).toBe("Task t1 already exists");
    expect(document.state.global.tasks).toHaveLength(before);
    expect(document.state.global.activeCount).toBe(count);
  });

  it("rejects claiming an already-assigned task", () => {
    let document = utils.createDocument();
    document = reducer(
      document,
      addTask({ id: "t1", taskType: "claim", target: "doc", createdAt: T1 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "0xaaa", updatedAt: T2 }),
    );
    document = reducer(
      document,
      assignTask({ taskId: "t1", assignedTo: "0xbbb", updatedAt: T3 }),
    );

    expect(document.operations.global).toHaveLength(3);
    expect(document.operations.global[2].error).toBe(
      "Task t1 is already assigned to 0xaaa",
    );
    expect(document.state.global.tasks[0].assignedTo).toBe("0xaaa");
  });
});