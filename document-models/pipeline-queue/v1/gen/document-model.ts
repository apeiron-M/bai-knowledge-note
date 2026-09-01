import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/pipeline-queue",
  name: "PipelineQueue",
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  extension: "",
  description:
    "Processing pipeline state \u2014 singleton document per vault tracking tasks through extract, connect, reweave, and verify phases with handoff protocol.",
  specifications: [
    {
      state: {
        local: {
          schema: "",
          examples: [],
          initialValue: "",
        },
        global: {
          schema:
            "enum TaskStatus {\n    PENDING\n    IN_PROGRESS\n    BLOCKED\n    DONE\n    FAILED\n}\n\nenum LearningCategory {\n    FRICTION\n    SURPRISE\n    METHODOLOGY\n    PROCESS_GAP\n}\n\ntype PhaseLearning {\n    id: OID!\n    category: LearningCategory!\n    description: String!\n}\n\ntype PhaseHandoff {\n    id: OID!\n    phase: String!\n    workDone: String!\n    filesModified: [String!]!\n    learnings: [PhaseLearning!]!\n    completedAt: DateTime!\n    completedBy: String\n}\n\ntype PipelineTask {\n    id: OID!\n    taskType: String!\n    status: TaskStatus!\n    target: String!\n    batchId: String\n    documentRef: String\n    currentPhase: String\n    completedPhases: [String!]!\n    handoffs: [PhaseHandoff!]!\n    assignedTo: String\n    createdAt: DateTime!\n    updatedAt: DateTime\n}\n\ntype PhaseOrderEntry {\n    taskType: String!\n    phases: [String!]!\n}\n\ntype PipelineQueueState {\n    schemaVersion: Int!\n    phaseOrder: [PhaseOrderEntry!]!\n    tasks: [PipelineTask!]!\n    completedCount: Int!\n    activeCount: Int!\n    lastProcessedAt: DateTime\n}",
          examples: [],
          initialValue:
            '{\n    "schemaVersion": 3,\n    "phaseOrder": [\n        { "taskType": "claim", "phases": ["create", "reflect", "reweave", "verify"] },\n        { "taskType": "enrichment", "phases": ["enrich", "reflect", "reweave", "verify"] }\n    ],\n    "tasks": [],\n    "completedCount": 0,\n    "activeCount": 0,\n    "lastProcessedAt": null\n}',
        },
      },
      modules: [
        {
          id: "queue-management",
          name: "queue-management",
          operations: [
            {
              id: "add-task",
              name: "ADD_TASK",
              scope: "global",
              errors: [],
              schema:
                "input AddTaskInput {\n    id: OID!\n    taskType: String!\n    target: String!\n    batchId: String\n    documentRef: String\n    currentPhase: String\n    createdAt: DateTime!\n}",
              reducer:
                'const phaseEntry = state.phaseOrder.find(p => p.taskType === action.input.taskType);\nconst firstPhase = action.input.currentPhase || (phaseEntry ? phaseEntry.phases[0] : null);\nstate.tasks.push({\n    id: action.input.id,\n    taskType: action.input.taskType,\n    status: "PENDING",\n    target: action.input.target,\n    batchId: action.input.batchId || null,\n    documentRef: action.input.documentRef || null,\n    currentPhase: firstPhase || null,\n    completedPhases: [],\n    handoffs: [],\n    assignedTo: null,\n    createdAt: action.input.createdAt,\n    updatedAt: null,\n});\nstate.activeCount = (state.activeCount || 0) + 1;',
              examples: [],
              template: "Add a new task to the pipeline",
              description: "Add a new task to the pipeline",
            },
            {
              id: "assign-task",
              name: "ASSIGN_TASK",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-assign",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
              ],
              schema:
                "input AssignTaskInput {\n    taskId: OID!\n    assignedTo: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.assignedTo = action.input.assignedTo;\ntask.status = "IN_PROGRESS";\ntask.updatedAt = action.input.updatedAt;\nstate.lastProcessedAt = action.input.updatedAt;',
              examples: [],
              template: "Assign task to a processor or user",
              description: "Assign task to a processor or user",
            },
            {
              id: "advance-phase",
              name: "ADVANCE_PHASE",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-advance",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
              ],
              schema:
                "input PhaseHandoffInput {\n    id: OID!\n    phase: String!\n    workDone: String!\n    filesModified: [String!]!\n    completedAt: DateTime!\n    completedBy: String\n}\n\ninput AdvancePhaseInput {\n    taskId: OID!\n    handoff: PhaseHandoffInput!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\nconst handoff = action.input.handoff;\ntask.handoffs.push({\n    id: handoff.id,\n    phase: handoff.phase,\n    workDone: handoff.workDone,\n    filesModified: handoff.filesModified,\n    learnings: [],\n    completedAt: handoff.completedAt,\n    completedBy: handoff.completedBy || null,\n});\nif (task.currentPhase) {\n    task.completedPhases.push(task.currentPhase);\n}\nconst phaseEntry = state.phaseOrder.find(p => p.taskType === task.taskType);\nif (phaseEntry) {\n    const currentIdx = phaseEntry.phases.indexOf(task.currentPhase || "");\n    const nextPhase = phaseEntry.phases[currentIdx + 1];\n    if (nextPhase) {\n        task.currentPhase = nextPhase;\n        task.status = "PENDING";\n    } else {\n        task.currentPhase = null;\n        task.status = "DONE";\n        state.completedCount = (state.completedCount || 0) + 1;\n        state.activeCount = Math.max(0, (state.activeCount || 0) - 1);\n    }\n}\ntask.assignedTo = null;\ntask.updatedAt = action.input.updatedAt;\nstate.lastProcessedAt = action.input.updatedAt;',
              examples: [],
              template: "Complete current phase, advance to next",
              description: "Complete current phase, advance to next",
            },
            {
              id: "complete-task",
              name: "COMPLETE_TASK",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-complete",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
              ],
              schema:
                "input CompleteTaskInput {\n    taskId: OID!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "DONE";\ntask.currentPhase = null;\ntask.updatedAt = action.input.updatedAt;\nstate.completedCount = (state.completedCount || 0) + 1;\nstate.activeCount = Math.max(0, (state.activeCount || 0) - 1);\nstate.lastProcessedAt = action.input.updatedAt;',
              examples: [],
              template: "Mark task as done",
              description: "Mark task as done",
            },
            {
              id: "fail-task",
              name: "FAIL_TASK",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-fail",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
              ],
              schema:
                "input FailTaskInput {\n    taskId: OID!\n    reason: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "FAILED";\ntask.updatedAt = action.input.updatedAt;\nstate.activeCount = Math.max(0, (state.activeCount || 0) - 1);\nstate.lastProcessedAt = action.input.updatedAt;',
              examples: [],
              template: "Mark task as failed",
              description: "Mark task as failed",
            },
            {
              id: "block-task",
              name: "BLOCK_TASK",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-block",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
              ],
              schema:
                "input BlockTaskInput {\n    taskId: OID!\n    reason: String!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\ntask.status = "BLOCKED";\ntask.updatedAt = action.input.updatedAt;',
              examples: [],
              template: "Mark task as blocked",
              description: "Mark task as blocked",
            },
            {
              id: "unblock-task",
              name: "UNBLOCK_TASK",
              scope: "global",
              errors: [
                {
                  id: "err-task-not-found-unblock",
                  code: "TASK_NOT_FOUND",
                  name: "TaskNotFoundError",
                  template: "",
                  description: "Task not found",
                },
                {
                  id: "err-invalid-task-status",
                  code: "INVALID_TASK_STATUS",
                  name: "InvalidTaskStatusError",
                  template: "",
                  description: "Task is not in the expected status",
                },
              ],
              schema:
                "input UnblockTaskInput {\n    taskId: OID!\n    updatedAt: DateTime!\n}",
              reducer:
                'const task = state.tasks.find(t => t.id === action.input.taskId);\nif (!task) throw new TaskNotFoundError("Task not found");\nif (task.status !== "BLOCKED") throw new InvalidTaskStatusError("Task is not blocked");\ntask.status = "PENDING";\ntask.updatedAt = action.input.updatedAt;',
              examples: [],
              template: "Unblock a task",
              description: "Unblock a task",
            },
          ],
          description: "Pipeline task lifecycle and phase progression",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
