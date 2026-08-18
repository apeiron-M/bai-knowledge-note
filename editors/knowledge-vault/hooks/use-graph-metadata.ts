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
 * `isLoading` means "the first fetch for this drive has not settled
 * yet" — it starts `true`, so a caller that has no data can honestly
 * say "loading" instead of "empty", and it does NOT flip back to true
 * on the periodic refetches (data is retained, so nothing would be
 * gained by blanking the UI every 60s).
 *
 * Cold-start cost is real: the subgraph query and the drive-tree query
 * are each multi-second on a ~1.5k-note vault. Three things cut the
 * perceived cost:
 *  1. The two queries run in PARALLEL (they used to be chained, making
 *     first paint the sum of both).
 *  2. Concurrent hook instances share one in-flight request. React does
 *     not dedupe hook calls, and `DriveExplorer` mounts `useKnowledgeNotes`
 *     and `useKnowledgeMocs` together — that was 2× every query.
 *  3. The resolved snapshot is cached in memory and in `sessionStorage`,
 *     so remounts and page reloads paint immediately from cache while
 *     the live fetch runs behind it (`isLoading` stays true until it
 *     lands — what's on screen is cached, not fresh).
 *
 * The full per-document state is still fetched lazily when the user
 * opens a single note (via `useDocumentByIdSafe`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFileNodesInSelectedDrive,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
} from "./subgraph-endpoint.js";

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

export type DriveTreeNode = {
  id: string;
  name: string;
  kind: "file" | "folder";
  documentType?: string;
  parentFolder: string | null;
};

export type GraphMetadata = {
  nodes: GraphNodeMetadata[];
  edges: GraphEdgeMetadata[];
  /** Map by `documentId` for O(1) lookup. */
  nodeMap: Map<string, GraphNodeMetadata>;
  /** Drive file nodes fetched authoritatively from the reactor. */
  fileNodes: DriveFileNode[];
  /** All drive nodes (folders + files) fetched from the reactor. */
  allNodes: DriveTreeNode[];
  /**
   * True until the first fetch for the selected drive settles. Stays
   * false across the periodic refetches (previous data is retained), and
   * can be true while cached data is already on screen — meaning "what
   * you see may be stale", never "there is nothing".
   */
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
const EMPTY_TREE: DriveTreeNode[] = [];

/* ------------------------------------------------------------------ */
/*  Snapshot cache (warm start)                                       */
/* ------------------------------------------------------------------ */

type GraphSnapshot = {
  nodes: GraphNodeMetadata[];
  edges: GraphEdgeMetadata[];
  allNodes: DriveTreeNode[];
};

/**
 * Bump when the shape of anything inside a snapshot changes — a stale
 * shape from a previous deploy is then simply ignored, not adapted.
 */
const SNAPSHOT_VERSION = "v1";
const SNAPSHOT_KEY_PREFIX = "bai-graph-snapshot";

/**
 * Snapshots are big: nodes ≈ 0.9 MB and edges ≈ 2.3 MB of JSON for a
 * 1.5k-note vault. `sessionStorage` quota is ~5 MB per origin, so a
 * full snapshot is persisted only when it fits comfortably; above the
 * cap the edge list is dropped (the sidebar and note list don't need
 * it) and only nodes + drive tree are kept.
 */
const MAX_SNAPSHOT_CHARS = 3_000_000;

/** Don't re-serialise for every hook instance that resolves together. */
const PERSIST_THROTTLE_MS = 5_000;

/** Snapshots are megabytes each; keep the working set small. */
const MAX_MEMORY_SNAPSHOTS = 3;

/** Snapshots fetched during this page load, shared by all hook instances. */
const memorySnapshots = new Map<string, GraphSnapshot>();
/** In-flight fetches, so N instances mounting together make 1 request. */
const inflightFetches = new Map<string, Promise<FetchOutcome>>();
const lastPersistedAt = new Map<string, number>();

function snapshotKey(driveId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}:${SNAPSHOT_VERSION}:${driveId}`;
}

function readSessionSnapshot(driveId: string): GraphSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(snapshotKey(driveId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GraphSnapshot>;
    // Anything that isn't the expected shape is treated as absent.
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.allNodes)) {
      return null;
    }
    if (parsed.nodes.length === 0 && parsed.allNodes.length === 0) return null;
    return {
      nodes: parsed.nodes,
      edges: Array.isArray(parsed.edges) ? parsed.edges : EMPTY_EDGES,
      allNodes: parsed.allNodes,
    };
  } catch {
    // Corrupt entry / storage disabled — warm start is best-effort.
    return null;
  }
}

function writeSessionSnapshot(driveId: string, snapshot: GraphSnapshot): void {
  if (typeof sessionStorage === "undefined") return;
  const key = snapshotKey(driveId);
  // Tier down rather than fail: full snapshot, then nodes + tree only.
  const attempts: GraphSnapshot[] = [
    snapshot,
    { ...snapshot, edges: EMPTY_EDGES },
  ];
  for (const attempt of attempts) {
    try {
      const json = JSON.stringify(attempt);
      if (json.length > MAX_SNAPSHOT_CHARS) continue;
      sessionStorage.setItem(key, json);
      pruneOtherSnapshots(key);
      return;
    } catch {
      // QuotaExceededError (or a serialisation failure) — try smaller.
    }
  }
}

/**
 * Only the selected drive's snapshot is worth keeping: one per drive
 * would eat the whole origin quota and make the next write fail.
 */
function pruneOtherSnapshots(keepKey: string): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key !== keepKey && key.startsWith(SNAPSHOT_KEY_PREFIX)) {
        stale.push(key);
      }
    }
    for (const key of stale) sessionStorage.removeItem(key);
  } catch {
    // Best-effort housekeeping.
  }
}

function cacheSnapshot(driveId: string, snapshot: GraphSnapshot): void {
  memorySnapshots.set(driveId, snapshot);
  for (const key of memorySnapshots.keys()) {
    if (memorySnapshots.size <= MAX_MEMORY_SNAPSHOTS) break;
    if (key !== driveId) memorySnapshots.delete(key);
  }
  const now = Date.now();
  const last = lastPersistedAt.get(driveId) ?? 0;
  if (now - last < PERSIST_THROTTLE_MS) return;
  lastPersistedAt.set(driveId, now);
  // Serialising megabytes blocks the main thread for tens of ms. Do it
  // after the UI has painted the data we just received.
  setTimeout(() => writeSessionSnapshot(driveId, snapshot), 500);
}

/* ------------------------------------------------------------------ */
/*  Fetch                                                             */
/* ------------------------------------------------------------------ */

/**
 * Result of one refresh. Each leg is `null` when that request failed,
 * so a caller can keep the data it already has for the failed leg
 * instead of blanking the UI on a transient network error.
 */
type FetchOutcome = {
  graph: { nodes: GraphNodeMetadata[]; edges: GraphEdgeMetadata[] } | null;
  allNodes: DriveTreeNode[] | null;
  error: Error | null;
};

async function fetchDriveAllNodes(driveId: string): Promise<DriveTreeNode[]> {
  const res = await fetch(resolveReactorEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: DRIVE_TREE_QUERY,
      variables: { id: driveId },
    }),
  });
  // Throws rather than returning `[]` so the caller can tell "the drive
  // tree request failed" (keep what we have) from "the drive is empty".
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching drive tree`);
  }
  const json = (await res.json()) as DriveTreeRaw;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message ?? "?").join("; "));
  }
  const nodes = json.data?.document?.document?.state?.global?.nodes ?? [];
  return nodes
    .filter(
      (
        n,
      ): n is {
        id: string;
        name: string;
        kind: string;
        documentType?: string;
        parentFolder?: string | null;
      } =>
        typeof n === "object" &&
        n !== null &&
        ((n as { kind?: string }).kind === "file" ||
          (n as { kind?: string }).kind === "folder"),
    )
    .map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind as "file" | "folder",
      documentType: n.documentType ?? undefined,
      parentFolder: n.parentFolder ?? null,
    }));
}

async function fetchGraphNodesAndEdges(
  driveId: string,
): Promise<{ nodes: GraphNodeMetadata[]; edges: GraphEdgeMetadata[] }> {
  const endpoint = resolveKnowledgeGraphEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: NODES_QUERY, variables: { driveId } }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${endpoint}`);
  }
  const json = (await res.json()) as RawResponse;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message ?? "?").join("; "));
  }
  return {
    nodes: json.data?.knowledgeGraphNodes ?? EMPTY_NODES,
    edges: json.data?.knowledgeGraphEdges ?? EMPTY_EDGES,
  };
}

/**
 * One refresh: subgraph metadata and the drive tree, fetched in
 * parallel. They were previously chained, which made the cold first
 * paint the SUM of two multi-second queries; nothing in either depends
 * on the other. A failure in one leg no longer hides the other.
 */
async function fetchGraphSnapshot(driveId: string): Promise<FetchOutcome> {
  const [graphResult, treeResult] = await Promise.allSettled([
    fetchGraphNodesAndEdges(driveId),
    fetchDriveAllNodes(driveId),
  ]);

  const failures = [graphResult, treeResult]
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) =>
      r.reason instanceof Error ? r.reason.message : String(r.reason),
    );
  if (failures.length > 0) {
    console.warn("[useGraphMetadata] fetch failed:", failures.join("; "));
  }

  return {
    graph: graphResult.status === "fulfilled" ? graphResult.value : null,
    allNodes: treeResult.status === "fulfilled" ? treeResult.value : null,
    error: failures.length > 0 ? new Error(failures.join("; ")) : null,
  };
}

/**
 * Share an in-flight refresh between hook instances. `useKnowledgeNotes`
 * and `useKnowledgeMocs` both call `useGraphMetadata()` from the same
 * `DriveExplorer` mount and React does not dedupe hook calls, so without
 * this every query ran twice on drive open.
 */
function loadGraphSnapshot(driveId: string): Promise<FetchOutcome> {
  const existing = inflightFetches.get(driveId);
  if (existing) return existing;
  const pending = fetchGraphSnapshot(driveId).finally(() => {
    inflightFetches.delete(driveId);
  });
  inflightFetches.set(driveId, pending);
  return pending;
}

export function useGraphMetadata(): GraphMetadata {
  const driveId = useSelectedDriveId();
  const fileNodes = useFileNodesInSelectedDrive();
  const [nodes, setNodes] = useState<GraphNodeMetadata[]>(EMPTY_NODES);
  const [edges, setEdges] = useState<GraphEdgeMetadata[]>(EMPTY_EDGES);
  const [allNodes, setAllNodes] = useState<DriveTreeNode[]>(EMPTY_TREE);
  const serverFileNodes: DriveFileNode[] = useMemo(
    () =>
      allNodes
        .filter(
          (n): n is DriveTreeNode & { documentType: string } =>
            n.kind === "file" && !!n.documentType,
        )
        .map((n) => ({
          id: n.id,
          name: n.name,
          documentType: n.documentType,
          parentFolder: n.parentFolder,
        })),
    [allNodes],
  );
  // Starts true: on first render nothing has been fetched yet, so a
  // caller must be able to say "loading" rather than "empty vault".
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);
  /** Drive whose first fetch has settled — gates `isLoading` and warm start. */
  const settledDriveRef = useRef<string | null>(null);

  // Re-fetch trigger: drive changed OR explicit refetch requested.
  // We deliberately do NOT key on fileNodes.length — it changes rapidly
  // during drive init / bulk import (e.g., 348 notes landing one-by-one)
  // and the per-change cancel-and-restart prevents any fetch from
  // resolving. Instead the count-driven refetch is debounced below.
  const driveFingerprint = useMemo(
    () => `${driveId ?? ""}:${refetchKey}`,
    [driveId, refetchKey],
  );

  // Periodic refresh: edges and titles change server-side (agents write
  // via GraphQL) without any browser event and without the file count
  // moving — a graph edge added by an agent would otherwise be invisible
  // until a manual reload. Visibility-gated so background tabs stay quiet.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      setRefetchKey((k) => k + 1);
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

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
      setAllNodes(EMPTY_TREE);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const isFirstLoadForDrive = settledDriveRef.current !== driveId;

    if (isFirstLoadForDrive) {
      setIsLoading(true);
      // Warm start: paint the newest snapshot we have for this drive
      // (this page load first, then sessionStorage from a previous one)
      // so the sidebar isn't blank for the several seconds the queries
      // take. `isLoading` stays true — this data is cached, and the
      // fetch below replaces it wholesale when it lands.
      const cached =
        memorySnapshots.get(driveId) ?? readSessionSnapshot(driveId);
      if (cached) {
        setNodes(cached.nodes);
        setEdges(cached.edges);
        setAllNodes(cached.allNodes);
      }
    }
    setError(null);

    loadGraphSnapshot(driveId)
      .then((outcome) => {
        if (cancelled) return;
        // Apply each leg only if it succeeded, so a transient failure
        // never blanks data that is already on screen.
        if (outcome.graph) {
          setNodes(outcome.graph.nodes);
          setEdges(outcome.graph.edges);
        }
        if (outcome.allNodes) {
          setAllNodes(outcome.allNodes);
        }
        setError(outcome.error);
        if (outcome.graph && outcome.allNodes && !outcome.error) {
          cacheSnapshot(driveId, {
            nodes: outcome.graph.nodes,
            edges: outcome.graph.edges,
            allNodes: outcome.allNodes,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn("[useGraphMetadata] fetch failed:", e.message);
        setError(e);
      })
      .finally(() => {
        if (cancelled) return;
        settledDriveRef.current = driveId;
        setIsLoading(false);
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
    allNodes,
    isLoading,
    error,
    refetch,
  };
}
