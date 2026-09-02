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
    """
    The document's kind: bai/knowledge-note, bai/moc, bai/research-claim,
    bai/tension or bai/observation. Tensions and observations are indexed
    so search finds them and a note can show what involves it; they are
    not knowledge nodes and never count as orphans.
    """
    documentType: String
    """
    Incoming knowledge edges (RELATES_TO, BUILDS_ON, …, CORE_IDEA, CHILD_MOC).
    Derived edges (INVOLVES, PROMOTED_TO) are excluded — the same population
    the orphan predicate uses, so inDegree = 0 means "orphan".
    """
    inDegree: Int!
    """Outgoing knowledge edges, same population as inDegree."""
    outDegree: Int!
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
    """Every indexed node, all kinds. Divide by the per-kind counts below."""
    nodeCount: Int!
    """Knowledge edges only (derived INVOLVES / PROMOTED_TO are excluded)."""
    edgeCount: Int!
    """Knowledge nodes (notes, MoCs, research claims) with no incoming knowledge edge."""
    orphanCount: Int!
    noteCount: Int!
    mocCount: Int!
    claimCount: Int!
    tensionCount: Int!
    openTensionCount: Int!
    observationCount: Int!
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
    """did:key of the app instance whose key signed this operation."""
    signerKey: String
    """
    The signature tuple as stored: "timestamp, did:key, actionHash,
    prevStateHash, 0xsig". ECDSA P-256 / SHA-256 over
    "Signed Operation:\n" + len + timestamp + did + hash + prevStateHash.
    Verifiable by any reader with the did:key alone.
    """
    signature: String
    """The action's input, JSON-encoded — what this operation changed."""
    inputJson: String
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
    """Every node of one document type, e.g. "bai/tension"."""
    knowledgeGraphNodesByType(
      driveId: ID!
      documentType: String!
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
    Backfill the graph index by reading every indexed document in the drive
    (knowledge notes, MoCs, research claims, tensions, observations). Use when
    the processor missed historical operations.
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
