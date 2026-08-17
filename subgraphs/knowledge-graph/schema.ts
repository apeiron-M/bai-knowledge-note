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

  """
  A ranked search hit. The 'similarity' field is ALWAYS a 0..1 relevance and
  is always monotonic with the order results are returned in, so it is safe
  to render as a percentage in any mode:
    - SEMANTIC  -> cosine similarity of the query and note embeddings.
    - HYBRID    -> the fused rank score rescaled onto 0..1 (see 'score').
  The 'score' field carries the RAW underlying number for callers doing their
  own maths: cosine in SEMANTIC mode, the Reciprocal Rank Fusion weight in
  HYBRID mode. An RRF weight is ordinal and tops out at ~0.033, so never
  render 'score' as a percentage - use 'similarity'.
  The 'matchedBy' field explains WHY a note matched: "semantic", "keyword",
  or both.
  """
  type SemanticResult {
    node: KnowledgeGraphNode!
    similarity: Float!
    score: Float!
    matchedBy: [String!]!
  }

  type HybridResult {
    node: KnowledgeGraphNode!
    score: Float!
    matchedBy: [String!]!
  }

  enum SearchMode {
    SEMANTIC
    HYBRID
  }

  type UpsertEmbeddingResult {
    documentId: ID!
    ok: Boolean!
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

    knowledgeGraphSimilar(
      driveId: ID!
      documentId: String!
      limit: Int
    ): [SemanticResult!]!
    knowledgeGraphSearchByEmbedding(
      driveId: ID!
      query: String!
      embedding: [Float!]!
      mode: SearchMode!
      limit: Int
    ): [SemanticResult!]!
    """
    Semantic/hybrid search from plain query text — the query is embedded
    SERVER-side, so clients never need the model. Falls back to keyword
    fullSearch transparently when the embedder or embeddings are unavailable,
    so it is always safe to call.
    """
    knowledgeGraphSemanticSearch(
      driveId: ID!
      query: String!
      mode: SearchMode
      limit: Int
    ): [SemanticResult!]!
    knowledgeGraphMissingEmbeddings(driveId: ID!): [ID!]!

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
    """
    Store or update a pre-computed embedding for a document.
    Called by browser clients after running the embedding model locally.
    """
    knowledgeGraphUpsertEmbedding(
      driveId: ID!
      documentId: ID!
      embedding: [Float!]!
    ): UpsertEmbeddingResult!
  }
`;
