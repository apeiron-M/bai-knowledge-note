import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  type KnowledgeGraphNode {
    id: String!
    documentId: String!
    title: String
    description: String
    noteType: String
    status: String
    content: String
    author: String
    sourceOrigin: String
    createdAt: String
    topics: [String!]!
    updatedAt: String!
  }

  type KnowledgeGraphEdge {
    id: String!
    sourceDocumentId: String!
    targetDocumentId: String!
    linkType: String
    targetTitle: String
    updatedAt: String!
  }

  type GraphStats {
    nodeCount: Int!
    edgeCount: Int!
    orphanCount: Int!
  }

  type ConnectionResult {
    node: KnowledgeGraphNode!
    depth: Int!
    viaLinkType: String
  }

  type TopicInfo {
    name: String!
    noteCount: Int!
  }

  type RelatedNode {
    node: KnowledgeGraphNode!
    sharedTopics: [String!]!
    sharedTopicCount: Int!
  }

  type Triangle {
    noteA: KnowledgeGraphNode!
    noteB: KnowledgeGraphNode!
    sharedTarget: KnowledgeGraphNode!
  }

  type SemanticResult {
    node: KnowledgeGraphNode!
    similarity: Float!
  }

  type HybridResult {
    node: KnowledgeGraphNode!
    score: Float!
    matchedBy: [String!]!
  }

  type OperationRecord {
    id: String!
    documentId: String!
    operationType: String!
    timestamp: String!
    index: Int!
    scope: String!
    summary: String
    signerAddress: String
    signerApp: String
  }

  type GraphDebugInfo {
    rawNodeCount: Int!
    rawEdgeCount: Int!
    rawNodes: [KnowledgeGraphNode!]!
    rawEdges: [KnowledgeGraphEdge!]!
    processorNamespace: String!
  }

  type ReindexResult {
    indexedNodes: Int!
    indexedEdges: Int!
    errors: [String!]!
  }

  extend type Query {
    knowledgeGraphNodes(driveId: ID!): [KnowledgeGraphNode!]!
    knowledgeGraphEdges(driveId: ID!): [KnowledgeGraphEdge!]!
    knowledgeGraphStats(driveId: ID!): GraphStats!
    knowledgeGraphNodeByDocumentId(
      driveId: ID!
      documentId: String!
    ): KnowledgeGraphNode
    knowledgeGraphOrphans(driveId: ID!): [KnowledgeGraphNode!]!
    knowledgeGraphConnections(
      driveId: ID!
      documentId: String!
      depth: Int
    ): [ConnectionResult!]!
    knowledgeGraphNodesByStatus(
      driveId: ID!
      status: String!
    ): [KnowledgeGraphNode!]!
    knowledgeGraphBacklinks(
      driveId: ID!
      documentId: String!
    ): [KnowledgeGraphEdge!]!
    knowledgeGraphDensity(driveId: ID!): Float!

    knowledgeGraphSearch(
      driveId: ID!
      query: String!
      limit: Int
    ): [KnowledgeGraphNode!]!
    knowledgeGraphTriangles(driveId: ID!, limit: Int): [Triangle!]!
    knowledgeGraphBridges(driveId: ID!): [KnowledgeGraphNode!]!
    knowledgeGraphForwardLinks(
      driveId: ID!
      documentId: String!
    ): [KnowledgeGraphEdge!]!

    knowledgeGraphTopics(driveId: ID!): [TopicInfo!]!
    knowledgeGraphByTopic(driveId: ID!, topic: String!): [KnowledgeGraphNode!]!
    knowledgeGraphRelatedByTopic(
      driveId: ID!
      documentId: String!
      limit: Int
    ): [RelatedNode!]!
    knowledgeGraphFullSearch(
      driveId: ID!
      query: String!
      limit: Int
    ): [KnowledgeGraphNode!]!
    knowledgeGraphByAuthor(
      driveId: ID!
      author: String!
    ): [KnowledgeGraphNode!]!
    knowledgeGraphByOrigin(
      driveId: ID!
      origin: String!
    ): [KnowledgeGraphNode!]!
    knowledgeGraphRecent(
      driveId: ID!
      limit: Int
      since: String
    ): [KnowledgeGraphNode!]!

    knowledgeGraphSemanticSearch(
      driveId: ID!
      query: String!
      limit: Int
    ): [SemanticResult!]!
    knowledgeGraphSimilar(
      driveId: ID!
      documentId: String!
      limit: Int
    ): [SemanticResult!]!
    knowledgeGraphHybridSearch(
      driveId: ID!
      query: String!
      limit: Int
    ): [HybridResult!]!

    knowledgeGraphHistory(
      driveId: ID!
      documentId: String!
      limit: Int
    ): [OperationRecord!]!
    knowledgeGraphActivity(
      driveId: ID!
      limit: Int
      since: String
    ): [OperationRecord!]!
    knowledgeGraphActivityByType(
      driveId: ID!
      operationType: String!
      limit: Int
    ): [OperationRecord!]!
    knowledgeGraphStale(
      driveId: ID!
      since: String!
      limit: Int
    ): [KnowledgeGraphNode!]!

    """
    Debug: raw processor DB tables
    """
    knowledgeGraphDebug(driveId: ID!): GraphDebugInfo!
  }

  extend type Mutation {
    """
    Backfill the graph index by reading all bai/knowledge-note and bai/moc documents
    in the drive. Use when the processor missed historical operations.
    """
    knowledgeGraphReindex(driveId: ID!): ReindexResult!
  }
`;
