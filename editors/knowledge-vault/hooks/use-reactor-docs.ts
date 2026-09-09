/**
 * Direct-from-reactor document fetcher.
 *
 * Connect's documentCache (and its underlying KyselyDocumentView) is
 * the canonical source for document state, but we've observed it
 * persistently throwing `Document not found` for IDs that exist on the
 * server. The browser's local replica of Connect's read store can be
 * arbitrarily stale or fail to backfill some docs entirely.
 *
 * This hook bypasses the cache and asks the reactor's GraphQL endpoint
 * directly for each document's full state. Used by VaultSidebar to
 * populate MoC / observation / tension / vault-config lists.
 *
 * Cost: N independent fetches (concurrency-capped) on every distinct
 * id list — but only the FIRST time. Results are kept in the
 * module-level stale-while-revalidate cache in `reactor-doc-cache.ts`,
 * so a view the user switches away from and back to paints from cache
 * in its first commit and revalidates in the background instead of
 * re-running the whole fetch behind a spinner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PHDocument } from "document-model";
import { fetchDocumentState } from "../../shared/document-state.js";
import { withTransientRetry } from "../lib/remote-first.js";
import { isVaultLive } from "../../shared/vault-live.js";
import {
  cachedDocsFor,
  everyDocCached,
  fetchThroughCache,
  peekDoc,
  recallIds,
  rememberIds,
  subscribeDocMutations,
  type DocFetchOutcome,
} from "./reactor-doc-cache.js";

const FETCH_CONCURRENCY = 6;

/**
 * Cadence a `pollMs` list falls back to while the change feed is
 * delivering. Every poll tick re-reads the WHOLE list — one request per
 * document — and there are seven call sites doing it every 10-60s, so on a
 * live socket this was the app's single largest source of requests while
 * the socket was already pushing the same news for free.
 */
const LIVE_SAFETY_NET_MS = 5 * 60_000;

/** Attempts per document read, for transient transport failures. */
const FETCH_ATTEMPTS = 3;

/**
 * Read one document, classified so the cache can tell "gone" from
 * "unreachable":
 *
 *  - transport failure (connection reset from the reactor's internal
 *    gateway hop, a non-2xx response) → `error`, and the cache keeps the
 *    last good body so a blip doesn't blank a row;
 *  - GraphQL error or a body with no state → `missing`, and the cache
 *    entry is dropped so a deleted document can't ghost.
 *
 * Retries are delegated to `withTransientRetry` — the same backoff the
 * rest of remote-first mode uses — which returns immediately for
 * deterministic failures.
 */
async function fetchDocOutcome(spec: ReactorDocSpec): Promise<DocFetchOutcome> {
  let doc: Awaited<ReturnType<typeof fetchDocumentState>>;
  try {
    // `fetchDocumentState` throws on transport failure and resolves `null`
    // when the reactor has no such document — exactly the split this
    // classification needs, so no re-interpretation happens here.
    doc = await withTransientRetry(
      () => fetchDocumentState(spec.id),
      FETCH_ATTEMPTS,
    );
  } catch {
    return { kind: "error" };
  }

  if (!doc) return { kind: "missing" };
  return {
    kind: "doc",
    // Stitch a header from server truth, falling back to the spec.
    doc: {
      header: {
        id: doc.id,
        documentType: doc.documentType ?? spec.documentType,
        name: doc.name ?? spec.name ?? spec.id,
        createdAtUtcIso: doc.createdAtUtcIso ?? undefined,
        lastModifiedAtUtcIso: doc.lastModifiedAtUtcIso ?? undefined,
      },
      state: doc.state,
    } as unknown as PHDocument,
  };
}

async function pMap<T, U>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array<U>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

export type ReactorDocSpec = {
  id: string;
  documentType: string;
  name?: string;
};

export type UseReactorDocsOptions = {
  /**
   * Re-fetch the whole spec list on this interval (ms). The vault is
   * written by agents server-side, so views that must track external
   * progress (pipeline queue, source statuses) poll; views that only
   * change through this UI leave it unset.
   */
  pollMs?: number;
  /**
   * Opt-in continuity across remounts. The spec list is derived from the
   * drive tree, whose hook holds its nodes in component state — so on
   * remount `specs` is momentarily EMPTY even though every document is
   * still cached. With a `retainKey` the hook recalls the id list this
   * caller last asked for and paints those cached documents while the
   * tree reloads, so switching back to a tab shows content rather than a
   * spinner. Purely a paint hint: nothing is fetched from the recalled
   * list, and the real spec list reconciles it on arrival.
   */
  retainKey?: string;
};

export type UseReactorDocsResult = {
  docs: PHDocument[];
  /**
   * True while the authoritative fetch for the current spec set is still
   * outstanding AND the cache can't answer it in full.
   *
   * `docs` may already carry cached entries while this is true — that's
   * the stale-while-revalidate contract. Two consequences worth knowing:
   *
   *  - every requested spec cached ⇒ `false` on the very first render,
   *    so a revisited tab paints its list instead of a spinner;
   *  - only SOME specs cached ⇒ stays `true` (the list really is
   *    incomplete) while `docs` shows the subset that is known. Consumers
   *    should keep gating their spinner on `isLoading && docs.length === 0`
   *    so a partial cache shows partial content rather than a spinner over
   *    data we already hold.
   *
   * Poll-driven refetches and mutation-driven revalidations never
   * re-enter loading, so a list never flickers back to a spinner once it
   * has content.
   */
  isLoading: boolean;
  /** Force an immediate re-fetch (e.g. right after a local write). */
  refetch: () => void;
};

/**
 * Returns full document state objects for the given specs, fetched
 * directly from the reactor (one GraphQL call per id, concurrency-capped
 * and de-duplicated across simultaneous consumers). Each returned object
 * has the shape Connect's PHDocument roughly conforms to:
 * `{ header: { id, documentType, name }, state }`.
 *
 * Documents the server can't produce are filtered out of the result;
 * documents that merely failed in transit keep their last good body, so
 * lists don't flicker on a connection reset.
 */
export function useReactorDocsWithRefetch(
  specs: ReactorDocSpec[],
  options?: UseReactorDocsOptions,
): UseReactorDocsResult {
  const [fetched, setFetched] = useState<{
    key: string;
    docs: PHDocument[];
  } | null>(null);
  const [fetchTick, setFetchTick] = useState(0);
  const lastKeyRef = useRef<string>("");
  // Latest specs, for the mutation handler — reading them through a ref
  // keeps its subscription keyed on the stable `ids`.
  const specsRef = useRef(specs);
  specsRef.current = specs;

  // Stable string key for the dep array (specs identity changes per render).
  const key = useMemo(
    () => specs.map((s) => `${s.id}:${s.documentType}`).join(","),
    [specs],
  );
  // Keyed on `key`, NOT on `specs`: `specs` comes from a `.filter()` in a
  // caller's render body and so has a new identity every render, which
  // rippled into `seedIds`, `seeded`, `seedComplete`, `rememberIds` and the
  // mutation subscription below — all of them re-running every render. An
  // unchanged `key` means an identical id list, so this is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => specs.map((s) => s.id), [key]);

  const retainKey = options?.retainKey;
  useEffect(() => {
    if (retainKey) rememberIds(retainKey, ids);
  }, [retainKey, ids]);

  /**
   * Ids to paint from cache before this spec set's own fetch resolves.
   * Falls back to the recalled list only while the tree is still
   * reloading and `specs` is empty.
   */
  const seedIds = useMemo(
    () => (ids.length > 0 ? ids : retainKey ? recallIds(retainKey) : []),
    [ids, retainKey],
  );
  // Read synchronously during render — the whole point is to have content
  // in the first commit after a remount rather than one paint later.
  const seeded = useMemo(() => cachedDocsFor(seedIds), [seedIds]);
  const seedComplete = useMemo(() => everyDocCached(seedIds), [seedIds]);

  const refetch = useCallback(() => setFetchTick((t) => t + 1), []);

  const pollMs = options?.pollMs;
  useEffect(() => {
    if (!pollMs) return;
    let lastPollAt = Date.now();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // While the Switchboard's change feed is delivering, every write in
      // this drive arrives as a push and the mutation subscription below
      // revalidates exactly the document that changed. This poll is then a
      // safety net for a silently dead socket, not the update mechanism, so
      // it backs off — matching what `use-remote-first` and
      // `use-graph-metadata` already do. Liveness expires on its own
      // (LIVE_EVENT_TTL_MS), so a feed that goes quiet resumes the fast
      // cadence without this needing to notice.
      if (isVaultLive() && Date.now() - lastPollAt < LIVE_SAFETY_NET_MS) return;
      lastPollAt = Date.now();
      setFetchTick((t) => t + 1);
    }, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  // A write to a document this view shows was already evicted from the
  // cache by the global listener; revalidate so the row updates (or, for
  // a delete, disappears) without waiting for the poll.
  //
  // ONLY the document that changed. This used to bump `fetchTick`, which
  // re-ran `pMap` over the entire spec list: editing one source re-read
  // every source in the drive, and an agent's write burst multiplied that
  // by the number of events.
  useEffect(() => {
    if (ids.length === 0) return;
    const watched = new Set(ids);
    return subscribeDocMutations((id) => {
      if (!watched.has(id)) return;
      const spec = specsRef.current.find((s) => s.id === id);
      if (!spec) return;
      void fetchThroughCache(spec.id, () => fetchDocOutcome(spec)).then(
        (outcome) => {
          // `error` is "unreachable", not "gone" — keep the last good body.
          if (outcome.kind === "error") return;
          setFetched((prev) => {
            if (!prev) return prev;
            const docs =
              outcome.kind === "doc"
                ? prev.docs.some((d) => d.header.id === id)
                  ? prev.docs.map((d) => (d.header.id === id ? outcome.doc : d))
                  : [...prev.docs, outcome.doc]
                : prev.docs.filter((d) => d.header.id !== id);
            return { key: prev.key, docs };
          });
        },
      );
    });
  }, [ids]);

  useEffect(() => {
    if (specs.length === 0) return;
    const fetchKey = `${key}#${fetchTick}`;
    if (fetchKey === lastKeyRef.current) return;
    lastKeyRef.current = fetchKey;

    // Note this runs on EVERY mount, cache hit or not: the cache decides
    // what to paint, never whether to revalidate.
    let cancelled = false;
    void pMap(specs, FETCH_CONCURRENCY, (spec) =>
      fetchThroughCache(spec.id, () => fetchDocOutcome(spec)),
    ).then((outcomes) => {
      if (cancelled) return;
      const next: PHDocument[] = [];
      outcomes.forEach((outcome, index) => {
        if (outcome.kind === "doc") {
          next.push(outcome.doc);
        } else if (outcome.kind === "error") {
          // Unreachable, not gone: keep the last good body if we have one.
          const cached = peekDoc(specs[index].id);
          if (cached) next.push(cached.doc);
        }
      });
      setFetched({ key, docs: next });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchTick]);

  return {
    docs: fetched?.key === key ? fetched.docs : seeded,
    isLoading: specs.length > 0 && fetched?.key !== key && !seedComplete,
    refetch,
  };
}

/** Back-compat shape: just the docs. */
export function useReactorDocs(specs: ReactorDocSpec[]): PHDocument[] {
  return useReactorDocsWithRefetch(specs).docs;
}
