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

/**
 * A node in the drive's tree, sourced directly from the reactor. Used
 * to bypass Connect's local drive-document cache when it goes out of
 * sync (the persistent "0 file nodes despite 398 on server" symptom).
 */
export type DriveFileNode = {
  id: string;
  name: string;
  documentType: string;
  parentFolder: string | null;
};

export type GraphMetadata = {
  nodes: GraphNodeMetadata[];
  edges: GraphEdgeMetadata[];
  /** Map by `documentId` for O(1) lookup. */
  nodeMap: Map<string, GraphNodeMetadata>;
  /** Drive file nodes fetched authoritatively from the reactor. */
  fileNodes: DriveFileNode[];
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

const DRIVE_TREE_QUERY = `
  query DriveTree($id: String!) {
    document(identifier: $id) {
      document { state }
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

type DriveTreeRaw = {
  data?: {
    document?: { document?: { state?: { global?: { nodes?: unknown[] } } } };
  };
  errors?: { message?: string }[];
};

const EMPTY_NODES: GraphNodeMetadata[] = [];
const EMPTY_EDGES: GraphEdgeMetadata[] = [];
const EMPTY_FILE_NODES: DriveFileNode[] = [];

function reactorEndpoint(): string {
  // Mirror subgraph-endpoint.ts logic for hostname → port mapping.
  const hostname = globalThis.window?.location?.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4001/graphql";
  }
  if (hostname && /^connect\..+\.vetra\.io$/.test(hostname)) {
    const sbHost = hostname.replace(/^connect\./, "switchboard.");
    return `https://${sbHost}/graphql`;
  }
  return "/graphql";
}

async function fetchDriveFileNodes(driveId: string): Promise<DriveFileNode[]> {
  const res = await fetch(reactorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: DRIVE_TREE_QUERY,
      variables: { id: driveId },
    }),
  });
  if (!res.ok) return EMPTY_FILE_NODES;
  const json = (await res.json()) as DriveTreeRaw;
  if (json.errors?.length) return EMPTY_FILE_NODES;
  const nodes = json.data?.document?.document?.state?.global?.nodes ?? [];
  return nodes
    .filter(
      (n): n is { id: string; name: string; kind: string; documentType?: string; parentFolder?: string | null } =>
        typeof n === "object" && n !== null && (n as { kind?: string }).kind === "file",
    )
    .map((n) => ({
      id: n.id,
      name: n.name,
      documentType: n.documentType ?? "",
      parentFolder: n.parentFolder ?? null,
    }));
}

export function useGraphMetadata(): GraphMetadata {
  const driveId = useSelectedDriveId();
  const fileNodes = useFileNodesInSelectedDrive();
  const [nodes, setNodes] = useState<GraphNodeMetadata[]>(EMPTY_NODES);
  const [edges, setEdges] = useState<GraphEdgeMetadata[]>(EMPTY_EDGES);
  const [serverFileNodes, setServerFileNodes] =
    useState<DriveFileNode[]>(EMPTY_FILE_NODES);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  const lastFetchKeyRef = useRef<string>("");

  // Re-fetch trigger: drive changed OR explicit refetch requested.
  // We deliberately do NOT key on fileNodes.length — it changes rapidly
  // during drive init / bulk import (e.g., 348 notes landing one-by-one)
  // and the per-change cancel-and-restart prevents any fetch from
  // resolving. Instead the count-driven refetch is debounced below.
  const driveFingerprint = useMemo(
    () => `${driveId ?? ""}:${refetchKey}`,
    [driveId, refetchKey],
  );

  // Debounced count-driven refetch: when fileNodes.length changes (new
  // docs landed), bump the refetch key after 1.5s of stability.
  const fileCount = fileNodes?.length ?? 0;
  const lastSeenCountRef = useRef<number>(-1);
  useEffect(() => {
    if (fileCount === lastSeenCountRef.current) return;
    const prev = lastSeenCountRef.current;
    lastSeenCountRef.current = fileCount;
    // Skip the very first observation (the initial main-effect fetch
    // already covers it). Only schedule a refetch on subsequent file
    // count changes.
    if (prev === -1) return;
    const timer = setTimeout(() => setRefetchKey((k) => k + 1), 1500);
    return () => clearTimeout(timer);
  }, [fileCount]);

  useEffect(() => {
    if (!driveId) {
      setNodes(EMPTY_NODES);
      setEdges(EMPTY_EDGES);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const endpoint = resolveKnowledgeGraphEndpoint();
    // eslint-disable-next-line no-console
    console.log("[useGraphMetadata] fetch start", { endpoint, driveId, fingerprint: driveFingerprint });

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
        // eslint-disable-next-line no-console
        console.log(
          "[useGraphMetadata] response",
          {
            hasData: !!json.data,
            errors: json.errors,
            nodeCount: json.data?.knowledgeGraphNodes?.length ?? 0,
            edgeCount: json.data?.knowledgeGraphEdges?.length ?? 0,
            firstNode: json.data?.knowledgeGraphNodes?.[0],
          },
        );
        if (json.errors?.length) {
          throw new Error(
            json.errors.map((e) => e.message ?? "?").join("; "),
          );
        }
        return json.data;
      })
      .then((data) => {
        // eslint-disable-next-line no-console
        console.log("[useGraphMetadata] applying state", {
          cancelled,
          nodeCount: data?.knowledgeGraphNodes?.length ?? 0,
        });
        if (cancelled) return;
        setNodes(data?.knowledgeGraphNodes ?? EMPTY_NODES);
        setEdges(data?.knowledgeGraphEdges ?? EMPTY_EDGES);
      })
      // Also fetch the drive's authoritative tree from the reactor —
      // bypasses Connect's stale local drive-document copy.
      .then(() =>
        fetchDriveFileNodes(driveId).then((nodes) => {
          if (cancelled) return;
          // eslint-disable-next-line no-console
          console.log("[useGraphMetadata] fileNodes from reactor:", nodes.length);
          setServerFileNodes(nodes);
        }),
      )
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
  }, [driveId, driveFingerprint]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNodeMetadata>();
    for (const n of nodes) m.set(n.documentId, n);
    return m;
  }, [nodes]);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  return {
    nodes,
    edges,
    nodeMap,
    fileNodes: serverFileNodes,
    isLoading,
    error,
    refetch,
  };
}
