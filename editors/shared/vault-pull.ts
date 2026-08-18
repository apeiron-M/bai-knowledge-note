/**
 * Cross-editor handle on the vault's drive-tree hydrator.
 *
 * In remote-first mode the drive tree in `window.ph.drives` is a
 * snapshot pulled from the Switchboard, not a synced replica (see
 * `knowledge-vault/hooks/use-remote-first.ts`). Any write that changes
 * the tree — create, move, delete — has to nudge that pull or the new
 * node only appears on the next poll.
 *
 * The hydrator itself lives in the knowledge-vault app (it needs the
 * remote client and Connect's `setDrives`), but the write paths that
 * need to nudge it do not all live there: `project-editor` creates WBS
 * documents too. So the registration slot lives here, in `shared`,
 * which imports from no editor folder and therefore cannot cycle.
 */

/** The active hydrator, installed by `useRemoteFirst` while mounted. */
let hydrateNow: (() => void) | null = null;

/**
 * Install (or, with `null`, clear) the hydrator. Called only by
 * `useRemoteFirst`; last mount wins, matching the single-vault-app
 * assumption Connect already makes.
 */
export function registerVaultHydrator(fn: (() => void) | null): void {
  hydrateNow = fn;
}

/**
 * Refresh the drive tree snapshot from the server immediately — call
 * after any write that changes the tree so the new node appears without
 * waiting for the poll. A no-op outside the vault app.
 */
export function triggerVaultPull(): void {
  try {
    hydrateNow?.();
  } catch {
    // Best-effort: the scheduled poll delivers the same result.
  }
}
