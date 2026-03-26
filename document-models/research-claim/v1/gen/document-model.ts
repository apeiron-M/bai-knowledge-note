import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/research-claim",
  name: "ResearchClaim",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "rc.phd",
  description:
    "Bundled research claim \u2014 one of 249 interconnected claims about tools for thought, knowledge management, and agent-native cognitive architecture. Read-heavy, populated by maintainers.",
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
            "type ResearchConnection {\n    id: OID!\n    targetRef: String!\n    contextPhrase: String!\n}\n\ntype ResearchClaimState {\n    title: String\n    description: String\n    content: String\n    kind: String\n    methodology: [String!]!\n    sources: [String!]!\n    topics: [String!]!\n    connections: [ResearchConnection!]!\n}",
          examples: [],
          initialValue:
            '{\n    "title": null,\n    "description": null,\n    "content": null,\n    "kind": null,\n    "methodology": [],\n    "sources": [],\n    "topics": [],\n    "connections": []\n}',
        },
      },
      modules: [
        {
          id: "claim-management",
          name: "claim-management",
          description: "Research claim content management",
          operations: [
            {
              id: "create-claim",
              name: "CREATE_CLAIM",
              description: "Create a research claim",
              schema:
                "input CreateClaimInput {\n    title: String!\n    description: String!\n    content: String!\n    kind: String!\n    methodology: [String!]!\n    sources: [String!]!\n    topics: [String!]!\n}",
              template: "Create a research claim",
              reducer:
                "state.title = action.input.title;\nstate.description = action.input.description;\nstate.content = action.input.content;\nstate.kind = action.input.kind;\nstate.methodology = action.input.methodology;\nstate.sources = action.input.sources;\nstate.topics = action.input.topics;",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "add-research-connection",
              name: "ADD_RESEARCH_CONNECTION",
              description: "Add a connection to another research claim",
              schema:
                "input AddResearchConnectionInput {\n    id: OID!\n    targetRef: String!\n    contextPhrase: String!\n}",
              template: "Add a connection to another research claim",
              reducer:
                "state.connections.push({\n    id: action.input.id,\n    targetRef: action.input.targetRef,\n    contextPhrase: action.input.contextPhrase,\n});",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "remove-research-connection",
              name: "REMOVE_RESEARCH_CONNECTION",
              description: "Remove a connection",
              schema: "input RemoveResearchConnectionInput {\n    id: OID!\n}",
              template: "Remove a connection",
              reducer:
                "state.connections = state.connections.filter(c => c.id !== action.input.id);",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "update-claim-content",
              name: "UPDATE_CLAIM_CONTENT",
              description: "Update claim content",
              schema:
                "input UpdateClaimContentInput {\n    content: String!\n}",
              template: "Update claim content",
              reducer: "state.content = action.input.content;",
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
