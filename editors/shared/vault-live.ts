/**
 * Live-change bus for the vault.
 *
 * `useRemoteFirst` holds ONE `documentChanges` WebSocket subscription to the
 * Switchboard for the selected vault drive and re-broadcasts the events that
 * concern that drive here, as a window event. Anything that used to poll for
 * server-side changes (agents write to the vault via GraphQL, which fires no
 * browser event) listens instead:
 *
 *   - the document cache revalidates the changed document (if it holds it);
 *   - the drive-tree hydrator refreshes on structural changes;
 *   - the graph-metadata hook refetches the sidebar projection.
 *
 * This module lives in `shared` so it imports from no editor folder and can
 * be listened to from any of them without a cycle.
 *
 * `isVaultLive()` reports whether that socket is currently *delivering* —
 * connected AND seen an event within `LIVE_EVENT_TTL_MS`. Polls stay in
 * place as a safety net but back off to a slow cadence while it is true —
 * realtime is an enhancement, and a silently dead socket must never leave
 * the UI frozen on stale data. Connectedness alone is not enough for that
 * promise: a socket can hold an acked handshake and deliver nothing (a
 * server restart between pings, a proxy buffering the stream), so liveness
 * expires unless events keep renewing it.
 */

export const VAULT_REMOTE_CHANGE_EVENT = "vault:remote-change";

export type VaultRemoteChangeType =
  | "CREATED"
  | "DELETED"
  | "UPDATED"
  | "PARENT_ADDED"
  | "PARENT_REMOVED"
  | "CHILD_ADDED"
  | "CHILD_REMOVED";

export type VaultRemoteChange = {
  driveId: string;
  type: VaultRemoteChangeType;
  /** The documents in the event that belong to `driveId`. */
  documents: Array<{ id: string; documentType: string | null }>;
  /** True when the drive's node tree may have changed (create/delete/move). */
  structural: boolean;
  /** Wall-clock receipt time, ms since epoch. */
  at: number;
};

/** Event types after which the drive tree must be re-read. */
const STRUCTURAL: ReadonlySet<string> = new Set([
  "CREATED",
  "DELETED",
  "PARENT_ADDED",
  "PARENT_REMOVED",
  "CHILD_ADDED",
  "CHILD_REMOVED",
]);

export function isStructuralChange(type: string): boolean {
  return STRUCTURAL.has(type);
}

export function announceVaultRemoteChange(change: VaultRemoteChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<VaultRemoteChange>(VAULT_REMOTE_CHANGE_EVENT, {
      detail: change,
    }),
  );
}

/** Subscribe to remote changes; returns the unsubscribe function. */
export function onVaultRemoteChange(
  handler: (change: VaultRemoteChange) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<VaultRemoteChange>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(VAULT_REMOTE_CHANGE_EVENT, listener);
  return () => window.removeEventListener(VAULT_REMOTE_CHANGE_EVENT, listener);
}

let live = false;
let lastLiveEventAt = 0;
const liveListeners = new Set<(live: boolean) => void>();

/**
 * How long one delivered event vouches for the socket.
 *
 * Liveness suppresses the safety-net polls, so it must not outlive the
 * evidence for it. Past this, `isVaultLive()` reads false and the polls
 * resume on their own cadence — bounding how long a silently dead feed can
 * leave the UI stale, with no dependency on the socket noticing.
 */
export const LIVE_EVENT_TTL_MS = 60_000;

/**
 * Whether the vault's change socket is delivering right now: connected, and
 * an event arrived within {@link LIVE_EVENT_TTL_MS}.
 */
export function isVaultLive(): boolean {
  return live && Date.now() - lastLiveEventAt < LIVE_EVENT_TTL_MS;
}

/**
 * Called only by the socket owner (`useRemoteFirst`). A `true` renews the
 * vouch on every call, including when already live — liveness is a statement
 * about recent delivery, so each event has to refresh it.
 */
export function setVaultLive(next: boolean): void {
  if (next) lastLiveEventAt = Date.now();
  if (live === next) return;
  live = next;
  for (const l of liveListeners) l(next);
}

export function onVaultLiveChange(
  handler: (live: boolean) => void,
): () => void {
  liveListeners.add(handler);
  return () => {
    liveListeners.delete(handler);
  };
}

/**
 * Coalesce a burst of changes into one callback: an agent's `docs apply`
 * lands several operations within milliseconds, and the graph projection
 * behind them is updated asynchronously by the indexer. Waiting `delayMs`
 * after the LAST event both dedupes the burst and gives the projection a
 * moment to catch up.
 *
 * `maxWaitMs` bounds that wait. A pure trailing-edge debounce is reset by
 * every event, so a write stream arriving faster than `delayMs` starves it
 * for as long as the writes last — a bulk import pushes events for minutes
 * and the callback never runs, which reads to a user as "the app stopped
 * updating". The ceiling turns a sustained firehose into a steady refresh
 * every `maxWaitMs` while leaving short bursts fully coalesced.
 */
export function debounced(
  fn: () => void,
  delayMs: number,
  maxWaitMs: number = delayMs * 4,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let burstStartedAt: number | null = null;
  return () => {
    const now = Date.now();
    burstStartedAt ??= now;
    if (timer) clearTimeout(timer);
    // Never schedule past the current burst's remaining budget; at zero the
    // call fires on the next tick and the burst starts over.
    const remaining = Math.max(0, maxWaitMs - (now - burstStartedAt));
    timer = setTimeout(
      () => {
        timer = null;
        burstStartedAt = null;
        fn();
      },
      Math.min(delayMs, remaining),
    );
  };
}
