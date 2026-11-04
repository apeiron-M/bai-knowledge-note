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
    """
    When the document entered this vault: its header's creation time.
    createdAt is when it was written, which for an imported note can be
    weeks earlier. Null until the document's next operation or a reindex
    on an index that predates the field.
    """
    addedAt: String
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
    """
    Why this edge exists — the articulation test in data. Set through the
    relationship's metadata (ADD_RELATIONSHIP / UPDATE_RELATIONSHIP with
    { reason, confidence }); null for edges never articulated.
    """
    reason: String
    """grounded | established | speculative — the author's confidence in the link."""
    confidence: String
    """The full relationship metadata object as stored, serialized."""
    metadataJson: String
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
    """Scope-of-work documents (projects live inside them as envelopes)."""
    scopeCount: Int!
    """Work breakdowns — the goal trees that deliver envelopes."""
    wbsCount: Int!
    """Knowledge edges carrying a reason. Coverage = this / edgeCount."""
    articulatedEdgeCount: Int!
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
  One edge, always written source -> target so there is no direction to
  decode. Carries the articulation ('reason') when the link has one.
  """
  type GraphVia {
    from: String!
    fromTitle: String
    to: String!
    toTitle: String
    linkType: String
    reason: String
    confidence: String
  }

  """
  A node one link away from a search hit. This is what turns a result list
  into a map: the searcher sees not just which notes match, but what those
  notes connect to and how.
  """
  type GraphNeighbour {
    documentId: String!
    title: String
    description: String
    noteType: String
    status: String
    documentType: String
    """How many of this search's hits touch this node. Convergence is signal."""
    hitCount: Int!
    """Rank within this response. Not comparable across responses."""
    score: Float!
    """The edges that reached it, narrowed to this hit."""
    via: [GraphVia!]!
  }

  """
  A ranked search hit. 'similarity' is the cosine similarity of the query and
  note embeddings — a true 0..1 relevance, safe to compare, threshold and
  render as a percentage. 'score' carries the same number for callers doing
  their own maths. 'matchedBy' is always ["semantic"].
  """
  type SemanticResult {
    node: KnowledgeGraphNode!
    similarity: Float!
    score: Float!
    matchedBy: [String!]!
    """
    Nodes one knowledge link from this hit, ranked. Costs no extra query per
    hit — the whole result set's neighbourhood is read once and sliced — but
    it IS two extra queries for the search as a whole, so it is only computed
    when selected.

    Ordering is global across the result set: a node that several hits point
    at sorts above one that only this hit points at. Empty on hits from
    'knowledgeGraphSimilar' and 'knowledgeGraphSearchByEmbedding', which do
    not expand.
    """
    related(limit: Int): [GraphNeighbour!]!
    """
    Edges from this hit to OTHER hits in the same result set.

    These can never appear in 'related', which by definition excludes nodes
    that are themselves hits — and that exclusion is exactly wrong for
    correctness. Semantic search naturally returns both sides of a
    disagreement, so the CONTRADICTS edge joining two hits is invisible
    without this field: a reader sees two confident claims and no sign that
    one disputes the other.

    Written source -> target like every other edge; the same hit-to-hit edge
    is reported on BOTH of its ends. Shares the neighbourhood 'related'
    reads, so selecting both costs no more than selecting one.
    """
    linkedHits: [GraphVia!]!
  }

  type HybridResult {
    node: KnowledgeGraphNode!
    score: Float!
    matchedBy: [String!]!
  }

  enum SearchMode {
    SEMANTIC
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

  """What changed in a window — see knowledgeGraphChanges."""
  type KnowledgeGraphChangeDigest {
    window: KnowledgeGraphChangeWindow!
    """The scope as asked (q is echoed, not the ids it resolved to)."""
    scope: KnowledgeGraphChangeScope!
    totals: KnowledgeGraphChangeTotals!
    """Every group with at least one event, most significant first; never paged."""
    groups: [KnowledgeGraphChangeGroup!]!
    """Present whenever a scope is given (moc, topic, documentIds, q); paged by limit/cursor."""
    events: [KnowledgeGraphChangeEvent!]
    nextCursor: String
    """
    What the vault knows now that it did not before, by the hub's main areas —
    the semantic layer to lead an answer with. Restricted to the scope when one is given.
    Absent on a cursor page (the first page carried it).
    """
    story: KnowledgeGraphChangeStory
    """
    For a q or topic scope: the scope's claims as the vault held them at since, versus now
    ("now" is the current state, even for a past until). Absent on a cursor page.
    """
    thenVsNow: KnowledgeGraphThenVsNow
  }

  type KnowledgeGraphChangeStory {
    growth: KnowledgeGraphChangeGrowth!
    "Main areas (the hub's CHILD_MOC maps) with any change, most changed first; Elsewhere (id null) last."
    areas: [KnowledgeGraphChangeArea!]!
  }

  type KnowledgeGraphChangeGrowth {
    "Live notes (not archived) at since."
    notesThen: Int!
    "Live notes now."
    notesNow: Int!
    "When since predates the vault's first recorded activity: that activity; growth is counted from it (notesThen is then 0 because the vault did not exist yet)."
    from: String
    newAreas: [KnowledgeGraphChangeMapRef!]!
    newMaps: [KnowledgeGraphChangeNewMap!]!
  }

  type KnowledgeGraphChangeMapRef {
    id: String!
    title: String!
  }

  type KnowledgeGraphChangeNewMap {
    id: String!
    title: String!
    "The title of the main area the map falls under."
    area: String
  }

  type KnowledgeGraphChangeArea {
    "Null for Elsewhere: notes in no main area."
    id: String
    title: String!
    notesThen: Int!
    notesNow: Int!
    "How many notes are new in the area (uncapped; newClaims shows at most 8)."
    newCount: Int!
    "How many claims shifted in the area (uncapped; changedClaims shows at most 8)."
    changedCount: Int!
    "How many notes retired in the area (uncapped; retiredClaims shows at most 5)."
    retiredCount: Int!
    "Supersessions that merged twin notes (same claim written twice): counted, never listed as changed."
    mergedCount: Int!
    "The git refs of the area's sources: as they stood at since (else first ingested) → latest. Null when they carry none."
    versions: KnowledgeGraphChangeVersions
    "Notes created in the window, most connected first (at most 8); a note that replaced another is its shift's now, not new."
    newClaims: [KnowledgeGraphChangeClaim!]!
    "Claims the vault now states differently (at most 8)."
    changedClaims: [KnowledgeGraphChangeShift!]!
    "Notes archived in the window, still archived, and never replaced (at most 5)."
    retiredClaims: [KnowledgeGraphChangeClaim!]!
  }

  type KnowledgeGraphChangeClaim {
    documentId: String!
    "The note's title: the claim."
    claim: String!
    "The note's description."
    gist: String
    "On a then-claim of a note created in the window: when its first recorded state was written."
    thenAt: String
  }

  type KnowledgeGraphChangeVersions {
    first: String
    now: String
  }

  type KnowledgeGraphChangeClaimText {
    claim: String!
    gist: String
  }

  type KnowledgeGraphChangeShift {
    documentId: String!
    then: KnowledgeGraphChangeClaimText!
    now: KnowledgeGraphChangeClaimText!
    "The SUPERSEDES reason, or the revision-history line added in the window."
    why: String
    "The replacing note, for a supersession."
    replacedBy: String
    "For a note created in the window: when its first recorded state (the then) was written."
    thenAt: String
  }

  type KnowledgeGraphThenVsNow {
    "Claims as they stood at since that read differently now or are gone (at most 12)."
    then: [KnowledgeGraphChangeClaim!]!
    "Claims as they stand now that read differently at since or are new (at most 12)."
    now: [KnowledgeGraphChangeClaim!]!
    "Claims held at since and now in the same words, listed once (at most 12)."
    unchanged: [KnowledgeGraphChangeClaim!]!
  }

  type KnowledgeGraphChangeWindow {
    since: String!
    until: String!
    "The vault's first recorded activity (its earliest operation or note creation); null on a cursor page or an empty vault."
    vaultStart: String
  }

  type KnowledgeGraphChangeScope {
    moc: String
    topic: String
    documentIds: [String!]
    q: String
    types: [String!]
    "What q resolved to: the whole vault (it named the hub or the drive), a map whose title it names, else a semantic search."
    resolved: KnowledgeGraphChangeResolvedScope
  }

  type KnowledgeGraphChangeResolvedScope {
    "vault | areas | moc | search"
    kind: String!
    "The map, when kind is moc; title is also the hub's or drive's name, when kind is vault."
    id: String
    title: String
    "The search, when kind is search: the query and how many hits it started from (their linked notes join them)."
    query: String
    hits: Int
    "The main areas the query matched, best first, when kind is areas (a map below an area stands in for it when it matched far better)."
    areas: [KnowledgeGraphChangeMapRef!]
  }

  type KnowledgeGraphChangeTotals {
    created: Int!
    revised: Int!
    superseded: Int!
    archived: Int!
    reverified: Int!
    sourcesRevised: Int!
    sourcesAdded: Int!
    "Distinct documents with at least one event."
    documents: Int!
    "Operations in the window, in scope."
    operations: Int!
  }

  type KnowledgeGraphChangeGroup {
    key: String!
    "moc | topic | folder | unplaced"
    kind: String!
    id: String
    title: String!
    totals: KnowledgeGraphChangeTotals!
    "At most five, most significant first."
    highlights: [KnowledgeGraphChangeEvent!]!
  }

  type KnowledgeGraphChangeEvent {
    """
    created | revised | superseded | archived | restored | approved |
    reverified | source-added | source-revised | source-archived | source-deleted
    """
    kind: String!
    documentId: String!
    documentType: String!
    title: String!
    at: String!
    by: String
    significance: Int!
    fields: KnowledgeGraphChangeFields
    "Lines added under the note's '## Revision history' in the window."
    revisionNotes: [String!]
    supersededBy: KnowledgeGraphChangeSupersededBy
    version: KnowledgeGraphChangeVersion
    comment: String
    source: KnowledgeGraphChangeSource
    derivedFrom: [String!]
    "Other operations on the document, counted by type, not listed."
    folded: [KnowledgeGraphChangeCount!]!
  }

  type KnowledgeGraphChangeFields {
    title: KnowledgeGraphFieldChange
    description: KnowledgeGraphFieldChange
    content: KnowledgeGraphContentChange
  }

  "before is null when the field was not set before the window."
  type KnowledgeGraphFieldChange {
    before: String
    after: String!
  }

  type KnowledgeGraphContentChange {
    "The earlier text, its first 400 characters (the hunks carry the diff)."
    before: String
    "Up to six, each at most 400 characters: '-' removed lines, '+' added lines."
    hunks: [String!]!
    "Lines added and removed; a line that only moved is not counted."
    added: Int!
    removed: Int!
  }

  type KnowledgeGraphChangeSupersededBy {
    documentId: String!
    title: String!
    reason: String
  }

  type KnowledgeGraphChangeVersion {
    before: String
    after: String!
  }

  type KnowledgeGraphChangeSource {
    refBefore: String
    refAfter: String
    url: String
    "Lines added; null when the earlier text was never recorded (run the history backfill)."
    added: Int
    "Lines removed; null when the earlier text was never recorded."
    removed: Int
    hunks: [String!]!
    "The first 20 notes derived from the source."
    noteIds: [String!]!
    "How many notes derive from the source."
    noteCount: Int!
  }

  type KnowledgeGraphChangeCount {
    operationType: String!
    count: Int!
  }

  type SourceHistoryBackfill {
    "Sources whose log was read."
    sources: Int!
    "Other indexed documents whose log was read (all: true only)."
    documents: Int!
    inserted: Int!
    skipped: Int!
    errors: [String!]!
  }

  """
  One addition to the vault: what a person added at once — a file's folder,
  a pasted source or a sources/batch call, a workflow's burst, an agent's
  session — or notes that arrived without a source (written here, imported,
  or with no recorded source), grouped the same way.
  """
  type KnowledgeGraphTimelineAddition {
    id: String!
    "file, text, feed, agent; or, for notes without a source: written (made in the vault), imported (an import), unsourced (no source recorded)"
    kind: String!
    "The folder's name, or the source's title"
    title: String!
    folderId: String
    "When its first source entered the vault (header creation time)"
    addedAt: String!
    lastAddedAt: String!
    "Who added its first source: the source's createdBy, which any reader of the source document already sees"
    addedBy: String
    fileName: String
    mimeType: String
    sizeBytes: Float
    method: String
    tool: String
    url: String
    sourceType: String
    sources: Int!
    extracted: Int!
    "INBOX and EXTRACTING: still to be read"
    waiting: Int!
    archived: Int!
    sourceIds: [String!]!
    notes: Int!
    firstNoteAt: String
    lastNoteAt: String
    "The earliest written date of its notes, when a day or more before it was added"
    writtenFrom: String
    "The topics it started: MoCs most of whose notes came from it and that did not exist before it; a MoC with no such majority goes to the latest addition at or before it"
    topicIds: [String!]!
    "Knowledge links (relates to, builds on, contradicts, supersedes) among its own notes"
    linksWithin: Int!
    "Knowledge links between its notes and notes of earlier additions"
    linksToEarlier: Int!
    earlier: [KnowledgeGraphTimelineEarlier!]!
    tags: [KnowledgeGraphTimelineTag!]!
    "Its most linked notes"
    topNotes: [KnowledgeGraphTimelineNoteRef!]!
    "Its first sources by arrival (at most 5), to open one directly; the rest are in its folder"
    firstSources: [KnowledgeGraphTimelineSourceRef!]!
  }

  type KnowledgeGraphTimelineSourceRef {
    documentId: String!
    title: String!
  }

  type KnowledgeGraphTimelineEarlier {
    additionId: String!
    links: Int!
  }

  type KnowledgeGraphTimelineTag {
    name: String!
    count: Int!
  }

  type KnowledgeGraphTimelineNoteRef {
    documentId: String!
    title: String!
  }

  "A note's arrival: addedAt falls back to writtenAt on an index that predates added_at"
  type KnowledgeGraphTimelineArrival {
    documentId: String!
    addedAt: String
    writtenAt: String
    additionId: String
  }

  type KnowledgeGraphTimelineTopic {
    documentId: String!
    title: String!
    addedAt: String
    writtenAt: String
    additionId: String
  }

  type KnowledgeGraphTimelineTotals {
    sources: Int!
    notes: Int!
    topics: Int!
    links: Int!
  }

  "A source as the Sources list shows it: its row in the index, never its text."
  type KnowledgeGraphSourceRow {
    documentId: ID!
    "The drive folder it sits in."
    parentFolder: ID
    name: String
    title: String!
    description: String
    status: String!
    sourceType: String
    author: String
    url: String
    "When it entered the vault."
    addedAt: String!
    "The state's createdAt: one instant for every source of a batch."
    createdAt: String
    createdBy: String
    updatedAt: String
    extractedAt: String
    publishedAt: String
    "The original file's attachment ref."
    originalFile: String
    originalFileName: String
    originalAttachedAt: String
    originalSizeBytes: Float
    "How many notes it says it became."
    claimCount: Int!
  }

  "What was added to the vault, when, and what each addition became."
  type KnowledgeGraphSourceTimeline {
    additions: [KnowledgeGraphTimelineAddition!]!
    notes: [KnowledgeGraphTimelineArrival!]!
    topics: [KnowledgeGraphTimelineTopic!]!
    totals: KnowledgeGraphTimelineTotals!
  }

  extend type Query {
    knowledgeGraphNodes(driveId: ID!): [KnowledgeGraphNode!]!
    knowledgeGraphEdges(driveId: ID!): [KnowledgeGraphEdge!]!
    """
    The source timeline: every addition (a file's folder, a paste, a
    workflow's burst, an agent's session) with when it arrived and what it
    became, plus each note's and topic's arrival. Sources are read from the
    reactor; notes, topics and links from the index.
    """
    knowledgeGraphSourceTimeline(driveId: ID!): KnowledgeGraphSourceTimeline!
    """
    Every source of the vault as a list row, in one answer: read from the
    index's kept rows, so the Sources view paints at once instead of reading
    each source document. Sources the index has no current row for are read
    once and kept.
    """
    knowledgeGraphSources(driveId: ID!): [KnowledgeGraphSourceRow!]!
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

    """
    Keyword search on title + description. ARCHIVED notes are excluded —
    they are no longer held as current — unless includeArchived is true.
    """
    knowledgeGraphSearch(
      driveId: ID!
      query: String!
      limit: Int
      includeArchived: Boolean
    ): [KnowledgeGraphNode!]!
    knowledgeGraphTriangles(driveId: ID!, limit: Int): [Triangle!]!
    knowledgeGraphBridges(driveId: ID!): [KnowledgeGraphNode!]!
    knowledgeGraphForwardLinks(
      driveId: ID!
      documentId: String!
    ): [KnowledgeGraphEdge!]!

    knowledgeGraphTopics(driveId: ID!): [TopicInfo!]!
    knowledgeGraphByTopic(
      driveId: ID!
      topic: String!
      includeArchived: Boolean
    ): [KnowledgeGraphNode!]!
    knowledgeGraphRelatedByTopic(
      driveId: ID!
      documentId: String!
      limit: Int
      includeArchived: Boolean
    ): [RelatedNode!]!
    knowledgeGraphFullSearch(
      driveId: ID!
      query: String!
      limit: Int
      includeArchived: Boolean
    ): [KnowledgeGraphNode!]!
    knowledgeGraphByAuthor(
      driveId: ID!
      author: String!
    ): [KnowledgeGraphNode!]!
    knowledgeGraphByOrigin(
      driveId: ID!
      origin: String!
    ): [KnowledgeGraphNode!]!
    """
    The most recently edited nodes, newest first. 'since' is an ISO instant
    and filters on the same edit time, so a note created long ago but
    changed today is included. The mirror of knowledgeGraphStale.
    """
    knowledgeGraphRecent(
      driveId: ID!
      limit: Int
      since: String
    ): [KnowledgeGraphNode!]!

    knowledgeGraphSimilar(
      driveId: ID!
      documentId: String!
      limit: Int
      includeArchived: Boolean
    ): [SemanticResult!]!
    knowledgeGraphSearchByEmbedding(
      driveId: ID!
      query: String!
      embedding: [Float!]!
      mode: SearchMode!
      limit: Int
      includeArchived: Boolean
    ): [SemanticResult!]!
    """
    Semantic search from plain query text — the query is embedded
    SERVER-side, so clients never need the model. Falls back to keyword
    fullSearch transparently when the embedder or embeddings are unavailable,
    so it is always safe to call.

    Select 'related' on the result to get each hit's neighbourhood in the
    same round trip. A flat hit list hides most of what the vault knows
    about a question: the notes that match are a small fraction of the
    notes connected to them.
    """
    knowledgeGraphSemanticSearch(
      driveId: ID!
      query: String!
      mode: SearchMode
      limit: Int
      includeArchived: Boolean
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
    What changed in the drive between since and until (ISO dates, UTC; a
    date-only until covers that whole day; until defaults to now): totals,
    then groups by map (or topic) with up to five highlights each — the
    executive summary. Give a scope (moc, topic, q, documentIds) to also get
    the events, paged by limit (default 50, max 200) and cursor. q is a
    semantic search: its top 10 hits plus their one-hop neighbours. Readers
    of the drive may ask.
    """
    knowledgeGraphChanges(
      driveId: ID!
      since: String!
      until: String
      moc: String
      topic: String
      q: String
      documentIds: [String!]
      types: [String!]
      limit: Int
      cursor: String
    ): KnowledgeGraphChangeDigest!

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
    Record the drive's source operations (ingestions, status changes,
    extracted claims) in the operation history, read from each source's
    log. With all: true, also every global operation of every indexed
    document — an index recorded before change history lost each document's
    first operations, so its change digest misses their baselines.
    Idempotent; no reindex. Needed once on an index built before source
    operations were recorded. Requires ADMIN of the drive (canManage).
    """
    knowledgeGraphBackfillSourceHistory(driveId: ID!, all: Boolean): SourceHistoryBackfill!
  }
`;
