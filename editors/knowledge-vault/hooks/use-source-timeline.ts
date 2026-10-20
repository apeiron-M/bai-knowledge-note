/**
 * The source timeline for a drive: from the server's
 * `knowledgeGraphSourceTimeline` when it has it, else built in the browser
 * from what the editor already holds (the desktop app's engine keeps the
 * installed package until a release, so a newer editor meets an older
 * server). One payload feeds Sources › Timeline and Graph › Over time.
 *
 * The graph comes from the caller — DriveExplorer's own graph hook — rather
 * than a hook instance of its own: every instance reloads the whole graph
 * when it mounts, and the Graph view mounts on every visit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSourceTimeline, type SourceTimeline } from "../../../processors/graph-indexer/source-timeline.js";
import { authedGraphQLFetch } from "../../shared/authed-fetch.js";
import { resolveKnowledgeGraphEndpoint } from "../../shared/subgraph-endpoint.js";
import { debounced, isVaultLive, onVaultRemoteChange } from "../../shared/vault-live.js";
import { createLoadCoalescer } from "../lib/timeline/load-coalescer.js";
import {
  browserTimelineReady,
  fetchSourceTimeline,
  shownBrowserTimeline,
  timelineInputFromBrowser,
  withSourceNames,
  type HeldTimeline,
} from "../lib/timeline/source-timeline-client.js";
import type { DriveTreeNode, GraphEdgeMetadata, GraphNodeMetadata } from "./use-graph-metadata.js";
import { useReactorDocsWithRefetch, type ReactorDocSpec } from "./use-reactor-docs.js";

export type TimelineMode = "server" | "browser";

/** What the browser fallback reads: the graph the editor already holds. */
export interface TimelineGraphData {
  /** The drive tree: folders and files. */
  allNodes: readonly DriveTreeNode[];
  nodes: readonly GraphNodeMetadata[];
  edges: readonly GraphEdgeMetadata[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseSourceTimeline {
  timeline: SourceTimeline | null;
  /** True until the first timeline for this drive is on screen. */
  isLoading: boolean;
  error: Error | null;
  /** Where the timeline came from; null before the first answer. */
  mode: TimelineMode | null;
  refetch: () => void;
}

/** The last timeline per drive, so a remount paints at once. */
const cache = new Map<string, SourceTimeline>();
const loads = createLoadCoalescer();
/** Drives whose server predates the query — the browser builds theirs. */
const unsupported = new Set<string>();

const TIMELINE_TYPES = new Set(["bai/source", "bai/knowledge-note", "bai/moc", ""]);
const POLL_MS = 60_000;
const LIVE_SAFETY_NET_MS = 5 * 60_000;
const NO_SPECS: ReactorDocSpec[] = [];

function loadFromServer(driveId: string): Promise<void> {
  return fetchSourceTimeline(driveId, (body) => authedGraphQLFetch(resolveKnowledgeGraphEndpoint(), body)).then((answer) => {
    if (answer.kind === "unsupported") unsupported.add(driveId);
    else cache.set(driveId, answer.timeline);
  });
}

/**
 * @param driveId the vault, or undefined to stay idle (Graph with Over time off).
 * @param graph the editor's graph, read only by the browser fallback.
 */
export function useSourceTimeline(driveId: string | undefined, graph: TimelineGraphData): UseSourceTimeline {
  const [timeline, setTimeline] = useState<SourceTimeline | null>(() => (driveId ? (cache.get(driveId) ?? null) : null));
  const [error, setError] = useState<Error | null>(null);
  const [answeredUnsupported, setBrowser] = useState(false);
  // A drive already known to predate the query goes straight to the fallback.
  const browser = answeredUnsupported || (driveId ? unsupported.has(driveId) : false);
  const [generation, setGeneration] = useState(0);
  const refetch = useCallback(() => setGeneration((g) => g + 1), []);
  const lastRun = useRef<{ driveId: string; generation: number } | null>(null);

  // Server path. A refresh asked for while a load runs gets one more load
  // after it (load-coalescer.ts), so a change that lands mid-load is never
  // lost; a view that merely opens joins the load already running.
  useEffect(() => {
    if (!driveId || browser) return;
    let alive = true;
    const refresh = lastRun.current?.driveId === driveId && lastRun.current.generation !== generation;
    lastRun.current = { driveId, generation };
    setTimeline(cache.get(driveId) ?? null);
    loads.request(driveId, () => loadFromServer(driveId), { join: !refresh }).then(
      () => {
        if (!alive) return;
        if (unsupported.has(driveId)) setBrowser(true);
        else {
          setTimeline(cache.get(driveId) ?? null);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!alive) return;
        console.warn("[useSourceTimeline] fetch failed:", e);
        setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      alive = false;
    };
  }, [driveId, browser, generation]);

  // Refresh: the change feed, coalesced generously (a server load reads every
  // source), and a slow poll while the tab is visible and the feed is quiet.
  useEffect(() => {
    if (!driveId || browser) return;
    const soon = debounced(refetch, 2_500, 15_000);
    const stop = onVaultRemoteChange((change) => {
      if (change.driveId !== driveId) return;
      if (change.structural || change.documents.some((d) => TIMELINE_TYPES.has(d.documentType ?? ""))) soon();
    });
    let lastPollAt = Date.now();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (isVaultLive() && Date.now() - lastPollAt < LIVE_SAFETY_NET_MS) return;
      lastPollAt = Date.now();
      refetch();
    }, POLL_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [driveId, browser, refetch]);

  // Browser path, only while it is in use: the source documents the Sources
  // view loads (same retained cache, so switching tabs is instant).
  const fallback = Boolean(driveId) && browser;
  const specs = useMemo<ReactorDocSpec[]>(
    () => (fallback ? graph.allNodes.filter((n) => n.documentType === "bai/source").map((n) => ({ id: n.id, documentType: "bai/source", name: n.name })) : NO_SPECS),
    [fallback, graph.allNodes],
  );
  const sourceDocs = useReactorDocsWithRefetch(specs, { pollMs: 20_000, retainKey: "source-list" });
  // Build only from a complete read: a half-read list would file every note
  // whose source is still loading under "no recorded source" — and rebuild on
  // every document that lands. `isLoading` turns false at the first streamed
  // document; `complete` waits for the whole pass.
  const ready =
    fallback && browserTimelineReady({ graphLoading: graph.isLoading, graphHasNodes: graph.nodes.length > 0, docsLoading: !sourceDocs.complete });
  const built = useMemo(() => {
    if (!ready) return null;
    return buildSourceTimeline(
      timelineInputFromBrowser({ treeNodes: graph.allNodes, sourceDocs: sourceDocs.docs, graphNodes: graph.nodes, graphEdges: graph.edges }),
    );
  }, [ready, graph.allNodes, graph.nodes, graph.edges, sourceDocs.docs]);
  const [held, setHeld] = useState<HeldTimeline<SourceTimeline> | null>(null);
  useEffect(() => {
    if (built && driveId) setHeld({ driveId, timeline: built });
  }, [built, driveId]);

  // A server a release behind names no sources; the drive tree does.
  const named = useMemo(() => withSourceNames(timeline, graph.allNodes), [timeline, graph.allNodes]);

  if (!driveId) return { timeline: null, isLoading: false, error: null, mode: null, refetch };
  if (browser) {
    const shown = shownBrowserTimeline(built, held, driveId);
    return { timeline: shown, isLoading: shown === null && graph.error === null, error: graph.error, mode: "browser", refetch: graph.refetch };
  }
  return { timeline: named, isLoading: timeline === null && error === null, error, mode: timeline ? "server" : null, refetch };
}
