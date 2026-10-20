/**
 * One stable sync-channel id per (signed-in address, drive) for this browser.
 *
 * Why this exists. Remote-first mode keeps every vault drive's sync channel
 * REGISTERED but scoped to a sentinel filter (`remote-first-sync-nothing`,
 * `PollBehavior.Manual`) — see `boot.ts` and `use-remote-first.ts`. It gets
 * there by `sync.remove(name)` + `sync.add(name, …)`. `sync.add` without an
 * `id` mints a fresh channel id (`id ?? crypto.randomUUID()` in the reactor's
 * SyncManager), and the channel's init sends that id to the Switchboard's
 * `touchChannel`, which creates a NEW server-side remote for any id it has not
 * seen. The client never polls a Manual channel, so the server never prunes it
 * (`stalePollAgeMs` skips a channel that has reported no poll).
 *
 * Measured on a local store (2026-09-28): 239 such remotes, 252 of 272 remotes
 * with no outbox cursor, and a ~40 s event-loop stall on the first write after
 * every boot while the sync manager re-derived all of their outboxes.
 *
 * Re-adding under a remembered id makes `touchChannel` find the existing
 * remote and return, so a browser holds at most one server remote per drive
 * per account. The id is DERIVED from (address, drive) — a hash, not a random
 * value — so it survives the user clearing site data: a remembered id is only
 * a cache of it (or of an adopted pre-existing channel). Measured 2026-09-28:
 * with a stored random id, "clear app data + re-add the drive" still left a
 * second sentinel remote behind. Two browsers on one account share the channel,
 * which is harmless: it delivers nothing and is never polled. The key includes the address because the Switchboard binds a
 * channel to the address that created it and refuses any other
 * (`#bindOrRefuseChannel` → ForbiddenError): reusing one id across accounts
 * would turn an account switch into a dropped drive.
 *
 * Storage is injected so the rules are unit-testable without a DOM.
 */

import type { StorageLike } from "./remote-memory.js";

const KEY = "remote-first:channel-ids";

export type ChannelIds = {
  /**
   * The id to (re-)add this drive's neutralised channel under. `undefined`
   * with no address: the caller then lets `sync.add` mint one, exactly as
   * before this module existed.
   */
  idFor(driveId: string, address: string | undefined): Promise<string | undefined>;
  /**
   * Remember the id of a channel that is already neutralised and working, so
   * a later re-add reuses its server remote instead of creating another. A
   * known id for the pair is kept: the first one seen is the one to converge on.
   */
  adopt(driveId: string, address: string | undefined, id: string | undefined): void;
};

export function createChannelIds(
  storage: StorageLike,
  derive: (address: string, driveId: string) => Promise<string> = derivedChannelId,
): ChannelIds {
  const read = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  };
  const write = (map: Record<string, string>): void => {
    try {
      storage.setItem(KEY, JSON.stringify(map));
    } catch {
      // Full or disabled storage: the id is still returned for this page, and
      // the worst case is one more server remote on the next load — today's
      // behaviour, never a broken drive.
    }
  };
  const keyOf = (driveId: string, address: string) =>
    `${address.toLowerCase()}|${driveId}`;

  return {
    async idFor(driveId, address) {
      if (!address) return undefined;
      const map = read();
      const key = keyOf(driveId, address);
      const known = map[key];
      if (typeof known === "string" && known) return known;
      const id = await derive(address.toLowerCase(), driveId);
      map[key] = id;
      write(map);
      return id;
    },
    adopt(driveId, address, id) {
      if (!address || !id) return;
      const map = read();
      const key = keyOf(driveId, address);
      if (map[key]) return;
      map[key] = id;
      write(map);
    },
  };
}

/**
 * The channel id for (address, drive): SHA-256 of a versioned label, shaped as
 * a UUID (version nibble 8, "custom", RFC 9562) so it reads like every other
 * channel id. Deterministic, so clearing site data cannot mint a new one.
 */
export async function derivedChannelId(
  address: string,
  driveId: string,
): Promise<string> {
  const label = `remote-first-channel:v1:${address.toLowerCase()}:${driveId}`;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label)),
  );
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The page's `localStorage`, or a page-scoped map when it is absent or throws. */
export function browserStorage(): StorageLike {
  try {
    const storage = globalThis.localStorage;
    storage.getItem("remote-first:probe");
    return storage;
  } catch {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }
}

let shared: ChannelIds | null = null;
/** One instance per page, shared by the package-load boot and the editor hook. */
export function channelIds(): ChannelIds {
  shared ??= createChannelIds(browserStorage());
  return shared;
}

/** The Renown address signed in on this page, if any. */
export function signedInAddress(): string | undefined {
  const ph = (
    globalThis as unknown as {
      ph?: { renown?: { user?: { address?: string } } };
    }
  ).ph;
  return ph?.renown?.user?.address || undefined;
}
