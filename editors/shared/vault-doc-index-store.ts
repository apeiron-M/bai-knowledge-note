/**
 * The cache behind `useVaultDocIndex`, as a plain store.
 *
 * Kept out of the hook so the caching rules — dedupe, TTL, invalidation,
 * fan-out to mounted consumers — are unit-testable without a React renderer.
 * The hook is then a thin binding over this.
 *
 * Two properties matter and both are load-bearing:
 *
 *  - **One fetch per invalidation, not one per consumer.** `invalidate`
 *    drops the entry and THEN notifies synchronously, so the first
 *    consumer to re-`read` creates the new entry and every other consumer
 *    in the same commit joins its promise. Five open editors cost one
 *    round-trip, not five.
 *
 *  - **The TTL follows the change feed.** While the Switchboard's socket is
 *    delivering, staleness is corrected by a push, so the cache can be
 *    trusted for minutes. When the feed is dead the TTL is the only thing
 *    bounding staleness, so it tightens. This is the same live/safety-net
 *    trade the polls in `use-remote-first` make.
 */

export type VaultDocSummary = {
  id: string;
  /** Best-known title: subgraph title, else the drive-tree node name. */
  title: string;
  documentType: string;
  noteType: string | null;
};

export type IndexData = {
  /** Knowledge-notes and MoCs with real titles — picker material. */
  knowledgeDocs: VaultDocSummary[];
  /** Every document in the drive. */
  all: VaultDocSummary[];
};

/** Trusted for this long while the change feed is delivering. */
export const LIVE_TTL_MS = 5 * 60_000;
/** Trusted for this long when it is not — the only bound on staleness. */
export const STALE_TTL_MS = 30_000;

export type DocIndexStore = {
  /** The index for a drive, from cache when fresh. */
  read: (driveId: string) => Promise<IndexData>;
  /** Drop the entry and tell every subscriber to re-read. */
  invalidate: (driveId: string) => void;
  subscribe: (driveId: string, fn: () => void) => () => void;
  /** Test/diagnostic view: how many fetches this store has started. */
  fetchCount: () => number;
};

export function createDocIndexStore(opts: {
  fetch: (driveId: string) => Promise<IndexData>;
  now?: () => number;
  isLive?: () => boolean;
  liveTtlMs?: number;
  staleTtlMs?: number;
}): DocIndexStore {
  const now = opts.now ?? (() => Date.now());
  const isLive = opts.isLive ?? (() => false);
  const liveTtlMs = opts.liveTtlMs ?? LIVE_TTL_MS;
  const staleTtlMs = opts.staleTtlMs ?? STALE_TTL_MS;

  const entries = new Map<string, { at: number; promise: Promise<IndexData> }>();
  const listeners = new Map<string, Set<() => void>>();
  let fetches = 0;

  return {
    read(driveId) {
      const existing = entries.get(driveId);
      const ttl = isLive() ? liveTtlMs : staleTtlMs;
      if (existing && now() - existing.at < ttl) return existing.promise;

      fetches++;
      const entry = { at: now(), promise: opts.fetch(driveId) };
      // A failed fetch must not poison the cache for the whole TTL window,
      // or one blip leaves every consumer empty until it expires.
      entry.promise.catch(() => {
        if (entries.get(driveId) === entry) entries.delete(driveId);
      });
      entries.set(driveId, entry);
      return entry.promise;
    },

    invalidate(driveId) {
      entries.delete(driveId);
      // Synchronous, and after the delete: the first re-read repopulates and
      // the rest of this commit's consumers share it.
      for (const fn of [...(listeners.get(driveId) ?? [])]) fn();
    },

    subscribe(driveId, fn) {
      let set = listeners.get(driveId);
      if (!set) {
        set = new Set();
        listeners.set(driveId, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0) listeners.delete(driveId);
      };
    },

    fetchCount: () => fetches,
  };
}

/**
 * Whether a remote change can alter what the index answers.
 *
 * The index holds a title, a document type and a note type per document.
 * A body edit to a source or a tension changes none of those, so
 * revalidating on it would spend two corpus-sized reads to learn nothing —
 * and an agent's bulk write is thousands of such events. Only three things
 * matter: the tree itself (names, membership, deletions), the drive
 * document (a rename lives there), and the two projected types whose
 * titles the index serves.
 */
export function indexAffected(change: {
  driveId: string;
  structural: boolean;
  documents: Array<{ id: string; documentType: string | null }>;
}): boolean {
  if (change.structural) return true;
  return change.documents.some(
    (d) =>
      d.id === change.driveId ||
      d.documentType === "bai/knowledge-note" ||
      d.documentType === "bai/moc",
  );
}
