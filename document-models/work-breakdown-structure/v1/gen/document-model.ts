import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/wbs",
  name: "Work Breakdown Structure",
  author: {
    name: "BAI",
    website: "",
  },
  extension: "",
  description:
    "A hierarchy of goals for a project: statuses, assignees, dependencies, block reasons, outcomes and notes. No automatic cascades \u2014 every change is an explicit operation.",
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
            "type WorkBreakdownStructureState {\n  projectRef: PHID\n  owner: String\n  goals: [Goal!]!\n  references: [URL!]!\n}\n\ntype Goal {\n  id: OID!\n  description: String!\n  status: GoalStatus!\n  parentId: OID\n  assignee: String\n  dependencies: [OID!]!\n  blockReason: String\n  outcome: String\n  notes: [Note!]!\n}\nenum GoalStatus { TODO IN_PROGRESS BLOCKED IN_REVIEW COMPLETED WONT_DO }\n\ntype Note { id: OID!  note: String!  author: String  timestamp: DateTime }",
          examples: [],
          initialValue:
            '{\n  "projectRef": null,\n  "owner": null,\n  "goals": [],\n  "references": []\n}',
        },
      },
      modules: [
        {
          id: "a49c5eb9-4b91-41c9-a157-07a4ed5b8423",
          name: "goals",
          operations: [
            {
              id: "7c4e4ed3-3ab3-4d81-b45c-f6b8861c2921",
              name: "CREATE_GOAL",
              scope: "global",
              errors: [
                {
                  id: "765c8f8a-869e-426c-9a0b-5f7116c72c1a",
                  code: "DUPLICATE_GOAL_ID",
                  name: "DuplicateGoalIdError",
                  template: "",
                  description: "A goal with this id already exists",
                },
                {
                  id: "347ba1d9-a516-484d-b031-73392f4a1a73",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description:
                    "Referenced goal (parent or insertBefore) not found",
                },
              ],
              schema:
                "input CreateGoalInput {\n  id: OID!\n  description: String!\n  parentId: OID\n  assignee: String\n  insertBefore: OID\n}",
              reducer:
                'if (state.goals.some((g) => g.id === action.input.id))\n  throw new DuplicateGoalIdError("Goal id already exists");\nconst parentId = action.input.parentId || null;\nif (parentId && !state.goals.some((g) => g.id === parentId))\n  throw new GoalNotFoundError("Parent goal not found");\nlet index = state.goals.length;\nif (action.input.insertBefore) {\n  const i = state.goals.findIndex(\n    (g) => g.id === action.input.insertBefore,\n  );\n  if (i === -1)\n    throw new GoalNotFoundError("insertBefore goal not found");\n  index = i;\n}\nstate.goals.splice(index, 0, {\n  id: action.input.id,\n  description: action.input.description,\n  status: "TODO",\n  parentId,\n  assignee: action.input.assignee || null,\n  dependencies: [],\n  blockReason: null,\n  outcome: null,\n  notes: [],\n});\nstate.goals = rebuildDepthFirst(state.goals);',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "afe8fed8-8aba-4e3e-9169-f6488cc976e4",
              name: "UPDATE_GOAL_DESCRIPTION",
              scope: "global",
              errors: [
                {
                  id: "ce5d06e2-b8ee-4b8c-a060-3cfc2630c02b",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
              ],
              schema:
                "input UpdateGoalDescriptionInput {\n  id: OID!\n  description: String!\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\ng.description = action.input.description;',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "0af59923-0f59-4dd5-895e-74a345298ea3",
              name: "DELETE_GOAL",
              scope: "global",
              errors: [
                {
                  id: "2e9c5b30-5b3e-482b-bb29-95ca3457ada9",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
              ],
              schema: "input DeleteGoalInput {\n  id: OID!\n}",
              reducer:
                'if (!state.goals.some((g) => g.id === action.input.id))\n  throw new GoalNotFoundError("Goal not found");\nconst removed = collectSubtreeIds(state.goals, action.input.id);\nstate.goals = state.goals.filter((g) => !removed.has(g.id));\nfor (const g of state.goals)\n  g.dependencies = g.dependencies.filter((d) => !removed.has(d));',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "d9382ebd-fd23-44d4-8f3d-5b437fac9141",
              name: "REORDER",
              scope: "global",
              errors: [
                {
                  id: "46a3e981-bc47-47d0-9b86-3ace45805452",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description:
                    "No goal with this id (or insertBefore target missing)",
                },
                {
                  id: "3aabeea7-3c79-4ba6-adf5-87a2b2760394",
                  code: "INVALID_PARENT",
                  name: "InvalidParentError",
                  template: "",
                  description:
                    "parentId is the goal itself or one of its descendants",
                },
              ],
              schema:
                "input ReorderInput {\n  id: OID!\n  parentId: OID\n  insertBefore: OID\n}",
              reducer:
                'const goal = state.goals.find((g) => g.id === action.input.id);\nif (!goal) throw new GoalNotFoundError("Goal not found");\nconst parentId = action.input.parentId || null;\nif (parentId) {\n  if (!state.goals.some((g) => g.id === parentId))\n    throw new GoalNotFoundError("Parent goal not found");\n  if (\n    parentId === goal.id ||\n    collectSubtreeIds(state.goals, goal.id).has(parentId)\n  )\n    throw new InvalidParentError(\n      "Cannot move a goal under itself or its descendant",\n    );\n}\ngoal.parentId = parentId;\nconst without = state.goals.filter((g) => g.id !== goal.id);\nlet index = without.length;\nif (action.input.insertBefore) {\n  const i = without.findIndex(\n    (g) => g.id === action.input.insertBefore,\n  );\n  if (i === -1)\n    throw new GoalNotFoundError("insertBefore goal not found");\n  index = i;\n}\nwithout.splice(index, 0, goal);\nstate.goals = rebuildDepthFirst(without);',
              examples: [],
              template: "",
              description: "",
            },
          ],
          description: "",
        },
        {
          id: "7ce6ed86-ee47-43c2-97bb-572a669399f4",
          name: "workflow",
          operations: [
            {
              id: "3d240e26-9f98-4a19-b7fd-93fa1de01dbe",
              name: "SET_GOAL_STATUS",
              scope: "global",
              errors: [
                {
                  id: "99a43dc6-6c3b-4221-8554-8ab932ae6dd6",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
                {
                  id: "e9a71559-22e3-4437-8106-714754b47d74",
                  code: "MISSING_BLOCK_REASON",
                  name: "MissingBlockReasonError",
                  template: "",
                  description:
                    "status BLOCKED requires a non-empty blockReason",
                },
              ],
              schema:
                "input SetGoalStatusInput {\n  id: OID!\n  status: GoalStatus!\n  blockReason: String\n  outcome: String\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\nif (\n  action.input.status === "BLOCKED" &&\n  !action.input.blockReason?.trim()\n)\n  throw new MissingBlockReasonError("BLOCKED requires a blockReason");\ng.status = action.input.status;\ng.blockReason =\n  action.input.status === "BLOCKED"\n    ? (action.input.blockReason ?? null)\n    : null;\nif (action.input.outcome) g.outcome = action.input.outcome;',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "201c41e4-4110-4ba4-b884-8d1679b10ecc",
              name: "ASSIGN_GOAL",
              scope: "global",
              errors: [
                {
                  id: "d1a94956-d3f2-4ac4-ba5e-bc6d073ae49e",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
              ],
              schema:
                "input AssignGoalInput {\n  id: OID!\n  assignee: String\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\ng.assignee = action.input.assignee || null;',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "2c8a2b29-e552-45dd-93f5-a641ecc48988",
              name: "SET_OUTCOME",
              scope: "global",
              errors: [
                {
                  id: "b20750e9-2ab2-4b6d-8487-70d3786d886b",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
              ],
              schema:
                "input SetOutcomeInput {\n  id: OID!\n  outcome: String\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\ng.outcome = action.input.outcome || null;',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "b98bf4e4-6a6c-429d-9ae2-b0b88df2f436",
              name: "ADD_DEPENDENCIES",
              scope: "global",
              errors: [
                {
                  id: "3948cfb9-8cd1-449d-a70d-53791edb84a0",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
                {
                  id: "fea19ce8-d82e-49d4-9343-41f3e2ad707e",
                  code: "DEPENDENCY_NOT_FOUND",
                  name: "DependencyNotFoundError",
                  template: "",
                  description: "A dependency id does not exist in this WBS",
                },
                {
                  id: "12a79d6e-a535-4a80-b27b-75b05b9cf7b6",
                  code: "INVALID_DEPENDENCY",
                  name: "InvalidDependencyError",
                  template: "",
                  description: "A goal cannot depend on itself",
                },
              ],
              schema:
                "input AddDependenciesInput {\n  id: OID!\n  dependencies: [OID!]!\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\nfor (const dep of action.input.dependencies) {\n  if (dep === g.id)\n    throw new InvalidDependencyError("Goal cannot depend on itself");\n  if (!state.goals.some((o) => o.id === dep))\n    throw new DependencyNotFoundError("Dependency goal not found");\n}\nfor (const dep of action.input.dependencies)\n  if (!g.dependencies.includes(dep)) g.dependencies.push(dep);',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "71093ee9-296e-49a5-82bb-14cefad54a6c",
              name: "REMOVE_DEPENDENCIES",
              scope: "global",
              errors: [
                {
                  id: "9e41e077-6b08-4c90-9270-6e40853d42d3",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
              ],
              schema:
                "input RemoveDependenciesInput {\n  id: OID!\n  dependencies: [OID!]!\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.id);\nif (!g) throw new GoalNotFoundError("Goal not found");\ng.dependencies = g.dependencies.filter(\n  (d) => !action.input.dependencies.includes(d),\n);',
              examples: [],
              template: "",
              description: "",
            },
          ],
          description: "",
        },
        {
          id: "a7ed5310-8a96-4994-b9b2-46ec8387b55d",
          name: "documentation",
          operations: [
            {
              id: "20c1a11e-c18c-410a-b8c9-39fe97d9ffc2",
              name: "ADD_NOTE",
              scope: "global",
              errors: [
                {
                  id: "d0d8a7ee-c43d-423e-bdf1-bc06f6d29635",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
                {
                  id: "129f3507-4728-46c9-843a-4d6746bd484d",
                  code: "DUPLICATE_NOTE_ID",
                  name: "DuplicateNoteIdError",
                  template: "",
                  description: "A note with this id already exists on the goal",
                },
              ],
              schema:
                "input AddNoteInput {\n  goalId: OID!\n  noteId: OID!\n  note: String!\n  author: String\n  timestamp: DateTime\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.goalId);\nif (!g) throw new GoalNotFoundError("Goal not found");\nif (g.notes.some((n) => n.id === action.input.noteId))\n  throw new DuplicateNoteIdError("Note id already exists");\ng.notes.push({\n  id: action.input.noteId,\n  note: action.input.note,\n  author: action.input.author || null,\n  timestamp: action.input.timestamp || null,\n});',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "70155f53-98c5-46f1-a3fa-a14969a459d8",
              name: "REMOVE_NOTE",
              scope: "global",
              errors: [
                {
                  id: "304f31ca-b5a6-4643-8257-c33758b419c0",
                  code: "GOAL_NOT_FOUND",
                  name: "GoalNotFoundError",
                  template: "",
                  description: "No goal with this id",
                },
                {
                  id: "4863735a-8983-4beb-8cbb-7a6b175238cc",
                  code: "NOTE_NOT_FOUND",
                  name: "NoteNotFoundError",
                  template: "",
                  description: "No note with this id on the goal",
                },
              ],
              schema:
                "input RemoveNoteInput {\n  goalId: OID!\n  noteId: OID!\n}",
              reducer:
                'const g = state.goals.find((g) => g.id === action.input.goalId);\nif (!g) throw new GoalNotFoundError("Goal not found");\nconst i = g.notes.findIndex((n) => n.id === action.input.noteId);\nif (i === -1) throw new NoteNotFoundError("Note not found");\ng.notes.splice(i, 1);',
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "fa0ada57-a2f5-4375-9893-e9c4228944c0",
              name: "SET_OWNER",
              scope: "global",
              errors: [],
              schema: "input SetOwnerInput {\n  owner: String\n}",
              reducer: "state.owner = action.input.owner || null;",
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "2d49ad46-e71b-4386-9d82-3edf305f9723",
              name: "SET_REFERENCES",
              scope: "global",
              errors: [],
              schema: "input SetReferencesInput {\n  references: [URL!]!\n}",
              reducer: "state.references = action.input.references;",
              examples: [],
              template: "",
              description: "",
            },
            {
              id: "1585d77e-abc0-4c09-a808-128202edf3f7",
              name: "SET_PROJECT_REF",
              scope: "global",
              errors: [],
              schema: "input SetProjectRefInput {\n  projectRef: PHID\n}",
              reducer: "state.projectRef = action.input.projectRef || null;",
              examples: [],
              template: "",
              description: "",
            },
          ],
          description: "",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
