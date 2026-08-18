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
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";
import { withTransientRetry } from "../lib/remote-first.js";
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

/** Attempts per document read, for transient transport failures. */
const FETCH_ATTEMPTS = 3;

const DOC_QUERY = `
  query DocState($id: String!) {
    document(identifier: $id) {
      document {
        id
        name
        documentType
        createdAtUtcIso
        lastModifiedAtUtcIso
        state
      }
    }
  }
`;

type RawDocResponse = {
  data?: {
    document?: {
      document?: {
        id?: string;
        name?: string;
        documentType?: string;
        createdAtUtcIso?: string;
        lastModifiedAtUtcIso?: string;
        state?: { global?: Record<string, unknown> };
      };
    };
  };
  errors?: { message?: string }[];
};

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
  let json: RawDocResponse;
  try {
    json = await withTransientRetry(async () => {
      const res = await fetch(resolveReactorEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: DOC_QUERY, variables: { id: spec.id } }),
      });
      if (!res.ok) throw new Error(`reactor responded HTTP ${res.status}`);
      return (await res.json()) as RawDocResponse;
    }, FETCH_ATTEMPTS);
  } catch {
    return { kind: "error" };
  }

  if (json.errors?.length) return { kind: "missing" };
  const doc = json.data?.document?.document;
  if (!doc?.state) return { kind: "missing" };
  return {
    kind: "doc",
    // Stitch a header from server truth, falling back to the spec.
    doc: {
      header: {
        id: doc.id ?? spec.id,
        documentType: doc.documentType ?? spec.documentType,
        name: doc.name ?? spec.name ?? spec.id,
        createdAtUtcIso: doc.createdAtUtcIso,
        lastModifiedAtUtcIso: doc.lastModifiedAtUtcIso,
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

  // Stable string key for the dep array (specs identity changes per render).
  const key = useMemo(
    () => specs.map((s) => `${s.id}:${s.documentType}`).join(","),
    [specs],
  );
  const ids = useMemo(() => specs.map((s) => s.id), [specs]);

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
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setFetchTick((t) => t + 1);
    }, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  // A write to a document this view shows was already evicted from the
  // cache by the global listener; revalidate so the row updates (or, for
  // a delete, disappears) without waiting for the poll.
  useEffect(() => {
    if (ids.length === 0) return;
    const watched = new Set(ids);
    return subscribeDocMutations((id) => {
      if (watched.has(id)) setFetchTick((t) => t + 1);
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
