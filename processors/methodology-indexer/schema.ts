export interface MethodologyClaim {
  id: string;
  document_id: string;
  title: string | null;
  description: string | null;
  kind: string | null;
  topics: string | null; // JSON array stored as string
  methodology: string | null; // JSON array stored as string
  updated_at: string;
}

export interface MethodologyConnection {
  id: string;
  source_document_id: string;
  target_ref: string;
  context_phrase: string | null;
  updated_at: string;
}

export interface MethodologyDB {
  methodology_claims: MethodologyClaim;
  methodology_connections: MethodologyConnection;
}
