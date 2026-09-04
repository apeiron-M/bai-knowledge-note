export interface GraphNode {
  id: string;
  document_id: string;
  title: string | null;
  description: string | null;
  note_type: string | null;
  status: string | null;
  content: string | null;
  author: string | null;
  source_origin: string | null;
  created_at: string | null;
  updated_at: string;
  /**
   * The document's type — `bai/knowledge-note`, `bai/moc`, `bai/tension`,
   * `bai/observation`, `bai/research-claim`, `powerhouse/scopeofwork`,
   * `bai/wbs` (see `project.ts`). Nullable only because rows
   * written before the column existed are backfilled by the migration from
   * the MoC status sentinel; the processor always sets it.
   */
  document_type: string | null;
}

export interface GraphTopic {
  id: string;
  document_id: string;
  name: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  source_document_id: string;
  target_document_id: string;
  link_type: string | null;
  target_title: string | null;
  updated_at: string;
  /**
   * The reactor's `DocumentRelationship.metadata`, serialized — see
   * `edge-metadata.ts` for the shape the vault gives it (`reason`,
   * `confidence`). Null for edges that were never articulated.
   */
  metadata: string | null;
}

export interface GraphOperation {
  id: string;
  document_id: string;
  operation_type: string;
  timestamp: string;
  index: number;
  scope: string;
  summary: string | null;
  input_json: string | null;
  signer_address: string | null;
  signer_app: string | null;
  /** did:key of the app instance that signed the operation, if signed. */
  signer_key: string | null;
  /**
   * The serialized signature tuple (`timestamp, did, hash, prevStateHash,
   * sig`) exactly as the reactor stores it — enough for a reader to verify
   * the operation without trusting this projection.
   */
  signature: string | null;
}

export interface NoteEmbedding {
  document_id: string;
  /** JSON-encoded number[] (normalized). bytea/int8 are later escalations. */
  embedding: string;
  dims: number;
  /** Model identity incl. quantization, e.g. "Supabase/gte-small@q8". A row
   * whose model differs from the active one is treated as stale, exactly like
   * a stale content_hash — model swaps re-embed incrementally. */
  model: string;
  /** sha256 of the embedded text; unchanged notes are never re-embedded. */
  content_hash: string;
  updated_at: string;
}

export interface DB {
  graph_nodes: GraphNode;
  graph_edges: GraphEdge;
  graph_topics: GraphTopic;
  graph_operations: GraphOperation;
  note_embeddings: NoteEmbedding;
}
