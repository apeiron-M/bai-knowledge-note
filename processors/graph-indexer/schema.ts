export interface GraphNode {
  id: string;
  document_id: string;
  title: string | null;
  description: string | null;
  note_type: string | null;
  status: string | null;
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

export interface DB {
  graph_nodes: GraphNode;
  graph_edges: GraphEdge;
}
