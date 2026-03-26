import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/tension",
  name: "Tension",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "ten.phd",
  description:
    "Unresolved contradiction \u2014 tracks conflicts between knowledge claims with involved references and resolution status.",
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
            "enum TensionStatus {\n    OPEN\n    RESOLVED\n    DISSOLVED\n}\n\ntype TensionState {\n    title: String\n    description: String\n    content: String\n    involvedRefs: [String!]!\n    status: TensionStatus\n    observedAt: DateTime\n    observedBy: String\n    resolution: String\n    resolvedAt: DateTime\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "involvedRefs": [],\n    "status": "OPEN",\n    "observedAt": null,\n    "observedBy": null,\n    "resolution": null,\n    "resolvedAt": null\n}',
        },
      },
      modules: [
        {
          id: "tension-management",
          name: "tension-management",
          description: "Tension lifecycle",
          operations: [
            {
              id: "create-tension",
              name: "CREATE_TENSION",
              description: "Identify a new contradiction",
              schema:
                "input CreateTensionInput {\n    title: String!\n    description: String!\n    content: String\n    involvedRefs: [String!]!\n    observedAt: DateTime!\n    observedBy: String\n}",
              template: "Identify a new contradiction",
              reducer:
                'state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content || null;\nstate.involvedRefs = action.input.involvedRefs;\nstate.status = "OPEN";\nstate.observedAt = action.input.observedAt;\nstate.observedBy = action.input.observedBy || null;',
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "resolve-tension",
              name: "RESOLVE_TENSION",
              description: "Mark as resolved with explanation",
              schema:
                "input ResolveTensionInput {\n    resolution: String!\n    resolvedAt: DateTime!\n}",
              template: "Mark as resolved with explanation",
              reducer:
                'if (state.status !== "OPEN") throw new TensionAlreadyResolvedError("Tension is not open");\nstate.status = "RESOLVED";\nstate.resolution = action.input.resolution;\nstate.resolvedAt = action.input.resolvedAt;',
              errors: [
                {
                  id: "err-tension-already-resolved",
                  name: "TensionAlreadyResolvedError",
                  code: "TENSION_ALREADY_RESOLVED",
                  description: "Tension is not in OPEN status",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "dissolve-tension",
              name: "DISSOLVE_TENSION",
              description: "Mark as dissolved (apparent, not real)",
              schema:
                "input DissolveTensionInput {\n    resolution: String!\n    resolvedAt: DateTime!\n}",
              template: "Mark as dissolved (apparent, not real)",
              reducer:
                'if (state.status !== "OPEN") throw new TensionAlreadyResolvedError("Tension is not open");\nstate.status = "DISSOLVED";\nstate.resolution = action.input.resolution;\nstate.resolvedAt = action.input.resolvedAt;',
              errors: [
                {
                  id: "err-tension-already-dissolved",
                  name: "TensionAlreadyResolvedError",
                  code: "TENSION_ALREADY_RESOLVED",
                  description: "Tension is not in OPEN status",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "add-involved-ref",
              name: "ADD_INVOLVED_REF",
              description: "Add a note to the tension",
              schema: "input AddInvolvedRefInput {\n    ref: String!\n}",
              template: "Add a note to the tension",
              reducer:
                "if (!state.involvedRefs.includes(action.input.ref)) {\n    state.involvedRefs.push(action.input.ref);\n}",
              errors: [],
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
