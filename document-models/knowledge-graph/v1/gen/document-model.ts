import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "BAI",
    website: "https://bai.powerhouse.io/",
  },
  description:
    "Materialized knowledge graph \u2014 a singleton document per drive that records note nodes and link edges, making the graph queryable via Switchboard without loading every note",
  extension: "",
  id: "bai/knowledge-graph",
  name: "KnowledgeGraph",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "Manage graph node entries representing knowledge notes",
          id: "nodes-module",
          name: "nodes",
          operations: [
            {
              description: "Add a knowledge note as a graph node",
              errors: [
                {
                  code: "DUPLICATE_NODE",
                  description: "A node for this document already exists",
                  id: "err-duplicate-node",
                  name: "DuplicateNodeError",
                  template: "",
                },
              ],
              examples: [],
              id: "add-node",
              name: "ADD_NODE",
              reducer:
                'const existing = state.nodes.find(n => n.documentId === action.input.documentId);\nif (existing) {\n    throw new DuplicateNodeError("A node for this document already exists");\n}\nstate.nodes.push({\n    id: action.input.id,\n    documentId: action.input.documentId,\n    title: action.input.title || null,\n    noteType: action.input.noteType || null,\n    status: action.input.status || null,\n});',
              schema:
                "input AddNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              template: "Add a knowledge note as a graph node",
              scope: "global",
            },
            {
              description: "Remove a graph node and all its connected edges",
              errors: [
                {
                  code: "NODE_NOT_FOUND",
                  description: "No node for this document",
                  id: "err-node-not-found-remove",
                  name: "NodeNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "remove-node",
              name: "REMOVE_NODE",
              reducer:
                'const nodeIndex = state.nodes.findIndex(n => n.documentId === action.input.documentId);\nif (nodeIndex === -1) {\n    throw new NodeNotFoundError("No node for this document");\n}\nstate.nodes.splice(nodeIndex, 1);\nstate.edges = state.edges.filter(e => e.sourceDocumentId !== action.input.documentId && e.targetDocumentId !== action.input.documentId);',
              schema: "input RemoveNodeInput {\n    documentId: String!\n}",
              template: "Remove a graph node and all its connected edges",
              scope: "global",
            },
            {
              description: "Update a graph node's metadata",
              errors: [
                {
                  code: "NODE_NOT_FOUND",
                  description: "No node for this document",
                  id: "err-node-not-found-update",
                  name: "NodeNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "update-node",
              name: "UPDATE_NODE",
              reducer:
                'const node = state.nodes.find(n => n.documentId === action.input.documentId);\nif (!node) {\n    throw new NodeNotFoundError("No node for this document");\n}\nif (action.input.title) node.title = action.input.title;\nif (action.input.noteType) node.noteType = action.input.noteType;\nif (action.input.status) node.status = action.input.status;',
              schema:
                "input UpdateNodeInput {\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              template: "Update a graph node's metadata",
              scope: "global",
            },
          ],
        },
        {
          description:
            "Manage graph edge entries representing links between notes",
          id: "edges-module",
          name: "edges",
          operations: [
            {
              description: "Add a link between two notes as a graph edge",
              errors: [
                {
                  code: "DUPLICATE_EDGE",
                  description: "This edge already exists",
                  id: "err-duplicate-edge",
                  name: "DuplicateEdgeError",
                  template: "",
                },
              ],
              examples: [],
              id: "add-edge",
              name: "ADD_EDGE",
              reducer:
                'const existing = state.edges.find(e => e.sourceDocumentId === action.input.sourceDocumentId && e.targetDocumentId === action.input.targetDocumentId && e.linkType === (action.input.linkType || null));\nif (existing) {\n    throw new DuplicateEdgeError("This edge already exists");\n}\nstate.edges.push({\n    id: action.input.id,\n    sourceDocumentId: action.input.sourceDocumentId,\n    targetDocumentId: action.input.targetDocumentId,\n    linkType: action.input.linkType || null,\n});',
              schema:
                "input AddEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}",
              template: "Add a link between two notes as a graph edge",
              scope: "global",
            },
            {
              description: "Remove a graph edge by ID",
              errors: [
                {
                  code: "EDGE_NOT_FOUND",
                  description: "No edge with this ID",
                  id: "err-edge-not-found-remove",
                  name: "EdgeNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "remove-edge",
              name: "REMOVE_EDGE",
              reducer:
                'const index = state.edges.findIndex(e => e.id === action.input.id);\nif (index === -1) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nstate.edges.splice(index, 1);',
              schema: "input RemoveEdgeInput {\n    id: OID!\n}",
              template: "Remove a graph edge by ID",
              scope: "global",
            },
            {
              description: "Update an edge's link type",
              errors: [
                {
                  code: "EDGE_NOT_FOUND",
                  description: "No edge with this ID",
                  id: "err-edge-not-found-update",
                  name: "EdgeNotFoundError",
                  template: "",
                },
              ],
              examples: [],
              id: "update-edge",
              name: "UPDATE_EDGE",
              reducer:
                'const edge = state.edges.find(e => e.id === action.input.id);\nif (!edge) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nif (action.input.linkType) edge.linkType = action.input.linkType;',
              schema:
                "input UpdateEdgeInput {\n    id: OID!\n    linkType: String\n}",
              template: "Update an edge's link type",
              scope: "global",
            },
          ],
        },
        {
          description: "Bulk graph reconciliation",
          id: "sync-module",
          name: "sync",
          operations: [
            {
              description: "Bulk replace the entire graph state",
              errors: [],
              examples: [],
              id: "sync-graph",
              name: "SYNC_GRAPH",
              reducer:
                "state.nodes = action.input.nodes.map(n => ({\n    id: n.id,\n    documentId: n.documentId,\n    title: n.title || null,\n    noteType: n.noteType || null,\n    status: n.status || null,\n}));\nstate.edges = action.input.edges.map(e => ({\n    id: e.id,\n    sourceDocumentId: e.sourceDocumentId,\n    targetDocumentId: e.targetDocumentId,\n    linkType: e.linkType || null,\n}));\nstate.lastSyncedAt = action.input.syncedAt;",
              schema:
                "input GraphNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}\n\ninput GraphEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}\n\ninput SyncGraphInput {\n    nodes: [GraphNodeInput!]!\n    edges: [GraphEdgeInput!]!\n    syncedAt: DateTime!\n}",
              template: "Bulk replace the entire graph state",
              scope: "global",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '{\n    "nodes": [],\n    "edges": [],\n    "lastSyncedAt": null\n}',
          schema:
            "type KnowledgeGraphState {\n    nodes: [GraphNode!]!\n    edges: [GraphEdge!]!\n    lastSyncedAt: DateTime\n}\n\ntype GraphNode {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}\n\ntype GraphEdge {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}",
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
