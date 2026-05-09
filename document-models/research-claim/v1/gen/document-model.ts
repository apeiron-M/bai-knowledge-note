import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Bundled research claim \u2014 one of 249 interconnected claims about tools for thought, knowledge management, and agent-native cognitive architecture. Read-heavy, populated by maintainers",
  extension: "",
  id: "bai/research-claim",
  name: "ResearchClaim",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "Research claim content management",
          id: "claim-management",
          name: "claim-management",
          operations: [
            {
              description: "Create a research claim",
              errors: [],
              examples: [],
              id: "create-claim",
              name: "CREATE_CLAIM",
              reducer:
                "state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content;\nstate.kind = action.input.kind;\nstate.methodology = action.input.methodology;\nstate.sources = action.input.sources;\nstate.topics = action.input.topics;",
              schema:
                "input CreateClaimInput {\n    title: String!\n    description: String!\n    content: String!\n    kind: String!\n    methodology: [String!]!\n    sources: [String!]!\n    topics: [String!]!\n}",
              template: "Create a research claim",
              scope: "global",
            },
            {
              description: "Add a connection to another research claim",
              errors: [],
              examples: [],
              id: "add-research-connection",
              name: "ADD_RESEARCH_CONNECTION",
              reducer:
                "state.connections.push({\n    id: action.input.id,\n    targetRef: action.input.targetRef,\n    contextPhrase: action.input.contextPhrase,\n});",
              schema:
                "input AddResearchConnectionInput {\n    id: OID!\n    targetRef: String!\n    contextPhrase: String!\n}",
              template: "Add a connection to another research claim",
              scope: "global",
            },
            {
              description: "Remove a connection",
              errors: [],
              examples: [],
              id: "remove-research-connection",
              name: "REMOVE_RESEARCH_CONNECTION",
              reducer:
                "state.connections = state.connections.filter(c => c.id !== action.input.id);",
              schema: "input RemoveResearchConnectionInput {\n    id: OID!\n}",
              template: "Remove a connection",
              scope: "global",
            },
            {
              description: "Update claim content",
              errors: [],
              examples: [],
              id: "update-claim-content",
              name: "UPDATE_CLAIM_CONTENT",
              reducer: "state.content = action.input.content;",
              schema:
                "input UpdateClaimContentInput {\n    content: String!\n}",
              template: "Update claim content",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "kind": null,\n    "methodology": [],\n    "sources": [],\n    "topics": [],\n    "connections": []\n}',
          schema:
            "type ResearchConnection {\n    id: OID!\n    targetRef: String!\n    contextPhrase: String!\n}\n\ntype ResearchClaimState {\n    title: String\n    description: String\n    content: String\n    kind: String\n    methodology: [String!]!\n    sources: [String!]!\n    topics: [String!]!\n    connections: [ResearchConnection!]!\n}",
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
