import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Unresolved contradiction \u2014 tracks conflicts between knowledge claims with involved references and resolution status",
  extension: "",
  id: "bai/tension",
  name: "Tension",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "Tension lifecycle",
          id: "tension-management",
          name: "tension-management",
          operations: [
            {
              description: "Identify a new contradiction",
              errors: [],
              examples: [],
              id: "create-tension",
              name: "CREATE_TENSION",
              reducer:
                'state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content || null;\nstate.involvedRefs = action.input.involvedRefs;\nstate.status = "OPEN";\nstate.observedAt = action.input.observedAt;\nstate.observedBy = action.input.observedBy || null;',
              schema:
                "input CreateTensionInput {\n    title: String!\n    description: String!\n    content: String\n    involvedRefs: [String!]!\n    observedAt: DateTime!\n    observedBy: String\n}",
              template: "Identify a new contradiction",
              scope: "global",
            },
            {
              description: "Mark as resolved with explanation",
              errors: [
                {
                  code: "TENSION_ALREADY_RESOLVED",
                  description: "Tension is not in OPEN status",
                  id: "err-tension-already-resolved",
                  name: "TensionAlreadyResolvedError",
                  template: "",
                },
              ],
              examples: [],
              id: "resolve-tension",
              name: "RESOLVE_TENSION",
              reducer:
                'if (state.status !== "OPEN") throw new TensionAlreadyResolvedError("Tension is not open");\nstate.status = "RESOLVED";\nstate.resolution = action.input.resolution;\nstate.resolvedAt = action.input.resolvedAt;',
              schema:
                "input ResolveTensionInput {\n    resolution: String!\n    resolvedAt: DateTime!\n}",
              template: "Mark as resolved with explanation",
              scope: "global",
            },
            {
              description: "Mark as dissolved (apparent, not real)",
              errors: [
                {
                  code: "TENSION_ALREADY_RESOLVED",
                  description: "Tension is not in OPEN status",
                  id: "err-tension-already-dissolved",
                  name: "TensionAlreadyResolvedError",
                  template: "",
                },
              ],
              examples: [],
              id: "dissolve-tension",
              name: "DISSOLVE_TENSION",
              reducer:
                'if (state.status !== "OPEN") throw new TensionAlreadyResolvedError("Tension is not open");\nstate.status = "DISSOLVED";\nstate.resolution = action.input.resolution;\nstate.resolvedAt = action.input.resolvedAt;',
              schema:
                "input DissolveTensionInput {\n    resolution: String!\n    resolvedAt: DateTime!\n}",
              template: "Mark as dissolved (apparent, not real)",
              scope: "global",
            },
            {
              description: "Add a note to the tension",
              errors: [],
              examples: [],
              id: "add-involved-ref",
              name: "ADD_INVOLVED_REF",
              reducer:
                "if (!state.involvedRefs.includes(action.input.ref)) {\n    state.involvedRefs.push(action.input.ref);\n}",
              schema: "input AddInvolvedRefInput {\n    ref: String!\n}",
              template: "Add a note to the tension",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "involvedRefs": [],\n    "status": "OPEN",\n    "observedAt": null,\n    "observedBy": null,\n    "resolution": null,\n    "resolvedAt": null\n}',
          schema:
            "enum TensionStatus {\n    OPEN\n    RESOLVED\n    DISSOLVED\n}\n\ntype TensionState {\n    title: String\n    description: String\n    content: String\n    involvedRefs: [String!]!\n    status: TensionStatus\n    observedAt: DateTime\n    observedBy: String\n    resolution: String\n    resolvedAt: DateTime\n}",
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
