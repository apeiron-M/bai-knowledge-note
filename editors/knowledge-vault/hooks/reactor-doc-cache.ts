/**
 * Stale-while-revalidate cache for the documents `use-reactor-docs.ts`
 * reads straight from the reactor.
 *
 * ## Why
 *
 * The vault's tab bar UNMOUNTS a view when the user switches away, so
 * every fetched document used to be dropped on the floor. Coming back to
 * Sources or Projects re-ran the whole per-document fetch from zero
 * behind a spinner — for data that had been on the client seconds
 * earlier. Keeping the documents at module scope, keyed per document id,
 * lets a remount paint in its FIRST commit and revalidate in the
 * background.
 *
 * Keying per id (not per spec-set) matters: the Sources tab, the
 * Projects tab and the drive explorer's project badge ask for
 * overlapping id sets, so a partially-overlapping set still gets hits.
 *
 * ## Two horizons, deliberately different
 *
 *  - {@link DOC_CACHE_TTL_MS} (30s — the same module-level TTL
 *    `editors/shared/use-vault-doc-index.ts` uses) is the *freshness*
 *    horizon: past it an entry is {@link isStale}. It does NOT gate
 *    painting. A stale hit still paints instantly and is revalidated —
 *    that is the whole point of stale-while-revalidate. Gating the paint
 *    on 30s would put the spinner back for any revisit half a minute
 *    later, which is exactly the complaint this module exists to fix.
 *  - {@link DOC_CACHE_MAX_AGE_MS} is the *retention* horizon: entries
 *    older than that are dropped on access so a long session can't grow
 *    the cache without bound.
 *
 * ## Invalidation
 *
 * Writes go through `editors/shared/remote-reactor.ts`, which announces
 * every mutation and every delete on the `MutateDocument` window event.
 * This module listens for that event GLOBALLY — not per mounted consumer
 * — because a stale entry must be gone even when the view that would
 * show it is currently unmounted (edit a source in its editor, then open
 * the Sources tab). A mutated id is evicted, so the next read re-fetches
 * instead of seeding a stale document; a DELETED id stays gone, because
 * its refetch resolves as `missing` and `missing` evicts.
 */
import type { PHDocument } from "document-model";

/** Freshness horizon; matches `editors/shared/use-vault-doc-index.ts`. */
export const DOC_CACHE_TTL_MS = 30_000;

/** Retention horizon: entries older than this are dropped on access. */
export const DOC_CACHE_MAX_AGE_MS = 10 * 60_000;

/** Hard cap on retained documents; the oldest entries are dropped first. */
export const DOC_CACHE_MAX_ENTRIES = 600;

export type CachedDoc = { doc: PHDocument; fetchedAt: number };

/**
 * The three distinguishable results of a document read. The split
 * matters for the cache: a document the server says is GONE must be
 * evicted (or a deleted source ghosts on the next visit), while a
 * transport failure must NOT be — the caller keeps showing its last
 * good copy instead of the row vanishing on a connection reset.
 */
export type DocFetchOutcome =
  | { kind: "doc"; doc: PHDocument }
  | { kind: "missing" }
  | { kind: "error" };

type InFlight = {
  generation: number;
  token: object;
  promise: Promise<DocFetchOutcome>;
};

const entries = new Map<string, CachedDoc>();
const inFlight = new Map<string, InFlight>();
/**
 * Per-id write counter. Bumped on eviction so a read that was already in
 * flight when the write landed cannot resurrect the pre-write document.
 * One integer per MUTATED id, so it stays proportional to session
 * activity rather than to corpus size.
 */
const generations = new Map<string, number>();
const mutationListeners = new Set<(id: string) => void>();
/** Last non-empty id list per `retainKey` — see `recallIds`. */
const retainedIds = new Map<string, string[]>();

function generationOf(id: string): number {
  return generations.get(id) ?? 0;
}

function prune(now: number): void {
  for (const [id, entry] of entries) {
    if (now - entry.fetchedAt >= DOC_CACHE_MAX_AGE_MS) entries.delete(id);
  }
  const excess = entries.size - DOC_CACHE_MAX_ENTRIES;
  if (excess <= 0) return;
  const oldestFirst = [...entries].sort(
    (a, b) => a[1].fetchedAt - b[1].fetchedAt,
  );
  for (const [id] of oldestFirst.slice(0, excess)) entries.delete(id);
}

export function putDoc(id: string, doc: PHDocument, now = Date.now()): void {
  entries.set(id, { doc, fetchedAt: now });
  prune(now);
}

/** The cached entry for `id`, or undefined past the retention horizon. */
export function peekDoc(id: string, now = Date.now()): CachedDoc | undefined {
  const entry = entries.get(id);
  if (!entry) return undefined;
  if (now - entry.fetchedAt >= DOC_CACHE_MAX_AGE_MS) {
    entries.delete(id);
    return undefined;
  }
  return entry;
}

/** True once the entry is past its freshness horizon (still paintable). */
export function isStale(entry: CachedDoc, now = Date.now()): boolean {
  return now - entry.fetchedAt >= DOC_CACHE_TTL_MS;
}

/** Cached documents for `ids`, in the order asked for; misses omitted. */
export function cachedDocsFor(
  ids: readonly string[],
  now = Date.now(),
): PHDocument[] {
  const docs: PHDocument[] = [];
  for (const id of ids) {
    const entry = peekDoc(id, now);
    if (entry) docs.push(entry.doc);
  }
  return docs;
}

/**
 * True when every requested id has a retained entry — stale or not. This
 * is what lets a remount report `isLoading: false`: the list is complete,
 * so showing it beats showing a spinner over data we already hold.
 */
export function everyDocCached(
  ids: readonly string[],
  now = Date.now(),
): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => peekDoc(id, now) !== undefined);
}

/** Drop `id` and invalidate any read of it that is already in flight. */
export function evictDoc(id: string): void {
  entries.delete(id);
  inFlight.delete(id);
  generations.set(id, generationOf(id) + 1);
}

/**
 * Fetch `id` through the cache. Concurrent callers share one request
 * (the Sources tab and the explorer badge ask for the same ids), a
 * resolved document is cached, a document the server reports as gone is
 * evicted, and a transport failure leaves any cached entry untouched.
 */
export function fetchThroughCache(
  id: string,
  fetcher: (id: string) => Promise<DocFetchOutcome>,
  now: () => number = Date.now,
): Promise<DocFetchOutcome> {
  const existing = inFlight.get(id);
  if (existing) return existing.promise;

  const generation = generationOf(id);
  const token = {};
  const promise = Promise.resolve()
    .then(() => fetcher(id))
    .then((outcome): DocFetchOutcome => {
      if (outcome.kind === "doc") {
        // A write announced mid-flight bumped the generation: this body
        // predates the write, so it must not land in the cache.
        if (generationOf(id) === generation) putDoc(id, outcome.doc, now());
      } else if (outcome.kind === "missing") {
        entries.delete(id);
      }
      return outcome;
    })
    .catch((): DocFetchOutcome => ({ kind: "error" }))
    .finally(() => {
      if (inFlight.get(id)?.token === token) inFlight.delete(id);
    });

  inFlight.set(id, { generation, token, promise });
  return promise;
}

/**
 * Apply a server-announced mutation: drop the cached document so the
 * next read re-fetches, then tell mounted consumers to revalidate.
 */
export function handleDocumentMutation(id: string): void {
  evictDoc(id);
  for (const listener of mutationListeners) {
    try {
      listener(id);
    } catch {
      /* one broken subscriber must not break the rest */
    }
  }
}

/** Subscribe to announced mutations (used by mounted consumers). */
export function subscribeDocMutations(
  listener: (id: string) => void,
): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

/**
 * Remember the id list a consumer last asked for.
 *
 * The spec lists come from the drive tree, and the tree hook holds its
 * nodes in component state — so on remount `specs` is momentarily EMPTY
 * even though every document is still cached. Recalling the last
 * non-empty list lets the view paint its cached documents while the tree
 * reloads, instead of flashing an empty/loading panel. Nothing is
 * fetched from a recalled list: the authoritative read starts when the
 * real spec list arrives, and reconciles against it.
 */
export function rememberIds(retainKey: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  retainedIds.set(retainKey, [...ids]);
}

export function recallIds(retainKey: string): string[] {
  return retainedIds.get(retainKey) ?? [];
}

/** Test seam: module state outlives a test file otherwise. */
export function resetDocCache(): void {
  entries.clear();
  inFlight.clear();
  generations.clear();
  retainedIds.clear();
}

let wired = false;
/**
 * Wire the global `MutateDocument` listeners once. Idempotent, and a
 * no-op outside the browser so this module stays unit-testable.
 */
export function wireDocMutationEvents(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const onMutated = (event: Event) => {
    // `CustomEvent<T>.detail` is typed non-nullable, but a hand-dispatched
    // event can carry nothing — widen the payload so the guard is real.
    const detail = (event as CustomEvent<{ identifier?: string } | undefined>)
      .detail;
    if (detail?.identifier) handleDocumentMutation(detail.identifier);
  };
  window.addEventListener("MutateDocument", onMutated);
  window.addEventListener("MutateDocumentAsync", onMutated);
}

wireDocMutationEvents();
