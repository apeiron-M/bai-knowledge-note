import type { PipelineQueueQueueManagementOperations } from "document-models/pipeline-queue/v1";
import {
  DuplicateTaskIdError,
  InvalidPhaseError,
  InvalidTaskStatusError,
  PhaseMismatchError,
  TaskAlreadyAssignedError,
  TaskNotFoundError,
  UnknownTaskTypeError,
} from "../../gen/queue-management/error.js";

// Status guards. `completedCount` / `activeCount` are incremented and
// decremented by these reducers, so an operation applied to a task that is
// already terminal corrupts the counters for good (a live queue reached
// completedCount 139 for 81 tasks this way). Terminal = DONE | FAILED; a
// FAILED task is retried by adding a new task, never by advancing it.
const isTerminal = (status: string) => status === "DONE" || status === "FAILED";
const isWorkable = (status: string) =>
  status === "PENDING" || status === "IN_PROGRESS";

export const pipelineQueueQueueManagementOperations: PipelineQueueQueueManagementOperations =
  {
    addTaskOperation(state, action) {
      if (state.tasks.some((t) => t.id === action.input.id)) {
        throw new DuplicateTaskIdError(
          `Task ${action.input.id} already exists`,
        );
      }
      const phaseEntry = state.phaseOrder.find(
        (p) => p.taskType === action.input.taskType,
      );
      if (!phaseEntry) {
        throw new UnknownTaskTypeError(
          `No phase order is defined for task type ${action.input.taskType}`,
        );
      }
      const firstPhase = action.input.currentPhase || phaseEntry.phases[0];
      if (!phaseEntry.phases.includes(firstPhase)) {
        throw new InvalidPhaseError(
          `${firstPhase} is not a phase of task type ${action.input.taskType}`,
        );
      }
      state.tasks.push({
        id: action.input.id,
        taskType: action.input.taskType,
        status: "PENDING",
        target: action.input.target,
        batchId: action.input.batchId || null,
        documentRef: action.input.documentRef || null,
        currentPhase: firstPhase,
        completedPhases: [],
        handoffs: [],
        assignedTo: null,
        createdAt: action.input.createdAt,
        updatedAt: null,
      });
      state.activeCount = (state.activeCount || 0) + 1;
    },
    assignTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (task.assignedTo) {
        throw new TaskAlreadyAssignedError(
          `Task ${task.id} is already assigned to ${task.assignedTo}`,
        );
      }
      task.assignedTo = action.input.assignedTo;
      task.status = "IN_PROGRESS";
      task.updatedAt = action.input.updatedAt;
      state.lastProcessedAt = action.input.updatedAt;
    },
    advancePhaseOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (!isWorkable(task.status)) {
        throw new InvalidTaskStatusError(
          `Task ${task.id} is ${task.status}; only PENDING or IN_PROGRESS tasks advance`,
        );
      }
      const handoff = action.input.handoff;
      // A task with no current phase (legacy: created before ADD_TASK checked
      // taskType) cannot advance; COMPLETE_TASK or FAIL_TASK is its exit.
      const current = task.currentPhase;
      if (current === null || handoff.phase !== current) {
        throw new PhaseMismatchError(
          `Handoff is for phase ${handoff.phase} but the task is at ${current}`,
        );
      }
      task.handoffs.push({
        id: handoff.id,
        phase: handoff.phase,
        workDone: handoff.workDone,
        filesModified: handoff.filesModified,
        learnings: [],
        completedAt: handoff.completedAt,
        completedBy: handoff.completedBy || null,
      });
      task.completedPhases.push(current);
      const phaseEntry = state.phaseOrder.find(
        (p) => p.taskType === task.taskType,
      );
      // No phase order (legacy task type): there is no next phase, so it settles.
      const nextPhase = phaseEntry
        ? phaseEntry.phases[phaseEntry.phases.indexOf(current) + 1]
        : undefined;
      if (nextPhase) {
        task.currentPhase = nextPhase;
        task.status = "PENDING";
      } else {
        task.currentPhase = null;
        task.status = "DONE";
        state.completedCount = (state.completedCount || 0) + 1;
        state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
      }
      task.assignedTo = null;
      task.updatedAt = action.input.updatedAt;
      state.lastProcessedAt = action.input.updatedAt;
    },
    completeTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (isTerminal(task.status)) {
        throw new InvalidTaskStatusError(
          `Task ${task.id} is already ${task.status}`,
        );
      }
      task.status = "DONE";
      task.currentPhase = null;
      task.updatedAt = action.input.updatedAt;
      state.completedCount = (state.completedCount || 0) + 1;
      state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
      state.lastProcessedAt = action.input.updatedAt;
    },
    failTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (isTerminal(task.status)) {
        throw new InvalidTaskStatusError(
          `Task ${task.id} is already ${task.status}`,
        );
      }
      task.status = "FAILED";
      task.updatedAt = action.input.updatedAt;
      state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
      state.lastProcessedAt = action.input.updatedAt;
    },
    blockTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (!isWorkable(task.status)) {
        throw new InvalidTaskStatusError(
          `Task ${task.id} is ${task.status}; only PENDING or IN_PROGRESS tasks can be blocked`,
        );
      }
      task.status = "BLOCKED";
      task.updatedAt = action.input.updatedAt;
    },
    unblockTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      if (task.status !== "BLOCKED")
        throw new InvalidTaskStatusError("Task is not blocked");
      task.status = "PENDING";
      task.updatedAt = action.input.updatedAt;
    },
    reconcileCountersOperation(state, action) {
      // Derived counters can drift when history predates the status guards (a live
      // queue reached completedCount 139 for 81 tasks). Recompute both from the
      // tasks — the one source of truth — as an auditable operation.
      state.completedCount = state.tasks.filter(
        (t) => t.status === "DONE",
      ).length;
      state.activeCount = state.tasks.filter(
        (t) =>
          t.status === "PENDING" ||
          t.status === "IN_PROGRESS" ||
          t.status === "BLOCKED",
      ).length;
      state.lastProcessedAt = action.input.updatedAt;
    },
  };
