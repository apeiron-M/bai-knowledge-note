import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/knowledge-graph",
  name: "KnowledgeGraph",
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  extension: "",
  description:
    "Materialized knowledge graph \u2014 a singleton document per drive that records note nodes and link edges, making the graph queryable via Switchboard without loading every note.",
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
            "type KnowledgeGraphState {\n    nodes: [GraphNode!]!\n    edges: [GraphEdge!]!\n    lastSyncedAt: DateTime\n}\n\ntype GraphNode {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}\n\ntype GraphEdge {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}",
          examples: [],
          initialValue:
            '{\n    "nodes": [],\n    "edges": [],\n    "lastSyncedAt": null\n}',
        },
      },
      modules: [
        {
          id: "nodes-module",
          name: "nodes",
          operations: [
            {
              id: "add-node",
              name: "ADD_NODE",
              scope: "global",
              errors: [
                {
                  id: "err-duplicate-node",
                  code: "DUPLICATE_NODE",
                  name: "DuplicateNodeError",
                  template: "",
                  description: "A node for this document already exists",
                },
              ],
              schema:
                "input AddNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              reducer:
                'const existing = state.nodes.find(n => n.documentId === action.input.documentId);\nif (existing) {\n    throw new DuplicateNodeError("A node for this document already exists");\n}\nstate.nodes.push({\n    id: action.input.id,\n    documentId: action.input.documentId,\n    title: action.input.title || null,\n    noteType: action.input.noteType || null,\n    status: action.input.status || null,\n});',
              examples: [],
              template: "Add a knowledge note as a graph node",
              description: "Add a knowledge note as a graph node",
            },
            {
              id: "remove-node",
              name: "REMOVE_NODE",
              scope: "global",
              errors: [
                {
                  id: "err-node-not-found-remove",
                  code: "NODE_NOT_FOUND",
                  name: "NodeNotFoundError",
                  template: "",
                  description: "No node for this document",
                },
              ],
              schema: "input RemoveNodeInput {\n    documentId: String!\n}",
              reducer:
                'const nodeIndex = state.nodes.findIndex(n => n.documentId === action.input.documentId);\nif (nodeIndex === -1) {\n    throw new NodeNotFoundError("No node for this document");\n}\nstate.nodes.splice(nodeIndex, 1);\nstate.edges = state.edges.filter(e => e.sourceDocumentId !== action.input.documentId && e.targetDocumentId !== action.input.documentId);',
              examples: [],
              template: "Remove a graph node and all its connected edges",
              description: "Remove a graph node and all its connected edges",
            },
            {
              id: "update-node",
              name: "UPDATE_NODE",
              scope: "global",
              errors: [
                {
                  id: "err-node-not-found-update",
                  code: "NODE_NOT_FOUND",
                  name: "NodeNotFoundError",
                  template: "",
                  description: "No node for this document",
                },
              ],
              schema:
                "input UpdateNodeInput {\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              reducer:
                'const node = state.nodes.find(n => n.documentId === action.input.documentId);\nif (!node) {\n    throw new NodeNotFoundError("No node for this document");\n}\nif (action.input.title) node.title = action.input.title;\nif (action.input.noteType) node.noteType = action.input.noteType;\nif (action.input.status) node.status = action.input.status;',
              examples: [],
              template: "Update a graph node's metadata",
              description: "Update a graph node's metadata",
            },
          ],
          description: "Manage graph node entries representing knowledge notes",
        },
        {
          id: "edges-module",
          name: "edges",
          operations: [
            {
              id: "add-edge",
              name: "ADD_EDGE",
              scope: "global",
              errors: [
                {
                  id: "err-duplicate-edge",
                  code: "DUPLICATE_EDGE",
                  name: "DuplicateEdgeError",
                  template: "",
                  description: "This edge already exists",
                },
              ],
              schema:
                "input AddEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}",
              reducer:
                'const existing = state.edges.find(e => e.sourceDocumentId === action.input.sourceDocumentId && e.targetDocumentId === action.input.targetDocumentId && e.linkType === (action.input.linkType || null));\nif (existing) {\n    throw new DuplicateEdgeError("This edge already exists");\n}\nstate.edges.push({\n    id: action.input.id,\n    sourceDocumentId: action.input.sourceDocumentId,\n    targetDocumentId: action.input.targetDocumentId,\n    linkType: action.input.linkType || null,\n});',
              examples: [],
              template: "Add a link between two notes as a graph edge",
              description: "Add a link between two notes as a graph edge",
            },
            {
              id: "remove-edge",
              name: "REMOVE_EDGE",
              scope: "global",
              errors: [
                {
                  id: "err-edge-not-found-remove",
                  code: "EDGE_NOT_FOUND",
                  name: "EdgeNotFoundError",
                  template: "",
                  description: "No edge with this ID",
                },
              ],
              schema: "input RemoveEdgeInput {\n    id: OID!\n}",
              reducer:
                'const index = state.edges.findIndex(e => e.id === action.input.id);\nif (index === -1) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nstate.edges.splice(index, 1);',
              examples: [],
              template: "Remove a graph edge by ID",
              description: "Remove a graph edge by ID",
            },
            {
              id: "update-edge",
              name: "UPDATE_EDGE",
              scope: "global",
              errors: [
                {
                  id: "err-edge-not-found-update",
                  code: "EDGE_NOT_FOUND",
                  name: "EdgeNotFoundError",
                  template: "",
                  description: "No edge with this ID",
                },
              ],
              schema:
                "input UpdateEdgeInput {\n    id: OID!\n    linkType: String\n}",
              reducer:
                'const edge = state.edges.find(e => e.id === action.input.id);\nif (!edge) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nif (action.input.linkType) edge.linkType = action.input.linkType;',
              examples: [],
              template: "Update an edge's link type",
              description: "Update an edge's link type",
            },
          ],
          description:
            "Manage graph edge entries representing links between notes",
        },
        {
          id: "sync-module",
          name: "sync",
          operations: [
            {
              id: "sync-graph",
              name: "SYNC_GRAPH",
              scope: "global",
              errors: [],
              schema:
                "input GraphNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}\n\ninput GraphEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}\n\ninput SyncGraphInput {\n    nodes: [GraphNodeInput!]!\n    edges: [GraphEdgeInput!]!\n    syncedAt: DateTime!\n}",
              reducer:
                "state.nodes = action.input.nodes.map(n => ({\n    id: n.id,\n    documentId: n.documentId,\n    title: n.title || null,\n    noteType: n.noteType || null,\n    status: n.status || null,\n}));\nstate.edges = action.input.edges.map(e => ({\n    id: e.id,\n    sourceDocumentId: e.sourceDocumentId,\n    targetDocumentId: e.targetDocumentId,\n    linkType: e.linkType || null,\n}));\nstate.lastSyncedAt = action.input.syncedAt;",
              examples: [],
              template: "Bulk replace the entire graph state",
              description: "Bulk replace the entire graph state",
            },
          ],
          description: "Bulk graph reconciliation",
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
