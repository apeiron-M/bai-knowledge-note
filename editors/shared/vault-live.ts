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
 * `isVaultLive()` reports whether that socket is currently connected. Polls
 * stay in place as a safety net but back off to a slow cadence while it is
 * true — realtime is an enhancement, and a silently dead socket must never
 * leave the UI frozen on stale data.
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
const liveListeners = new Set<(live: boolean) => void>();

/** Whether the vault's change socket is connected right now. */
export function isVaultLive(): boolean {
  return live;
}

/** Called only by the socket owner (`useRemoteFirst`). */
export function setVaultLive(next: boolean): void {
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
 */
export function debounced(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}
