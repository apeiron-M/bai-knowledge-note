import type { PipelineQueueQueueManagementOperations } from "document-models/pipeline-queue/v1";
import {
  InvalidTaskStatusError,
  TaskNotFoundError,
} from "../../gen/queue-management/error.js";

export const pipelineQueueQueueManagementOperations: PipelineQueueQueueManagementOperations =
  {
    addTaskOperation(state, action) {
      const phaseEntry = state.phaseOrder.find(
        (p) => p.taskType === action.input.taskType,
      );
      const firstPhase =
        action.input.currentPhase || (phaseEntry ? phaseEntry.phases[0] : null);
      state.tasks.push({
        id: action.input.id,
        taskType: action.input.taskType,
        status: "PENDING",
        target: action.input.target,
        batchId: action.input.batchId || null,
        documentRef: action.input.documentRef || null,
        currentPhase: firstPhase || null,
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
      task.assignedTo = action.input.assignedTo;
      task.status = "IN_PROGRESS";
      task.updatedAt = action.input.updatedAt;
      state.lastProcessedAt = action.input.updatedAt;
    },
    advancePhaseOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
      const handoff = action.input.handoff;
      task.handoffs.push({
        id: handoff.id,
        phase: handoff.phase,
        workDone: handoff.workDone,
        filesModified: handoff.filesModified,
        learnings: [],
        completedAt: handoff.completedAt,
        completedBy: handoff.completedBy || null,
      });
      if (task.currentPhase) {
        task.completedPhases.push(task.currentPhase);
      }
      const phaseEntry = state.phaseOrder.find(
        (p) => p.taskType === task.taskType,
      );
      if (phaseEntry) {
        const currentIdx = phaseEntry.phases.indexOf(task.currentPhase || "");
        const nextPhase = phaseEntry.phases[currentIdx + 1];
        if (nextPhase) {
          task.currentPhase = nextPhase;
          task.status = "PENDING";
        } else {
          task.currentPhase = null;
          task.status = "DONE";
          state.completedCount = (state.completedCount || 0) + 1;
          state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
        }
      }
      task.assignedTo = null;
      task.updatedAt = action.input.updatedAt;
      state.lastProcessedAt = action.input.updatedAt;
    },
    completeTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
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
      task.status = "FAILED";
      task.updatedAt = action.input.updatedAt;
      state.activeCount = Math.max(0, (state.activeCount || 0) - 1);
      state.lastProcessedAt = action.input.updatedAt;
    },
    blockTaskOperation(state, action) {
      const task = state.tasks.find((t) => t.id === action.input.taskId);
      if (!task) throw new TaskNotFoundError("Task not found");
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
  };
