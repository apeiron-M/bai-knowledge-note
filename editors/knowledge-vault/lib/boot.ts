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
import { PollBehavior } from "@powerhousedao/reactor";
import { authHeaders, getBearerToken } from "../../shared/authed-fetch.js";
import {
  createRemoteMemory,
  driveUrlFromSearch,
  type RemoteMemory,
  type StorageLike,
} from "./remote-memory.js";
import { hasVaultHydrator } from "../../shared/vault-pull.js";
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
/**
 * How often the drive snapshot is re-read as a safety net.
 *
 * Was 30s, which re-downloaded the whole drive document — ~300 kB on a
 * 1,500-node drive, so roughly 36 MB an hour per open tab — to detect changes
 * that usually had not happened. The `documentChanges` subscription is the
 * real-time path; this is only the backstop for when it drops, so it does not
 * need to be fast. Paired with the cheap freshness check below, an unchanged
 * drive now costs a few hundred bytes instead of 300 kB.
 */
const HYDRATE_MS = 180_000;
/** Stop looking after this long; Connect either has a sync manager by now or never will. */
const MAX_WAIT_MS = 120_000;

let started = false;
const claimed = new Set<string>();

/**
 * How long after the sync manager first appears before a remembered drive
 * missing from `sync.list()` counts as dropped. `startup()` fills the list
 * asynchronously, one `channel.init()` at a time; acting on a half-built list
 * would re-add a remote the manager is about to add itself.
 */
const RECOVERY_GRACE_MS = 3_000;
let syncSeenAt: number | null = null;
let recovering = false;
let shareLinkReplayed = false;
/** Drives whose read probe was refused this page: signed in, but not granted. */
const refused = new Set<string>();

let memory: RemoteMemory | null = null;
/**
 * The cross-page memory of adopted drives (see remote-memory.ts). Falls back
 * to a page-scoped map when localStorage is absent or throws, so the memory
 * can never be the reason boot fails.
 */
function remoteMemory(): RemoteMemory {
  if (memory) return memory;
  let storage: StorageLike;
  try {
    storage = globalThis.localStorage;
    storage.getItem("remote-first:probe");
  } catch {
    const map = new Map<string, string>();
    storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }
  memory = createRemoteMemory(storage);
  return memory;
}

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
    headers: await authHeaders(),
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
  if (!alreadyScoped) {
    // Re-add under a sentinel filter rather than removing: a removed channel
    // makes Connect present the drive as local. See use-remote-first.ts.
    const { DriveCollectionId } = await import(
      "@powerhousedao/reactor-browser"
    );
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
      {
        ...((meta.options ?? {}) as Record<string, unknown>),
        pollBehavior: PollBehavior.Manual,
      } as typeof meta.options,
    );
    console.info(
      `[RemoteFirst] Sync neutralised at package load for drive ${driveId.slice(0, 8)} — ` +
        `replication skipped, reads and writes go to the Switchboard.`,
    );
  }

  // Remember the registration, so a boot that drops this remote — a tokenless
  // `channel.init()` at startup, see remote-memory.ts — can put it back once a
  // session exists, without a refresh and without the user re-adding it.
  remoteMemory().remember({
    driveId,
    name: meta.name,
    branch: filter.branch || "main",
    scope: filter.scope ?? [],
    channelConfig: meta.channelConfig,
    options: (meta.options ?? undefined) as Record<string, unknown> | undefined,
  });

  // Hydration must run on EVERY boot, warm or cold — this is the fix for
  // the disappearing-drive bug. Nothing about a remote-first drive is
  // persisted locally: `addRemoteDrive` registers only a sync channel (the
  // drive document normally materialises via replication, which we
  // neutralise above before the first envelope lands), and the snapshot
  // written by `hydrateDriveSnapshot` lives in in-memory `ph.drives` state
  // that dies with the tab. The sync manager persists remote registrations
  // and recreates them at startup, so on a warm start `alreadyScoped` is
  // true — and an early return from that branch, as this code originally
  // did, skips the ONLY code path that can put the drive back on screen.
  // Connect then boots to an empty sidebar until the user clears site data
  // and re-adds the drive. `useRemoteFirst` takes over freshness once the
  // editor mounts.
  await hydrateDriveSnapshot(driveId, handle.remoteClient);
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    // Stand down once the editor is mounted: `useRemoteFirst` installs its
    // own hydrator with a tighter cadence, a change-feed subscription and
    // MutateDocument handling. Running both meant two independent full
    // drive reads of the same document. (This timer cannot simply be
    // cleared — the editor unmounts on hot-updates and drive switches, and
    // this is the only refresh before it mounts again.)
    if (hasVaultHydrator()) return;
    // The first hydration above is unconditional — nothing about a
    // remote-first drive is persisted locally, so the snapshot must exist.
    // Only the refresh is skippable.
    void driveChangedSince(driveId)
      .then((changed) =>
        changed ? hydrateDriveSnapshot(driveId, handle.remoteClient) : undefined,
      )
      .catch(() => {});
  }, HYDRATE_MS);
  // NOTE: no `unref()` here. `Timeout.unref` is a Node API; in the browser
  // `setInterval` returns a number and the call was silently a no-op, which
  // read as if the timer had been made harmless when it had not.
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
/**
 * Last value we hydrated, so an unchanged drive can be skipped without pulling
 * its whole node list.
 */
let lastHydratedAt: string | null = null;

/**
 * Cheap check: has the drive changed since we last hydrated?
 *
 * `lastModifiedAtUtcIso` is a scalar on the drive document, so asking for it
 * alone costs a few hundred bytes against ~300 kB for the full state. Any
 * failure returns true — a freshness probe must never be the reason the
 * snapshot goes stale.
 */
async function driveChangedSince(driveId: string): Promise<boolean> {
  try {
    const res = await fetch(`${resolveReactorEndpoint()}/r`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        query:
          "query F($id:String!){ document(identifier:$id){ document { lastModifiedAtUtcIso } } }",
        variables: { id: driveId },
      }),
    });
    if (!res.ok) return true;
    const json = (await res.json()) as {
      data?: { document?: { document?: { lastModifiedAtUtcIso?: string } } };
    };
    const stamp = json.data?.document?.document?.lastModifiedAtUtcIso;
    if (!stamp) return true;
    if (stamp === lastHydratedAt) return false;
    lastHydratedAt = stamp;
    return true;
  } catch {
    return true;
  }
}

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

type ReadVerdict = "readable" | "refused" | "unreachable";

/**
 * Can the current session read this drive? Asked BEFORE re-adding a dropped
 * remote, because `sync.add` removes the persisted record when its init fails:
 * re-adding blind would turn "hidden until refresh" into "gone until re-added
 * by link" for someone who has signed in but not yet been granted.
 */
async function probeDriveReadable(driveId: string): Promise<ReadVerdict> {
  try {
    const res = await fetch(`${resolveReactorEndpoint()}/r`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        query: "query P($id:String!){ document(identifier:$id){ document { id } } }",
        variables: { id: driveId },
      }),
    });
    if (res.status === 401 || res.status === 403) return "refused";
    if (!res.ok) return "unreachable";
    const json = (await res.json()) as {
      data?: { document?: { document?: { id?: string } | null } | null };
      errors?: { extensions?: { code?: string } }[];
    };
    const code = json.errors?.[0]?.extensions?.code;
    if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") return "refused";
    return json.data?.document?.document?.id ? "readable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * Put back what a tokenless boot dropped, now that a session exists.
 *
 * Runs from the sweep once the sync manager has had a moment to finish its own
 * startup. Both jobs wait for a bearer: without one the requests would fail
 * exactly as the boot-time ones did — and `sync.add`'s failure path deletes
 * the persisted record, which is worse than leaving the drive hidden.
 */
async function recover(sync: SyncManager): Promise<void> {
  if (recovering) return;
  recovering = true;
  try {
    const token = await getBearerToken();
    if (!token) return;
    const mem = remoteMemory();

    // 1. A share link whose `driveUrl` the Renown redirect discarded.
    const url = mem.pendingDriveUrl();
    if (url && !shareLinkReplayed) {
      shareLinkReplayed = true;
      try {
        const { addRemoteDrive } = await import("@powerhousedao/reactor-browser");
        await addRemoteDrive(url);
        mem.clearDriveUrl();
        console.info(`[RemoteFirst] Added the shared drive from ${url} after sign-in.`);
      } catch (error) {
        // Signed in but not granted: Connect has shown its own "access
        // required" modal. Do not replay on every boot after that.
        mem.clearDriveUrl();
        console.warn("[RemoteFirst] Could not add the shared drive after sign-in:", error);
      }
    }

    // 2. Remembered drives the manager dropped at its startup.
    const listed: string[] = [];
    for (const r of sync.list()) {
      const id = r.meta?.collectionId?.driveId;
      if (id) listed.push(id);
    }
    for (const r of mem.missing(listed)) {
      if (claimed.has(r.driveId) || refused.has(r.driveId)) continue;
      claimed.add(r.driveId);
      try {
        const verdict = await probeDriveReadable(r.driveId);
        if (verdict === "refused") {
          refused.add(r.driveId);
          console.info(
            `[RemoteFirst] Drive ${r.driveId.slice(0, 8)} is not readable by this account; leaving it hidden.`,
          );
          continue;
        }
        if (verdict === "unreachable") {
          claimed.delete(r.driveId); // try again next tick
          continue;
        }
        // Same name as the dropped record, so the persisted entry is
        // overwritten rather than joined by a duplicate channel.
        const { DriveCollectionId } = await import("@powerhousedao/reactor-browser");
        await sync.add(
          r.name,
          DriveCollectionId.forDrive(r.driveId, r.branch),
          r.channelConfig,
          { documentId: [SYNC_NOTHING], scope: r.scope, branch: r.branch },
          { ...(r.options ?? {}), pollBehavior: PollBehavior.Manual },
        );
        const remote = sync.list().find((x) => x.meta?.name === r.name);
        if (!remote) throw new Error("the re-added remote is not listed");
        console.info(
          `[RemoteFirst] Drive ${r.driveId.slice(0, 8)} was dropped at boot (no session yet); re-registered now that one exists.`,
        );
        await adopt(r.driveId, remote, sync);
      } catch (error) {
        claimed.delete(r.driveId);
        console.warn(`[RemoteFirst] Could not restore drive ${r.driveId.slice(0, 8)}:`, error);
      }
    }
  } finally {
    recovering = false;
  }
}

function sweep(startedAt: number, timer: ReturnType<typeof setInterval>): void {
  // Boot-time adoption is a bounded job: `useRemoteFirst` neutralises the
  // channel for any drive the user selects later. The deadline used to apply
  // only to the "no sync manager yet" branch, so as soon as a manager
  // existed this 400 ms timer ran for the life of the page, re-listing
  // remotes forever with nothing left to adopt.
  if (Date.now() - startedAt > MAX_WAIT_MS) {
    clearInterval(timer);
    return;
  }
  const sync = syncManager();
  if (!sync) return;
  // Once the manager has had time to finish its own startup, put back
  // anything it dropped for want of a session.
  syncSeenAt ??= Date.now();
  if (Date.now() - syncSeenAt >= RECOVERY_GRACE_MS) void recover(sync);
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
  // A share link's `driveUrl` does not survive the Renown redirect — the
  // return URL is built from the pathname alone — and a failed anonymous
  // `addRemoteDrive` deletes its own record. Keep the URL so the page after
  // sign-in can add the drive the link pointed at.
  // `location` is read defensively: the boot tests stub `window` with only
  // the `ph` slot, and a share link is an optional input, not a precondition.
  const driveUrl = driveUrlFromSearch(
    (window as { location?: { search?: string } }).location?.search ?? "",
  );
  if (driveUrl) remoteMemory().stashDriveUrl(driveUrl);
  const startedAt = Date.now();
  const timer = setInterval(() => sweep(startedAt, timer), POLL_MS);
  // Also sweep immediately: on a warm reload the sync manager already exists.
  sweep(startedAt, timer);
}
