/**
 * Package-load bootstrap for remote-first mode.
 *
 * WHY THIS EXISTS
 * `useRemoteFirst()` runs inside the vault editor, so it can only take effect
 * once that editor mounts — and the editor cannot mount until Connect has
 * loaded the drive, which means replicating it. For a large vault that
 * replication is exactly what remote-first exists to prevent. Observed on a
 * cold add of a 1,112-document drive: the sync inbox dead-lettered every
 * document with `ChannelError[inbox]: Dependency cycle detected`, the drive
 * never finished loading, the editor never mounted, and remote-first therefore
 * never engaged. Remote-first was gated behind the failure it was built to
 * avoid.
 *
 * So the neutralisation has to happen at package load, before Connect attempts
 * replication. This module is React-free on purpose: it reads the sync manager
 * off `window.ph` (the same place reactor-browser's `useSync` reads it from)
 * rather than through a hook, so it can run from the package entry point.
 *
 * It is deliberately conservative:
 * - no-op outside a browser, so the node/reactor build is unaffected;
 * - only touches drives whose `preferredEditor` is the vault app, established
 *   by asking the Switchboard directly rather than through local state that
 *   may itself be mid-replication;
 * - idempotent per drive, and safe to run alongside `useRemoteFirst()`, which
 *   still owns drive hydration and selected-document freshness.
 */
import { enableRemoteFirst } from "./remote-first.js";
import { resolveReactorEndpoint } from "../hooks/subgraph-endpoint.js";

/** The drive app this package registers; drives asking for it are vault drives. */
const VAULT_APP_ID = "knowledge-vault";

/**
 * Sentinel filter that leaves the channel registered but delivering nothing.
 *
 * Do NOT relax this to sync "just the drive document": that was measured and
 * rejected. Replaying the drive's operation history with per-revision keyframes
 * of a large node state serialises past Chrome's 127 MiB-per-IndexedDB-value
 * cap (a 170 MB persist attempt) and its op stream trips the inbox scheduler's
 * dependency-cycle dead letters. Connect gets the drive's contents from
 * `hydrateDriveSnapshot` below instead of from sync.
 */
const SYNC_NOTHING = "remote-first-sync-nothing";

const POLL_MS = 400;
/** Refresh the drive snapshot on this cadence until the editor takes over. */
const HYDRATE_MS = 30_000;
/** Stop looking after this long; Connect either has a sync manager by now or never will. */
const MAX_WAIT_MS = 120_000;

let started = false;
const claimed = new Set<string>();

type Remote = {
  // `meta` and `collectionId` are typed optional on purpose: these objects
  // cross the worker RPC boundary as structured clones, so the runtime shape is
  // not guaranteed to match the declared one. The optional chaining below is
  // load-bearing, not defensive noise.
  meta?: {
    name: string;
    collectionId?: { driveId?: string };
    filter: { documentId: string[]; scope?: string[]; branch?: string };
    channelConfig: unknown;
    options: unknown;
  };
};

type SyncManager = {
  list: () => Remote[];
  remove: (name: string) => Promise<unknown>;
  add: (...args: unknown[]) => Promise<unknown>;
};

function syncManager(): SyncManager | undefined {
  return (
    globalThis as unknown as {
      ph?: {
        reactorClientModule?: {
          reactorModule?: { syncModule?: { syncManager?: SyncManager } };
        };
      };
    }
  ).ph?.reactorClientModule?.reactorModule?.syncModule?.syncManager;
}

/**
 * Ask the Switchboard whether this drive wants the vault app.
 *
 * Deliberately a plain fetch rather than the reactor client: at boot the local
 * replica is the thing that may be broken, and a drive header is one small
 * query the server can always answer.
 */
async function isVaultDrive(driveId: string): Promise<boolean> {
  const endpoint = `${resolveReactorEndpoint()}/r`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        "query($id:String!){ document(identifier:$id){ document { ... on PHDocument { preferredEditor } } } }",
      variables: { id: driveId },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { document?: { document?: { preferredEditor?: string | null } } };
  };
  return json.data?.document?.document?.preferredEditor === VAULT_APP_ID;
}

async function adopt(driveId: string, remote: Remote, sync: SyncManager) {
  const meta = remote.meta;
  if (!meta) return;
  if (!(await isVaultDrive(driveId))) return;

  // Install the GraphQL-backed client and cache first, so anything that reads
  // a document from this point on is served from the Switchboard rather than
  // from a replica that may never arrive.
  const handle = enableRemoteFirst({
    endpoint: resolveReactorEndpoint(),
    driveId,
  });

  const filter = meta.filter;
  const alreadyScoped =
    filter.documentId.length === 1 && filter.documentId[0] === SYNC_NOTHING;
  if (alreadyScoped) return;

  // Re-add under a sentinel filter rather than removing: a removed channel
  // makes Connect present the drive as local. See use-remote-first.ts.
  const { DriveCollectionId } = await import("@powerhousedao/reactor-browser");
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
    `[RemoteFirst] Sync neutralised at package load for drive ${driveId.slice(0, 8)} — ` +
      `replication skipped, reads and writes go to the Switchboard.`,
  );

  // With nothing syncing, the local drive document is a node-less stub, so
  // Connect has nothing to render. On a warm start the drive was already in
  // the snapshot from a previous session; on a COLD ADD it never is, which is
  // why the drive simply did not appear. Hydrate it here, before any editor
  // mounts. `useRemoteFirst` keeps it fresh afterwards.
  await hydrateDriveSnapshot(driveId, handle.remoteClient);
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void hydrateDriveSnapshot(driveId, handle.remoteClient).catch(() => {});
  }, HYDRATE_MS);
  timer.unref?.();
}

/**
 * Put the server's view of the drive into `window.ph.drives`.
 *
 * Connect's node machinery resolves against that snapshot, not against the
 * local replica, so this is what makes a never-replicated drive renderable.
 * `header.meta` is merged rather than replaced: the GraphQL read transform
 * drops it, and `meta.preferredEditor` is how Connect routes a drive to its
 * app — overwriting it flips the UI to the generic explorer.
 */
async function hydrateDriveSnapshot(
  driveId: string,
  client: { get: (id: string) => Promise<unknown> },
): Promise<void> {
  const serverDrive = (await client.get(driveId)) as {
    header: { id: string; meta?: Record<string, unknown> };
  };
  const { setDrives } = await import("@powerhousedao/reactor-browser");
  const current =
    ((globalThis as unknown as { ph?: { drives?: { header: { id: string } }[] } })
      .ph?.drives ?? []) as { header: { id: string; meta?: Record<string, unknown> } }[];
  const prior = current.find((d) => d.header.id === driveId);
  const merged = {
    ...serverDrive,
    header: {
      ...serverDrive.header,
      meta: {
        preferredEditor: VAULT_APP_ID,
        ...prior?.header?.meta,
        ...serverDrive.header.meta,
      },
    },
  };
  const next = prior
    ? current.map((d) => (d.header.id === driveId ? merged : d))
    : [...current, merged];
  setDrives(next as never);
  console.info(
    `[RemoteFirst] Drive snapshot hydrated from the Switchboard for ${driveId.slice(0, 8)}.`,
  );
}

function sweep(startedAt: number, timer: ReturnType<typeof setInterval>): void {
  const sync = syncManager();
  if (!sync) {
    if (Date.now() - startedAt > MAX_WAIT_MS) clearInterval(timer);
    return;
  }
  let remotes: Remote[];
  try {
    remotes = sync.list();
  } catch {
    return; // manager present but not ready; try again next tick
  }
  for (const remote of remotes) {
    const driveId = remote?.meta?.collectionId?.driveId;
    if (!driveId || claimed.has(driveId)) continue;
    // Claim before awaiting so a slow header lookup cannot be started twice.
    claimed.add(driveId);
    void adopt(driveId, remote, sync).catch((error) => {
      claimed.delete(driveId);
      console.warn(
        `[RemoteFirst] Could not neutralise drive ${driveId.slice(0, 8)} at boot:`,
        error,
      );
    });
  }
}

/**
 * Begin watching for vault drives and neutralising their sync channels.
 * Safe to call more than once; only the first call does anything.
 */
export function startRemoteFirstBoot(): void {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;
  const startedAt = Date.now();
  const timer = setInterval(() => sweep(startedAt, timer), POLL_MS);
  // Also sweep immediately: on a warm reload the sync manager already exists.
  sweep(startedAt, timer);
}
