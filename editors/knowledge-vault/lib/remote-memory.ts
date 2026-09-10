/**
 * What this package remembers about vault drives between page loads, so a
 * drive that Connect has dropped can be put back once the user has signed in.
 *
 * Two things go wrong at Connect's boot on a protected Switchboard, and both
 * come from the same place: the sync manager re-creates every persisted remote
 * and calls `channel.init()` — a `touchChannel` mutation that needs `canRead`
 * on the drive — with whatever credentials exist at that instant.
 *
 *  - **Signed out, or just back from Renown.** The request is tokenless, the
 *    Switchboard answers 401, and the sync manager DELETES the remote from
 *    memory (`this.remotes.delete(record.name); continue;`) while leaving the
 *    record in storage. Nothing retries. The drive is invisible for the whole
 *    page — including the page the Renown redirect lands on, because Connect
 *    boots before the session it carries in `?user=` has been restored. A
 *    refresh works only because by then the session is in storage.
 *
 *  - **A fresh share link.** `?driveUrl=` makes Connect call `addRemoteDrive`,
 *    whose `sync.add` persists the record and then inits; on failure it
 *    REMOVES the record from storage and throws. The Renown return URL is
 *    built from `location.pathname` alone, so `driveUrl` is gone too. The
 *    user signs in and lands on an empty Connect.
 *
 * Both are recovered from here. On every successful adoption the remote's
 * registration is remembered; at boot, a remembered drive missing from
 * `sync.list()` is re-added — with the same name, so the persisted record is
 * overwritten rather than duplicated — once a bearer exists and a probe shows
 * the drive is readable. A `driveUrl` seen in the URL is stashed and replayed
 * through `addRemoteDrive` on the next boot that has a session.
 *
 * Storage is injected so the rules are unit-testable without a DOM.
 */

import type { DriveLike } from "./drive-stub.js";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A remote's registration, as `sync.add` needs it back. */
export type RememberedRemote = {
  driveId: string;
  name: string;
  branch: string;
  scope: string[];
  channelConfig: unknown;
  options: Record<string, unknown> | undefined;
  rememberedAt: number;
  /**
   * The drive document minus its node tree, as last hydrated — enough to show
   * the drive as a tile while it cannot be read (see drive-stub.ts). Absent
   * until the first successful hydration.
   */
  presentation?: DriveLike;
};

const REMOTES_KEY = "remote-first:adopted-drives";
const DRIVE_URL_KEY = "remote-first:pending-drive-url";

/** A stashed share link is replayed for this long, then forgotten. */
export const PENDING_DRIVE_URL_TTL_MS = 24 * 60 * 60_000;

/** The `driveUrl` query parameter of a location search string, if any. */
export function driveUrlFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("driveUrl");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readJson<T>(storage: StorageLike, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage only loses the memory, never the session.
  }
}

export function createRemoteMemory(storage: StorageLike) {
  const recall = (): RememberedRemote[] => {
    const list = readJson<unknown>(storage, REMOTES_KEY);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (r): r is RememberedRemote =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RememberedRemote).driveId === "string" &&
        typeof (r as RememberedRemote).name === "string",
    );
  };

  return {
    recall,

    /**
     * Record (or refresh) a remote's registration. One entry per drive. A
     * presentation already remembered for the drive is kept: registration is
     * re-written on every boot, hydration only when the drive is readable.
     */
    remember(
      remote: Omit<RememberedRemote, "rememberedAt" | "presentation">,
      now = Date.now(),
    ): void {
      const all = recall();
      const previous = all.find((r) => r.driveId === remote.driveId);
      const others = all.filter((r) => r.driveId !== remote.driveId);
      writeJson(storage, REMOTES_KEY, [
        ...others,
        { ...remote, rememberedAt: now, presentation: previous?.presentation },
      ]);
    },

    /**
     * Attach the drive's presentation to its record. A no-op without a record:
     * a presentation alone is not a registration and must not make `missing`
     * try to re-add a channel it knows nothing about.
     */
    rememberPresentation(driveId: string, presentation: DriveLike): void {
      const all = recall();
      const record = all.find((r) => r.driveId === driveId);
      if (!record) return;
      writeJson(storage, REMOTES_KEY, [
        ...all.filter((r) => r.driveId !== driveId),
        { ...record, presentation },
      ]);
    },

    forget(driveId: string): void {
      const rest = recall().filter((r) => r.driveId !== driveId);
      if (rest.length === 0) storage.removeItem(REMOTES_KEY);
      else writeJson(storage, REMOTES_KEY, rest);
    },

    /**
     * Remembered drives that the sync manager is not currently serving — the
     * ones a failed boot-time init has dropped.
     */
    missing(listedDriveIds: Iterable<string>): RememberedRemote[] {
      const listed = new Set(listedDriveIds);
      return recall().filter((r) => !listed.has(r.driveId));
    },

    /** Keep a share link's drive URL for the page load after sign-in. */
    stashDriveUrl(url: string, now = Date.now()): void {
      writeJson(storage, DRIVE_URL_KEY, { url, at: now });
    },

    /** The stashed URL, or null when there is none or it has expired. */
    pendingDriveUrl(now = Date.now()): string | null {
      const entry = readJson<{ url?: unknown; at?: unknown }>(storage, DRIVE_URL_KEY);
      if (!entry || typeof entry.url !== "string" || typeof entry.at !== "number") {
        return null;
      }
      if (now - entry.at > PENDING_DRIVE_URL_TTL_MS) {
        storage.removeItem(DRIVE_URL_KEY);
        return null;
      }
      return entry.url;
    },

    clearDriveUrl(): void {
      storage.removeItem(DRIVE_URL_KEY);
    },
  };
}

export type RemoteMemory = ReturnType<typeof createRemoteMemory>;
