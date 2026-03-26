import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/knowledge-graph",
  name: "KnowledgeGraph",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "kg.phd",
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
          description: "Manage graph node entries representing knowledge notes",
          operations: [
            {
              id: "add-node",
              name: "ADD_NODE",
              description: "Add a knowledge note as a graph node",
              schema:
                "input AddNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              template: "Add a knowledge note as a graph node",
              reducer:
                'const existing = state.nodes.find(n => n.documentId === action.input.documentId);\nif (existing) {\n    throw new DuplicateNodeError("A node for this document already exists");\n}\nstate.nodes.push({\n    id: action.input.id,\n    documentId: action.input.documentId,\n    title: action.input.title || null,\n    noteType: action.input.noteType || null,\n    status: action.input.status || null,\n});',
              errors: [
                {
                  id: "err-duplicate-node",
                  name: "DuplicateNodeError",
                  code: "DUPLICATE_NODE",
                  description: "A node for this document already exists",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "remove-node",
              name: "REMOVE_NODE",
              description: "Remove a graph node and all its connected edges",
              schema: "input RemoveNodeInput {\n    documentId: String!\n}",
              template: "Remove a graph node and all its connected edges",
              reducer:
                'const nodeIndex = state.nodes.findIndex(n => n.documentId === action.input.documentId);\nif (nodeIndex === -1) {\n    throw new NodeNotFoundError("No node for this document");\n}\nstate.nodes.splice(nodeIndex, 1);\nstate.edges = state.edges.filter(e => e.sourceDocumentId !== action.input.documentId && e.targetDocumentId !== action.input.documentId);',
              errors: [
                {
                  id: "err-node-not-found-remove",
                  name: "NodeNotFoundError",
                  code: "NODE_NOT_FOUND",
                  description: "No node for this document",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "update-node",
              name: "UPDATE_NODE",
              description: "Update a graph node's metadata",
              schema:
                "input UpdateNodeInput {\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}",
              template: "Update a graph node's metadata",
              reducer:
                'const node = state.nodes.find(n => n.documentId === action.input.documentId);\nif (!node) {\n    throw new NodeNotFoundError("No node for this document");\n}\nif (action.input.title) node.title = action.input.title;\nif (action.input.noteType) node.noteType = action.input.noteType;\nif (action.input.status) node.status = action.input.status;',
              errors: [
                {
                  id: "err-node-not-found-update",
                  name: "NodeNotFoundError",
                  code: "NODE_NOT_FOUND",
                  description: "No node for this document",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "edges-module",
          name: "edges",
          description:
            "Manage graph edge entries representing links between notes",
          operations: [
            {
              id: "add-edge",
              name: "ADD_EDGE",
              description: "Add a link between two notes as a graph edge",
              schema:
                "input AddEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}",
              template: "Add a link between two notes as a graph edge",
              reducer:
                'const existing = state.edges.find(e => e.sourceDocumentId === action.input.sourceDocumentId && e.targetDocumentId === action.input.targetDocumentId && e.linkType === (action.input.linkType || null));\nif (existing) {\n    throw new DuplicateEdgeError("This edge already exists");\n}\nstate.edges.push({\n    id: action.input.id,\n    sourceDocumentId: action.input.sourceDocumentId,\n    targetDocumentId: action.input.targetDocumentId,\n    linkType: action.input.linkType || null,\n});',
              errors: [
                {
                  id: "err-duplicate-edge",
                  name: "DuplicateEdgeError",
                  code: "DUPLICATE_EDGE",
                  description: "This edge already exists",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "remove-edge",
              name: "REMOVE_EDGE",
              description: "Remove a graph edge by ID",
              schema: "input RemoveEdgeInput {\n    id: OID!\n}",
              template: "Remove a graph edge by ID",
              reducer:
                'const index = state.edges.findIndex(e => e.id === action.input.id);\nif (index === -1) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nstate.edges.splice(index, 1);',
              errors: [
                {
                  id: "err-edge-not-found-remove",
                  name: "EdgeNotFoundError",
                  code: "EDGE_NOT_FOUND",
                  description: "No edge with this ID",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
            {
              id: "update-edge",
              name: "UPDATE_EDGE",
              description: "Update an edge's link type",
              schema:
                "input UpdateEdgeInput {\n    id: OID!\n    linkType: String\n}",
              template: "Update an edge's link type",
              reducer:
                'const edge = state.edges.find(e => e.id === action.input.id);\nif (!edge) {\n    throw new EdgeNotFoundError("No edge with this ID");\n}\nif (action.input.linkType) edge.linkType = action.input.linkType;',
              errors: [
                {
                  id: "err-edge-not-found-update",
                  name: "EdgeNotFoundError",
                  code: "EDGE_NOT_FOUND",
                  description: "No edge with this ID",
                  template: "",
                },
              ],
              examples: [],
              scope: "global",
            },
          ],
        },
        {
          id: "sync-module",
          name: "sync",
          description: "Bulk graph reconciliation",
          operations: [
            {
              id: "sync-graph",
              name: "SYNC_GRAPH",
              description: "Bulk replace the entire graph state",
              schema:
                "input GraphNodeInput {\n    id: OID!\n    documentId: String!\n    title: String\n    noteType: String\n    status: String\n}\n\ninput GraphEdgeInput {\n    id: OID!\n    sourceDocumentId: String!\n    targetDocumentId: String!\n    linkType: String\n}\n\ninput SyncGraphInput {\n    nodes: [GraphNodeInput!]!\n    edges: [GraphEdgeInput!]!\n    syncedAt: DateTime!\n}",
              template: "Bulk replace the entire graph state",
              reducer:
                "state.nodes = action.input.nodes.map(n => ({\n    id: n.id,\n    documentId: n.documentId,\n    title: n.title || null,\n    noteType: n.noteType || null,\n    status: n.status || null,\n}));\nstate.edges = action.input.edges.map(e => ({\n    id: e.id,\n    sourceDocumentId: e.sourceDocumentId,\n    targetDocumentId: e.targetDocumentId,\n    linkType: e.linkType || null,\n}));\nstate.lastSyncedAt = action.input.syncedAt;",
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
