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
 *
 *  5. Listen. The Switchboard pushes every document change over a
 *     `documentChanges` WebSocket subscription. One socket per selected
 *     drive: an event about a document in this drive revalidates its
 *     cache entry (if held), re-hydrates the tree when the change was
 *     structural, and is re-broadcast on the `vault:remote-change` bus
 *     for the sidebar and any other listener. While the socket is up the
 *     polls in 3 and 4 back off to a slow safety-net cadence; the moment
 *     it drops they resume, so a dead socket can never freeze the UI.
 *
 *     The subscription is a firehose by design — the server's `search`
 *     filter matches `parentId` only on structural events and would drop
 *     every UPDATE — so membership is decided here, against the hydrated
 *     drive snapshot.
 */
import { PollBehavior } from "@powerhousedao/reactor";
import { getBearerToken } from "../../shared/authed-fetch.js";
import { useEffect, useRef } from "react";
import {
  DriveCollectionId,
  setDrives,
  subscriptionsUrlFromGraphqlUrl,
  useDrives,
  useRenownAuth,
  useSelectedDrive,
  useSelectedNode,
  useSync,
} from "@powerhousedao/reactor-browser";
import type { IDocumentCache } from "@powerhousedao/reactor-browser";
import { createClient as createWsClient } from "graphql-ws";
import { resolveReactorEndpoint } from "./subgraph-endpoint.js";
import { enableRemoteFirst, withTransientRetry } from "../lib/remote-first.js";
import { registerVaultHydrator } from "../../shared/vault-pull.js";
import { closeCodeOf, refusedForMissingToken } from "../lib/live-feed-policy.js";
import {
  announceVaultRemoteChange,
  debounced,
  isStructuralChange,
  isVaultDocumentType,
  isVaultLive,
  setVaultLive,
  type VaultRemoteChangeType,
} from "../../shared/vault-live.js";

/**
 * Re-exported from `shared/vault-pull.ts`, where the registration slot
 * now lives so write paths outside this editor (the scope-of-work editor's remote
 * WBS create) can nudge the same hydrator.
 */
export { triggerVaultPull } from "../../shared/vault-pull.js";

/** How often an open document is refreshed from the server (socket down). */
const SELECTED_DOC_REFRESH_MS = 20_000;

/**
 * How often the drive tree snapshot is refreshed from the server (socket
 * down). Local writes refresh immediately via MutateDocument events; this
 * poll only covers tree changes made by agents server-side, so it can be
 * lazy.
 */
const DRIVE_HYDRATE_MS = 30_000;

/**
 * Safety-net cadence for both polls while the change socket is live — and
 * "live" means an event was delivered within `LIVE_EVENT_TTL_MS`, not
 * merely that the handshake was acked (see the feed effect). Not zero: a
 * socket can be up and still miss an event (server restart between pings, a
 * filtered event we mis-classified). Liveness expiring is the tighter of
 * the two bounds — a feed that goes quiet resumes polling one TTL later,
 * whatever this says — so this only caps a feed that is still delivering.
 */
const LIVE_SAFETY_NET_MS = 5 * 60_000;

/** The `documentChanges` subscription — narrow selection, we only need ids. */
const DOCUMENT_CHANGES_QUERY = `
  subscription VaultDocumentChanges {
    documentChanges {
      type
      documents { id documentType }
      context { parentId childId }
    }
  }
`;

type DocumentChangesEvent = {
  type: VaultRemoteChangeType;
  documents: Array<{ id: string; documentType: string | null }>;
  context: { parentId: string | null; childId: string | null } | null;
};

/** Drives whose sync channel has already been scoped to nothing. */
const scopedDrives = new Set<string>();

/**
 * Set once a tokenless websocket handshake has been refused this page. A
 * protected Switchboard refuses every such handshake the same way and logs
 * each one as an error, so having learnt it once there is nothing to gain by
 * asking again until a session exists — and the feed effect re-runs the
 * moment one does.
 */
let anonymousRefused = false;

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
  // The signed-in address, from the same source AuthGate reads. It is a
  // dependency of the live-feed effect: a refused tokenless handshake is
  // never retried by graphql-ws, so the socket has to be re-created — not
  // reconnected — when a session appears, changes, or ends.
  const { address } = useRenownAuth();
  const drivesRef = useRef(drives);
  drivesRef.current = drives;
  /** Step 3's hydrator, for step 5 to call on structural events. */
  const hydrateRef = useRef<(() => void) | null>(null);
  /** The same hydrator, coalesced — for the high-frequency event paths. */
  const hydrateSoonRef = useRef<(() => void) | null>(null);

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
          // Scoped is NOT sufficient. A channel persisted by a session from
          // before the cadence fix is already scoped to the sentinel and
          // still on PollBehavior.Auto — returning here would leave it
          // polling an empty outbox roughly once a second, forever, which is
          // the exact traffic the scoping was meant to stop. Skip only when
          // the filter AND the cadence are both already right.
          // `meta.options` is typed non-nullish on a registered channel, and
          // the whole loop runs inside the try/catch below, so a surprising
          // absence degrades to "re-add the channel" rather than throwing.
          const alreadyManual =
            (meta.options as { pollBehavior?: PollBehavior }).pollBehavior ===
            PollBehavior.Manual;
          if (alreadyScoped && alreadyManual) return;

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
            // A channel scoped to SYNC_NOTHING has nothing to fetch, so leaving the
            // cadence at its default (PollBehavior.Auto) spends a request a second
            // on an empty outbox — measured at 136 requests and 3.2 MB in one
            // session, all of it `outboxAck: 0, outboxLatest: 0`.
            //
            // Manual keeps the channel registered, which is the point of re-adding
            // rather than removing (a removed channel makes Connect present the
            // drive as local), while stopping the timer. Nothing is lost: the
            // filter already guarantees there is nothing to replicate, and
            // `ISyncManager.triggerPull(name)` remains available if a pull is ever
            // wanted.
            { ...meta.options, pollBehavior: PollBehavior.Manual },
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
    hydrateRef.current = () => void hydrate();
    void hydrate();
    let lastPollAt = Date.now();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Socket up: the tree is pushed to us; poll only as a safety net.
      if (isVaultLive() && Date.now() - lastPollAt < LIVE_SAFETY_NET_MS)
        return;
      lastPollAt = Date.now();
      void hydrate();
    }, DRIVE_HYDRATE_MS);
    // Any announced mutation may have changed the tree — but a write burst
    // announces one event per operation, and each hydrate is a full ~300 kB
    // drive read. The `inFlight` guard above only drops CONCURRENT calls, so
    // a sequence of writes spaced further apart than one round-trip used to
    // pay the full cost for every one of them. Coalesce instead; 400 ms is
    // imperceptible for a local write and collapses an agent's `docs apply`
    // into a single read.
    const hydrateSoon = debounced(() => void hydrate(), 400, 2_000);
    hydrateSoonRef.current = hydrateSoon;
    const onMutation = () => hydrateSoon();
    window.addEventListener("MutateDocument", onMutation);
    return () => {
      cancelled = true;
      registerVaultHydrator(null);
      hydrateRef.current = null;
      hydrateSoonRef.current = null;
      clearInterval(interval);
      window.removeEventListener("MutateDocument", onMutation);
    };
  }, [driveId, address]);

  // ── 4. Selected-document freshness ────────────────────────────────
  const selectedId = selectedNode?.id;
  useEffect(() => {
    if (!selectedId || !driveId || selectedId === driveId) return;
    let lastPollAt = Date.now();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Socket up: an UPDATED event revalidates this document the moment
      // it changes; poll only as a safety net.
      if (isVaultLive() && Date.now() - lastPollAt < LIVE_SAFETY_NET_MS)
        return;
      lastPollAt = Date.now();
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

  // ── 5. Live change feed ───────────────────────────────────────────
  useEffect(() => {
    if (!driveId) return;
    // Do not knock again on a door this page already found locked. Without
    // this, every mount while signed out (StrictMode doubles them in dev)
    // wrote another "Internal error" line into the Switchboard log.
    if (!address && anonymousRefused) {
      console.info(
        "[RemoteFirst] Live change feed is waiting for sign-in; polling continues.",
      );
      return;
    }
    let stopped = false;
    /** Whether the most recent handshake carried a bearer. */
    let hadToken = false;

    const wsUrl = subscriptionsUrlFromGraphqlUrl(resolveReactorEndpoint());
    const client = createWsClient({
      url: wsUrl,
      // The subscription is a second door onto the same data as the HTTP
      // reads, and it is NOT covered by REQUIRE_AUTHENTICATED_CALLER, which
      // is a fetch middleware. With AUTH_ENABLED=true the server refuses a
      // tokenless connection outright ("Missing authorization in connection
      // parameters"). Resolved per connection so a reconnect carries the
      // current session; the effect's `address` dependency covers the case
      // graphql-ws will not reconnect from (see `error` below).
      connectionParams: async () => {
        const token = await getBearerToken();
        hadToken = !!token;
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      // Keep trying for as long as the drive is selected: the Switchboard
      // restarts during development and deploys, and a socket that gives
      // up after five attempts silently degrades the app to polling.
      // graphql-ws still treats a handful of close codes as fatal whatever
      // this says — 4500 among them, which is what a tokenless handshake
      // gets — so those are handled by re-creating the socket, not here.
      retryAttempts: Number.POSITIVE_INFINITY,
      shouldRetry: () => !stopped,
      // Note when the SERVER stops answering, not just when the TCP link
      // is up; a half-open connection would otherwise report live.
      keepAlive: 30_000,
      on: {
        connected: () => {
          if (stopped) return;
          // Connected is not yet LIVE. "Live" — which backs the safety-net
          // polls off to five minutes — is earned by the first event that
          // actually arrives (see `next`). A server or proxy that acks the
          // handshake but never delivers would otherwise make the app
          // slower than it was before the feed existed.
          console.info(
            `[RemoteFirst] Live change feed connected (${wsUrl}) for drive ${driveId.slice(0, 8)}; awaiting first event.`,
          );
          // Anything that happened while the socket was down is unknown
          // to us; one hydrate closes the gap. The cache's own
          // revalidation covers the selected document on its next poll.
          hydrateRef.current?.();
        },
        closed: (event) => {
          setVaultLive(false);
          if (refusedForMissingToken(closeCodeOf(event), hadToken)) {
            anonymousRefused = true;
          }
        },
        error: () => setVaultLive(false),
      },
    });

    /** Ids the hydrated snapshot says are in this drive. */
    const driveMembers = (): Set<string> | null => {
      const drive = (drivesRef.current ?? []).find(
        (d) => d.header.id === driveId,
      ) as unknown as
        | { state?: { global?: { nodes?: Array<{ id: string }> } } }
        | undefined;
      const nodes = drive?.state?.global?.nodes;
      if (!nodes) return null;
      return new Set(nodes.map((n) => n.id));
    };

    const cacheOf = () =>
      (
        window as unknown as {
          ph?: {
            documentCache?: IDocumentCache & {
              revalidateInBackground?: (id: string) => void;
            };
          };
        }
      ).ph?.documentCache;

    const unsubscribe = client.subscribe<{
      documentChanges: DocumentChangesEvent;
    }>(
      { query: DOCUMENT_CHANGES_QUERY },
      {
        next: (result) => {
          const event = result.data?.documentChanges;
          if (!event || stopped) return;
          // Proof the socket delivers, not just connects: any event —
          // ours or another drive's — is enough to trust it. Called on
          // EVERY event, not only the first: liveness expires (see
          // LIVE_EVENT_TTL_MS) and each event is what renews it.
          setVaultLive(true);

          const members = driveMembers();
          const structural =
            isStructuralChange(event.type) &&
            (event.context?.parentId === driveId ||
              event.documents.some((d) => d.id === driveId));
          // Membership: the drive itself, anything the snapshot lists, or
          // — before the snapshot exists — any vault document type, so a
          // cold open is not blind to its own first events.
          const documents = event.documents.filter(
            (d) =>
              d.id === driveId ||
              (members ? members.has(d.id) : isVaultDocumentType(d.documentType)),
          );
          if (documents.length === 0 && !structural) return;

          // 1. Refresh what we hold. No-op for documents not in the cache,
          //    so a firehose of edits elsewhere costs nothing here.
          const cache = cacheOf();
          if (cache?.revalidateInBackground) {
            for (const d of documents) {
              if (d.id !== driveId) cache.revalidateInBackground(d.id);
            }
          }

          // 2. The tree changed, or the drive document itself did. Routed
          //    through the coalescing hydrator for the same reason as the
          //    MutateDocument path: a bulk server-side import pushes a
          //    structural event per document.
          if (structural || documents.some((d) => d.id === driveId)) {
            hydrateSoonRef.current?.();
          }

          // 3. Tell everyone else (sidebar projection, graph, health).
          announceVaultRemoteChange({
            driveId,
            type: event.type,
            documents,
            structural,
            at: Date.now(),
          });
        },
        error: (error) => {
          setVaultLive(false);
          // A tokenless handshake refused for want of credentials is not a
          // fault, it is a state: say so plainly instead of warning, and
          // stop asking until a session exists (the effect re-runs then).
          if (refusedForMissingToken(closeCodeOf(error), hadToken)) {
            anonymousRefused = true;
            console.info(
              "[RemoteFirst] Live change feed needs a signed-in session; it will connect after sign-in. Polling continues.",
            );
            return;
          }
          // graphql-ws delivers this when retries are exhausted or the
          // server rejected the subscription; with infinite retries it is
          // effectively "rejected". Polling is still running.
          console.warn(
            "[RemoteFirst] Live change feed unavailable; polling continues:",
            error,
          );
        },
        complete: () => setVaultLive(false),
      },
    );

    return () => {
      stopped = true;
      setVaultLive(false);
      try {
        unsubscribe();
      } finally {
        void client.dispose();
      }
    };
  }, [driveId, address]);
}
