/**
 * Every source of a drive as a list row, from one server query. Kept per
 * drive across mounts, so coming back to Sources paints at once and
 * refreshes behind it. Refreshes on the change feed (any source changed, or
 * the tree moved), on writes made in this window, and on a slow poll while
 * the feed is quiet. `unsupported` is true when the server predates the
 * query; the caller then reads the documents itself.
 */
import { useCallback, useEffect, useState } from "react";
import { authedGraphQLFetch } from "../../shared/authed-fetch.js";
import { resolveKnowledgeGraphEndpoint } from "../../shared/subgraph-endpoint.js";
import { debounced, isVaultLive, onVaultRemoteChange } from "../../shared/vault-live.js";
import { createLoadCoalescer } from "../lib/timeline/load-coalescer.js";
import { fetchSourceRows, type ServerSourceRow } from "../lib/source-rows-client.js";
import { subscribeDocMutations } from "./reactor-doc-cache.js";

const cache = new Map<string, ServerSourceRow[]>();
const unsupported = new Set<string>();
const loads = createLoadCoalescer();
const POLL_MS = 20_000;
const LIVE_SAFETY_NET_MS = 5 * 60_000;

function load(driveId: string): Promise<void> {
  return fetchSourceRows(driveId, (body) => authedGraphQLFetch(resolveKnowledgeGraphEndpoint(), body)).then((answer) => {
    if (answer.kind === "unsupported") unsupported.add(driveId);
    else cache.set(driveId, answer.rows);
  });
}

export interface UseSourceRows {
  /** The rows; null before the first answer for this drive. */
  rows: ServerSourceRow[] | null;
  /** The server predates the query: read the documents instead. */
  unsupported: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSourceRows(driveId: string | undefined): UseSourceRows {
  const [rows, setRows] = useState<ServerSourceRow[] | null>(() => (driveId ? (cache.get(driveId) ?? null) : null));
  const [isUnsupported, setUnsupported] = useState(() => (driveId ? unsupported.has(driveId) : false));
  const [error, setError] = useState<Error | null>(null);
  const [generation, setGeneration] = useState(0);
  const refetch = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    if (!driveId) return;
    setUnsupported(unsupported.has(driveId));
    if (unsupported.has(driveId)) return;
    let alive = true;
    setRows(cache.get(driveId) ?? null);
    // Opening joins a load already running; a refresh waits for it and runs once more.
    loads.request(driveId, () => load(driveId), { join: generation === 0 }).then(
      () => {
        if (!alive) return;
        if (unsupported.has(driveId)) setUnsupported(true);
        else {
          setRows(cache.get(driveId) ?? null);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!alive) return;
        console.warn("[useSourceRows] fetch failed:", e);
        setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      alive = false;
    };
  }, [driveId, generation]);

  useEffect(() => {
    if (!driveId || isUnsupported) return;
    const soon = debounced(refetch, 1_000, 5_000);
    const stopFeed = onVaultRemoteChange((change) => {
      if (change.driveId !== driveId) return;
      if (change.structural || change.documents.some((d) => d.documentType === "bai/source")) soon();
    });
    // A write made in this window (a status change, a delete) — the feed may not echo it back.
    const known = () => new Set((cache.get(driveId) ?? []).map((r) => r.id));
    const stopMutations = subscribeDocMutations((id) => {
      if (known().has(id)) soon();
    });
    let lastPollAt = Date.now();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (isVaultLive() && Date.now() - lastPollAt < LIVE_SAFETY_NET_MS) return;
      lastPollAt = Date.now();
      refetch();
    }, POLL_MS);
    return () => {
      stopFeed();
      stopMutations();
      clearInterval(timer);
    };
  }, [driveId, isUnsupported, refetch]);

  if (!driveId) return { rows: null, unsupported: false, error: null, refetch };
  return { rows, unsupported: isUnsupported, error, refetch };
}
