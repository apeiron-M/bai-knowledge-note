/**
 * Single-query sidebar metadata source for the Knowledge Vault editor.
 *
 * Replaces the old per-document fetch loop (`useDocumentsSafe` ×348)
 * with one GraphQL call to the `knowledgeGraph` subgraph. The subgraph
 * reads from a relational projection (`graph_nodes`, `graph_topics`,
 * `graph_edges`) maintained by the in-process `GraphIndexerProcessor`.
 *
 * Why this is fast:
 * - One round-trip instead of N (348+ for our vault).
 * - Returns only the metadata the sidebar/list views actually need —
 *   not the full document state with operation history.
 * - The processor pre-denormalizes joins (topics already joined per
 *   node), so no client-side stitching.
 *
 * Why this is resilient:
 * - The hook returns `{ nodes, edges, isLoading, error, refetch }`.
 *   Callers render an error state instead of crashing if the subgraph
 *   is unreachable, and can offer a manual retry.
 * - On first open of a drive, the processor's historical replay may
 *   not yet be done. The hook auto-refetches when the drive's file
 *   node count changes (a new doc landed → likely time to refresh).
 *   Initial empty state is shown gracefully; it fills in as the
 *   processor catches up.
 *
 * The full per-document state is still fetched lazily when the user
 * opens a single note (via `useDocumentByIdSafe`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFileNodesInSelectedDrive,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import { resolveKnowledgeGraphEndpoint } from "./subgraph-endpoint.js";

export type GraphNodeMetadata = {
  documentId: string;
  title: string | null;
  description: string | null;
  noteType: string | null;
  status: string | null;
  topics: string[];
  author: string | null;
  sourceOrigin: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GraphEdgeMetadata = {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  linkType: string | null;
  targetTitle: string | null;
};

export type GraphMetadata = {
  nodes: GraphNodeMetadata[];
  edges: GraphEdgeMetadata[];
  /** Map by `documentId` for O(1) lookup. */
  nodeMap: Map<string, GraphNodeMetadata>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

const NODES_QUERY = `
  query GraphNodes($driveId: ID!) {
    knowledgeGraphNodes(driveId: $driveId) {
      documentId
      title
      description
      noteType
      status
      topics
      author
      sourceOrigin
      createdAt
      updatedAt
    }
    knowledgeGraphEdges(driveId: $driveId) {
      id
      sourceDocumentId
      targetDocumentId
      linkType
      targetTitle
    }
  }
`;

type RawResponse = {
  data?: {
    knowledgeGraphNodes?: GraphNodeMetadata[];
    knowledgeGraphEdges?: GraphEdgeMetadata[];
  };
  errors?: { message?: string }[];
};

const EMPTY_NODES: GraphNodeMetadata[] = [];
const EMPTY_EDGES: GraphEdgeMetadata[] = [];

export function useGraphMetadata(): GraphMetadata {
  const driveId = useSelectedDriveId();
  const fileNodes = useFileNodesInSelectedDrive();
  const [nodes, setNodes] = useState<GraphNodeMetadata[]>(EMPTY_NODES);
  const [edges, setEdges] = useState<GraphEdgeMetadata[]>(EMPTY_EDGES);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  const lastFetchKeyRef = useRef<string>("");

  // Re-fetch trigger: drive changed OR doc count changed (new docs imported)
  // OR explicit refetch requested.
  const fingerprint = useMemo(() => {
    const count = fileNodes?.length ?? 0;
    return `${driveId ?? ""}:${count}:${refetchKey}`;
  }, [driveId, fileNodes?.length, refetchKey]);

  useEffect(() => {
    if (!driveId) {
      setNodes(EMPTY_NODES);
      setEdges(EMPTY_EDGES);
      setError(null);
      return;
    }
    if (lastFetchKeyRef.current === fingerprint) return;
    lastFetchKeyRef.current = fingerprint;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const endpoint = resolveKnowledgeGraphEndpoint();

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: NODES_QUERY,
        variables: { driveId },
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${endpoint}`);
        }
        const json = (await res.json()) as RawResponse;
        if (json.errors?.length) {
          throw new Error(
            json.errors.map((e) => e.message ?? "?").join("; "),
          );
        }
        return json.data;
      })
      .then((data) => {
        if (cancelled) return;
        setNodes(data?.knowledgeGraphNodes ?? EMPTY_NODES);
        setEdges(data?.knowledgeGraphEdges ?? EMPTY_EDGES);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn("[useGraphMetadata] fetch failed:", e.message);
        setError(e);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [driveId, fingerprint]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNodeMetadata>();
    for (const n of nodes) m.set(n.documentId, n);
    return m;
  }, [nodes]);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  return { nodes, edges, nodeMap, isLoading, error, refetch };
}
