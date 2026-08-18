/**
 * Orchestrates remote-first mode for the vault drive.
 *
 *  1. Swap document reads/writes to the Switchboard while this drive is
 *     selected (see `lib/remote-first.ts`); restore on unmount so other
 *     drives in the same Connect session keep default local-first
 *     behaviour. The swap happens DURING render: on a deep-linked
 *     document URL, Connect renders the document editor in the same
 *     commit as this app's first render, and an effect would swap the
 *     cache one paint too late.
 *
 *  2. Neutralise the drive's sync channel. Even syncing only the drive
 *     document is untenable here: replaying its ~3k-operation history
 *     with per-revision keyframes of a 1,500-node state serialises past
 *     Chrome's 127 MiB-per-IndexedDB-value cap (measured: a 170 MB
 *     persist attempt), and its op stream trips the inbox scheduler's
 *     dependency-cycle dead letters. The channel filter is set to a
 *     sentinel documentId that matches nothing — the server's
 *     `filterOperations` then serves empty envelopes, the local replica
 *     stays at its PGlite baseline, and every read/write goes to the
 *     Switchboard instead.
 *
 *  3. Hydrate Connect's drive snapshot from the server. With nothing
 *     syncing, the local drive document is a node-less stub, and
 *     Connect's node machinery (`useSelectedNode` → document editors
 *     mounting) resolves against the `window.ph.drives` snapshot. So
 *     the snapshot is refreshed from the Switchboard — immediately, on
 *     every announced mutation, and on a poll — using the same
 *     `GraphQLReactorClient.get` transform Connect itself uses.
 *
 *  4. Keep the selected document fresh: agents write to the vault
 *     server-side and those writes fire no browser event, so an open
 *     document's cache entry is refetched on an interval.
 */
import { useEffect, useRef } from "react";
import {
  DriveCollectionId,
  setDrives,
  useDrives,
  useSelectedDrive,
  useSelectedNode,
  useSync,
} from "@powerhousedao/reactor-browser";
import type { IDocumentCache } from "@powerhousedao/reactor-browser";
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";
import { enableRemoteFirst, withTransientRetry } from "../lib/remote-first.js";
import { registerVaultHydrator } from "../../shared/vault-pull.js";

/**
 * Re-exported from `shared/vault-pull.ts`, where the registration slot
 * now lives so write paths outside this editor (project-editor's remote
 * WBS create) can nudge the same hydrator.
 */
export { triggerVaultPull } from "../../shared/vault-pull.js";

/** How often an open document is refreshed from the server. */
const SELECTED_DOC_REFRESH_MS = 20_000;

/**
 * How often the drive tree snapshot is refreshed from the server.
 * Local writes refresh immediately via MutateDocument events; this poll
 * only covers tree changes made by agents server-side, so it can be lazy.
 */
const DRIVE_HYDRATE_MS = 30_000;

/** Drives whose sync channel we already neutralised this session. */
/** Drives whose sync channel has already been scoped to nothing. */
const scopedDrives = new Set<string>();

/**
 * Sentinel document id the sync channel is filtered to. Keeps the channel
 * REGISTERED — so Connect still shows the drive as remote — while making
 * it deliver nothing. Removing the channel outright also stops its
 * polling, but Connect then renders the drive as local.
 */
const SYNC_NOTHING = "remote-first-sync-nothing";

export function useRemoteFirst(): void {
  const [selectedDrive] = useSelectedDrive();
  // Typed non-null upstream, but during drive-switch teardown it can be
  // momentarily absent at runtime — guard structurally, not with `?.`.
  const header = (selectedDrive as { header?: { id: string; slug: string } })
    .header;
  const driveId = header?.id;
  const driveSlug = header?.slug;
  const sync = useSync();
  const selectedNode = useSelectedNode();
  const drives = useDrives();
  const drivesRef = useRef(drives);
  drivesRef.current = drives;

  // ── 1. Client + cache swap (render-time, idempotent per drive) ────
  const handleRef = useRef<ReturnType<typeof enableRemoteFirst> | null>(null);
  if (driveId) {
    handleRef.current = enableRemoteFirst({
      endpoint: resolveReactorEndpoint(),
      driveId,
      driveSlug,
    });
  }
  useEffect(() => {
    return () => {
      // Restore the previous client/cache ONLY when the user actually
      // switched away from this drive. The editor also unmounts on local
      // package hot-updates and StrictMode remounts — with the vault
      // still selected. Restoring then re-exposes the default
      // worker-backed cache to Connect's fallback explorer, which
      // crashes on the (deliberately empty) replica and latches the
      // app-level error boundary, whose reset key is the drive id.
      const currentDrive = (
        window as unknown as { ph?: { selectedDriveId?: string } }
      ).ph?.selectedDriveId;
      if (currentDrive !== driveId) handleRef.current?.restore();
    };
  }, [driveId]);

  // ── 2. Neutralise the sync channel ────────────────────────────────
  useEffect(() => {
    if (!driveId || !sync || scopedDrives.has(driveId)) return;
    scopedDrives.add(driveId);

    void (async () => {
      try {
        for (const remote of sync.list()) {
          const meta = remote.meta;
          // Over the worker RPC boundary `collectionId` arrives as a
          // structured clone — data properties survive, methods don't —
          // so match on the plain `driveId` field.
          const remoteDriveId = (
            meta.collectionId as unknown as { driveId?: string }
          ).driveId;
          if (remoteDriveId !== driveId) continue;

          const filter = meta.filter;
          const alreadyScoped =
            filter.documentId.length === 1 &&
            filter.documentId[0] === SYNC_NOTHING;
          if (alreadyScoped) return;

          // Re-add under a sentinel filter rather than removing. The
          // channel keeps polling (`pollSyncEnvelopes`, always empty),
          // which costs a small request every few seconds and re-renders
          // sync subscribers — but it stays REGISTERED, so Connect still
          // presents the drive as remote. Removing it silences the poll
          // and flips the drive's icon to local, which is worse.
          await sync.remove(meta.name);
          await sync.add(
            meta.name,
            DriveCollectionId.forDrive(driveId, filter.branch || "main"),
            meta.channelConfig,
            {
              documentId: [SYNC_NOTHING],
              scope: filter.scope,
              branch: filter.branch || "main",
            },
            meta.options,
          );
          console.info(
            `[RemoteFirst] Sync channel for drive ${driveId.slice(0, 8)} neutralised — all reads/writes go to the Switchboard.`,
          );
          return;
        }
      } catch (error) {
        // Degraded, not broken: reads/writes are already remote; an
        // unscoped channel only means background pulls continue.
        console.warn(
          "[RemoteFirst] Could not neutralise the sync channel:",
          error,
        );
        scopedDrives.delete(driveId);
      }
    })();
  }, [driveId, sync]);

  // ── 3. Server-side drive-tree hydration ───────────────────────────
  useEffect(() => {
    if (!driveId) return;
    let cancelled = false;
    let inFlight = false;

    const hydrate = async () => {
      const client = handleRef.current?.remoteClient;
      if (!client || inFlight) return;
      inFlight = true;
      try {
        const serverDrive = await withTransientRetry(() =>
          client.get(driveId),
        );
        if (cancelled) return;
        const current = drivesRef.current ?? [];
        const prior = current.find((d) => d.header.id === driveId);
        // The GraphQL read transform does not carry `header.meta`, and
        // `meta.preferredEditor` is how Connect routes a drive to its
        // app. Overwriting the snapshot without it flips the UI to the
        // generic explorer a few seconds after open. Preserve the prior
        // meta — and since this hook only ever runs inside the
        // knowledge-vault app, self-heal a missing pointer with our own
        // app id (module.ts `config.id`).
        const priorMeta = (prior?.header as { meta?: Record<string, unknown> })
          ?.meta;
        const serverMeta = (
          serverDrive.header as { meta?: Record<string, unknown> }
        ).meta;
        const mergedMeta = {
          preferredEditor: "knowledge-vault",
          ...priorMeta,
          ...serverMeta,
        };
        const merged = {
          ...serverDrive,
          header: { ...serverDrive.header, meta: mergedMeta },
        };
        const next = prior
          ? current.map((d) => (d.header.id === driveId ? merged : d))
          : [...current, merged];
        setDrives(next as never);
      } catch (error) {
        console.warn("[RemoteFirst] Drive hydration failed:", error);
      } finally {
        inFlight = false;
      }
    };

    registerVaultHydrator(() => void hydrate());
    void hydrate();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void hydrate();
    }, DRIVE_HYDRATE_MS);
    // Any announced mutation may have changed the tree.
    const onMutation = () => void hydrate();
    window.addEventListener("MutateDocument", onMutation);
    return () => {
      cancelled = true;
      registerVaultHydrator(null);
      clearInterval(interval);
      window.removeEventListener("MutateDocument", onMutation);
    };
  }, [driveId]);

  // ── 4. Selected-document freshness ────────────────────────────────
  const selectedId = selectedNode?.id;
  useEffect(() => {
    if (!selectedId || !driveId || selectedId === driveId) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Never revalidate under the user's cursor. The cache swap itself
      // is now invisible (stale-while-revalidate), but a remote edit
      // landing mid-sentence would still move content the user is
      // reading or typing into.
      const active = document.activeElement;
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      try {
        // `get(id, refetch: true)` revalidates in the BACKGROUND and
        // notifies only if the version actually changed — it no longer
        // installs a pending promise, so open editors never suspend.
        const cache = (
          window as unknown as {
            ph?: {
              documentCache?: IDocumentCache & {
                revalidateInBackground?: (id: string) => void;
              };
            };
          }
        ).ph?.documentCache;
        // Prefer the explicitly non-suspending path. `get(id, true)` is the
        // fallback for a default cache that lacks it; ours cannot suspend.
        if (cache?.revalidateInBackground) cache.revalidateInBackground(selectedId);
        else void cache?.get(selectedId, true);
      } catch {
        // A transient fetch failure surfaces on the next tick.
      }
    }, SELECTED_DOC_REFRESH_MS);
    return () => clearInterval(interval);
  }, [selectedId, driveId]);
}
