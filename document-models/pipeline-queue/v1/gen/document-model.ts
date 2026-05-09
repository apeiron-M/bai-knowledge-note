import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Processing pipeline state \u2014 singleton document per vault tracking tasks through extract, connect, reweave, and verify phases with handoff protocol",
  extension: "",
  id: "bai/pipeline-queue",
  name: "PipelineQueue",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "Pipeline task lifecycle and phase progression",
          id: "queue-management",
          name: "queue-management",
          operations: [
            {
              description: "Add a new task to the pipeline",
              errors: [],
              examples: [],
              id: "add-task",
              name: "ADD_TASK",
              reducer:
                'const phaseEntry = state.phaseOrder.find(p => p.taskType === action.input.taskType);\nconst firstPhase = action.input.currentPhase || (phaseEntry ? phaseEntry.phases[0] : null);\nstate.tasks.push({\n    id: action.input.id,\n    taskType: action.input.taskType,\n    status: "PENDING",\n    target: action.input.target,\n    batchId: action.input.batchId || null,\n    documentRef: action.input.documentRef || null,\n    currentPhase: firstPhase || null,\n    completedPhases: [],\n    handoffs: [],\n    assignedTo: null,\n    createdAt: action.input.createdAt,\n    updatedAt: null,\n});\nstate.activeCount = (state.activeCount || 0) + 1;',
              schema:
                "input AddTaskInput {\n    id: OID!\n    taskType: String!\n    target: String!\n    batchId: String\n    documentRef: String\n    currentPhase: String\n    createdAt: DateTime!\n}",
              template: "Add a new task to the pipeline",
              scope: "global",
            },
            {
              description: "Assign task to a processor or user",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-assign",
                  name: "TaskNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "assign-task",
              name: "ASSIGN_TASK",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.assignedTo = action.input.assignedTo;\ntask.status = "IN_PROGRESS";\ntask.updatedAt = action.input.updatedAt;\nstate.lastProcessedAt = action.input.updatedAt;',
              schema:
                "input AssignTaskInput {\n    taskId: OID!\n    assignedTo: String!\n    updatedAt: DateTime!\n}",
              template: "Assign task to a processor or user",
              scope: "global",
            },
            {
              description: "Complete current phase, advance to next",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-advance",
                  name: "TaskNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "advance-phase",
              name: "ADVANCE_PHASE",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\nconst handoff = action.input.handoff;\ntask.handoffs.push({\n    id: handoff.id,\n    phase: handoff.phase,\n    workDone: handoff.workDone,\n    filesModified: handoff.filesModified,\n    learnings: [],\n    completedAt: handoff.completedAt,\n    completedBy: handoff.completedBy || null,\n});\nif (task.currentPhase) {\n    task.completedPhases.push(task.currentPhase);\n}\nconst phaseEntry = state.phaseOrder.find(p => p.taskType === task.taskType);\nif (phaseEntry) {\n    const currentIdx = phaseEntry.phases.indexOf(task.currentPhase || "");\n    const nextPhase = phaseEntry.phases[currentIdx + 1];\n    if (nextPhase) {\n        task.currentPhase = nextPhase;\n        task.status = "PENDING";\n    } else {\n        task.currentPhase = null;\n        task.status = "DONE";\n        state.completedCount = (state.completedCount || 0) + 1;\n        state.activeCount = Math.max(0, (state.activeCount || 0) - 1);\n    }\n}\ntask.assignedTo = null;\ntask.updatedAt = action.input.updatedAt;\nstate.lastProcessedAt = action.input.updatedAt;',
              schema:
                "input PhaseHandoffInput {\n    id: OID!\n    phase: String!\n    workDone: String!\n    filesModified: [String!]!\n    completedAt: DateTime!\n    completedBy: String\n}\n\ninput AdvancePhaseInput {\n    taskId: OID!\n    handoff: PhaseHandoffInput!\n    updatedAt: DateTime!\n}",
              template: "Complete current phase, advance to next",
              scope: "global",
            },
            {
              description: "Mark task as done",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-complete",
                  name: "TaskNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "complete-task",
              name: "COMPLETE_TASK",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "DONE";\ntask.currentPhase = null;\ntask.updatedAt = action.input.updatedAt;\nstate.completedCount = (state.completedCount || 0) + 1;\nstate.activeCount = Math.max(0, (state.activeCount || 0) - 1);\nstate.lastProcessedAt = action.input.updatedAt;',
              schema:
                "input CompleteTaskInput {\n    taskId: OID!\n    updatedAt: DateTime!\n}",
              template: "Mark task as done",
              scope: "global",
            },
            {
              description: "Mark task as failed",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-fail",
                  name: "TaskNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "fail-task",
              name: "FAIL_TASK",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "FAILED";\ntask.updatedAt = action.input.updatedAt;\nstate.activeCount = Math.max(0, (state.activeCount || 0) - 1);\nstate.lastProcessedAt = action.input.updatedAt;',
              schema:
                "input FailTaskInput {\n    taskId: OID!\n    reason: String!\n    updatedAt: DateTime!\n}",
              template: "Mark task as failed",
              scope: "global",
            },
            {
              description: "Mark task as blocked",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-block",
                  name: "TaskNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "block-task",
              name: "BLOCK_TASK",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "BLOCKED";\ntask.updatedAt = action.input.updatedAt;',
              schema:
                "input BlockTaskInput {\n    taskId: OID!\n    reason: String!\n    updatedAt: DateTime!\n}",
              template: "Mark task as blocked",
              scope: "global",
            },
            {
              description: "Unblock a task",
              errors: [
                {
                  code: "TASK_NOT_FOUND",
                  description: "Task not found",
                  id: "err-task-not-found-unblock",
                  name: "TaskNotFoundError",
                  template: "",
                },
                {
                  code: "INVALID_TASK_STATUS",
                  description: "Task is not in the expected status",
                  id: "err-invalid-task-status",
                  name: "InvalidTaskStatusError",
                  template: "",
                },
              ],
              examples: [],
              id: "unblock-task",
              name: "UNBLOCK_TASK",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\nif (task.status !== "BLOCKED") throw new InvalidTaskStatusError("Task is not blocked");\ntask.status = "PENDING";\ntask.updatedAt = action.input.updatedAt;',
              schema:
                "input UnblockTaskInput {\n    taskId: OID!\n    updatedAt: DateTime!\n}",
              template: "Unblock a task",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "schemaVersion": 3,\n    "phaseOrder": [\n        { "taskType": "claim", "phases": ["create", "reflect", "reweave", "verify"] },\n        { "taskType": "enrichment", "phases": ["enrich", "reflect", "reweave", "verify"] }\n    ],\n    "tasks": [],\n    "completedCount": 0,\n    "activeCount": 0,\n    "lastProcessedAt": null\n}',
          schema:
            "enum TaskStatus {\n    PENDING\n    IN_PROGRESS\n    BLOCKED\n    DONE\n    FAILED\n}\n\nenum LearningCategory {\n    FRICTION\n    SURPRISE\n    METHODOLOGY\n    PROCESS_GAP\n}\n\ntype PhaseLearning {\n    id: OID!\n    category: LearningCategory!\n    description: String!\n}\n\ntype PhaseHandoff {\n    id: OID!\n    phase: String!\n    workDone: String!\n    filesModified: [String!]!\n    learnings: [PhaseLearning!]!\n    completedAt: DateTime!\n    completedBy: String\n}\n\ntype PipelineTask {\n    id: OID!\n    taskType: String!\n    status: TaskStatus!\n    target: String!\n    batchId: String\n    documentRef: String\n    currentPhase: String\n    completedPhases: [String!]!\n    handoffs: [PhaseHandoff!]!\n    assignedTo: String\n    createdAt: DateTime!\n    updatedAt: DateTime\n}\n\ntype PhaseOrderEntry {\n    taskType: String!\n    phases: [String!]!\n}\n\ntype PipelineQueueState {\n    schemaVersion: Int!\n    phaseOrder: [PhaseOrderEntry!]!\n    tasks: [PipelineTask!]!\n    completedCount: Int!\n    activeCount: Int!\n    lastProcessedAt: DateTime\n}",
        },
        local: {
          examples: [],
          initialValue: "",
          schema: "",
        },
      },
      version: 1,
    },
  ],
};
