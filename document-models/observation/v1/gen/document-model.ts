import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/observation",
  name: "Observation",
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  extension: "",
  description:
    "Operational learning signal \u2014 captures friction, surprises, methodology insights, and quality observations from knowledge processing.",
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
            "enum ObservationCategory {\n    METHODOLOGY\n    PROCESS\n    FRICTION\n    SURPRISE\n    QUALITY\n}\n\nenum ObservationStatus {\n    PENDING\n    PROMOTED\n    IMPLEMENTED\n    ARCHIVED\n}\n\ntype ObservationState {\n    title: String\n    description: String\n    content: String\n    category: ObservationCategory\n    status: ObservationStatus\n    observedAt: DateTime\n    observedBy: String\n    promotedTo: String\n    promotedAt: DateTime\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "category": null,\n    "status": "PENDING",\n    "observedAt": null,\n    "observedBy": null,\n    "promotedTo": null,\n    "promotedAt": null\n}',
        },
      },
      modules: [
        {
          id: "observation-management",
          name: "observation-management",
          description: "Observation lifecycle",
          operations: [
            {
              id: "create-observation",
              name: "CREATE_OBSERVATION",
              description: "Capture a new friction signal",
              schema:
                "input CreateObservationInput {\n    title: String!\n    description: String!\n    content: String\n    category: ObservationCategory!\n    observedAt: DateTime!\n    observedBy: String\n}",
              template: "Capture a new friction signal",
              reducer:
                'state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content || null;\nstate.category = action.input.category;\nstate.status = "PENDING";\nstate.observedAt = action.input.observedAt;\nstate.observedBy = action.input.observedBy || null;',
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "promote-observation",
              name: "PROMOTE_OBSERVATION",
              description: "Promote to a permanent note",
              schema:
                "input PromoteObservationInput {\n    promotedTo: String!\n    promotedAt: DateTime!\n}",
              template: "Promote to a permanent note",
              reducer:
                'if (state.status !== "PENDING") {\n  throw new InvalidObservationTransitionError(\n    `Only a PENDING observation can be promoted (status is ${state.status})`,\n  );\n}\nstate.status = "PROMOTED";\nstate.promotedTo = action.input.promotedTo;\nstate.promotedAt = action.input.promotedAt;',
              errors: [
                {
                  id: "err-invalid-transition-promote",
                  name: "InvalidObservationTransitionError",
                  code: "INVALID_OBSERVATION_TRANSITION",
                  description: "Only a PENDING observation can be promoted",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "implement-observation",
              name: "IMPLEMENT_OBSERVATION",
              description: "Mark as implemented in system",
              schema:
                "input ImplementObservationInput {\n    updatedAt: DateTime!\n}",
              template: "Mark as implemented in system",
              reducer:
                'if (state.status !== "PROMOTED") {\n  throw new InvalidObservationTransitionError(\n    `Only a PROMOTED observation can be implemented (status is ${state.status})`,\n  );\n}\nstate.status = "IMPLEMENTED";',
              errors: [
                {
                  id: "err-invalid-transition-implement",
                  name: "InvalidObservationTransitionError",
                  code: "INVALID_OBSERVATION_TRANSITION",
                  description: "Only a PROMOTED observation can be implemented",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "archive-observation",
              name: "ARCHIVE_OBSERVATION",
              description: "Archive observation",
              schema:
                "input ArchiveObservationInput {\n    updatedAt: DateTime!\n}",
              template: "Archive observation",
              reducer:
                'if (state.status === "ARCHIVED") {\n  throw new InvalidObservationTransitionError("Observation is already archived");\n}\nstate.status = "ARCHIVED";',
              errors: [
                {
                  id: "err-invalid-transition-archive",
                  name: "InvalidObservationTransitionError",
                  code: "INVALID_OBSERVATION_TRANSITION",
                  description: "Observation is already archived",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
