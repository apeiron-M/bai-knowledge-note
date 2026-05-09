import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Operational learning signal \u2014 captures friction, surprises, methodology insights, and quality observations from knowledge processing",
  extension: "",
  id: "bai/observation",
  name: "Observation",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "Observation lifecycle",
          id: "observation-management",
          name: "observation-management",
          operations: [
            {
              description: "Capture a new friction signal",
              errors: [],
              examples: [],
              id: "create-observation",
              name: "CREATE_OBSERVATION",
              reducer:
                'state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content || null;\nstate.category = action.input.category;\nstate.status = "PENDING";\nstate.observedAt = action.input.observedAt;\nstate.observedBy = action.input.observedBy || null;',
              schema:
                "input CreateObservationInput {\n    title: String!\n    description: String!\n    content: String\n    category: ObservationCategory!\n    observedAt: DateTime!\n    observedBy: String\n}",
              template: "Capture a new friction signal",
              scope: "global",
            },
            {
              description: "Promote to a permanent note",
              errors: [],
              examples: [],
              id: "promote-observation",
              name: "PROMOTE_OBSERVATION",
              reducer:
                'state.status = "PROMOTED";\nstate.promotedTo = action.input.promotedTo;\nstate.promotedAt = action.input.promotedAt;',
              schema:
                "input PromoteObservationInput {\n    promotedTo: String!\n    promotedAt: DateTime!\n}",
              template: "Promote to a permanent note",
              scope: "global",
            },
            {
              description: "Mark as implemented in system",
              errors: [],
              examples: [],
              id: "implement-observation",
              name: "IMPLEMENT_OBSERVATION",
              reducer: 'state.status = "IMPLEMENTED";',
              schema:
                "input ImplementObservationInput {\n    updatedAt: DateTime!\n}",
              template: "Mark as implemented in system",
              scope: "global",
            },
            {
              description: "Archive observation",
              errors: [],
              examples: [],
              id: "archive-observation",
              name: "ARCHIVE_OBSERVATION",
              reducer: 'state.status = "ARCHIVED";',
              schema:
                "input ArchiveObservationInput {\n    updatedAt: DateTime!\n}",
              template: "Archive observation",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "category": null,\n    "status": "PENDING",\n    "observedAt": null,\n    "observedBy": null,\n    "promotedTo": null,\n    "promotedAt": null\n}',
          schema:
            "enum ObservationCategory {\n    METHODOLOGY\n    PROCESS\n    FRICTION\n    SURPRISE\n    QUALITY\n}\n\nenum ObservationStatus {\n    PENDING\n    PROMOTED\n    IMPLEMENTED\n    ARCHIVED\n}\n\ntype ObservationState {\n    title: String\n    description: String\n    content: String\n    category: ObservationCategory\n    status: ObservationStatus\n    observedAt: DateTime\n    observedBy: String\n    promotedTo: String\n    promotedAt: DateTime\n}",
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
