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
}

export interface DB {
  graph_nodes: GraphNode;
  graph_edges: GraphEdge;
  graph_topics: GraphTopic;
  graph_operations: GraphOperation;
}
