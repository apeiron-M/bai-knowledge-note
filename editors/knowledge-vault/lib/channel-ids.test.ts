import { describe, expect, it } from "vitest";
import { createChannelIds, derivedChannelId, signedInAddress } from "./channel-ids.js";
import type { StorageLike } from "./remote-memory.js";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A derive that makes the rules visible: the id names what it was derived from. */
const derive = (address: string, driveId: string) => Promise.resolve(`${address}|${driveId}`);

describe("createChannelIds", () => {
  it("returns the same id for a drive on every call, across instances (page loads)", async () => {
    const storage = memoryStorage();
    const first = await createChannelIds(storage, derive).idFor("drive-a", "0xAbC");
    const again = await createChannelIds(storage, derive).idFor("drive-a", "0xabc");
    expect(first).toBe("0xabc|drive-a");
    expect(again).toBe(first); // the address is matched case-insensitively
  });

  it("gives the same id after site data is cleared, because the id is derived, not stored", async () => {
    const first = await createChannelIds(memoryStorage(), derive).idFor("drive-a", "0x1");
    const afterWipe = await createChannelIds(memoryStorage(), derive).idFor("drive-a", "0x1");
    expect(afterWipe).toBe(first);
  });

  it("keys by address, so another account never reuses a channel bound to the first", async () => {
    const ids = createChannelIds(memoryStorage(), derive);
    expect(await ids.idFor("drive-a", "0x1")).toBe("0x1|drive-a");
    expect(await ids.idFor("drive-a", "0x2")).toBe("0x2|drive-a");
    expect(await ids.idFor("drive-b", "0x1")).toBe("0x1|drive-b");
  });

  it("returns undefined without an address, leaving sync.add to mint one as before", async () => {
    const storage = memoryStorage();
    expect(await createChannelIds(storage, derive).idFor("drive-a", undefined)).toBeUndefined();
    expect(storage.map.size).toBe(0);
  });

  it("prefers an adopted working channel's id, and keeps the first one it learnt", async () => {
    const ids = createChannelIds(memoryStorage(), derive);
    ids.adopt("drive-a", "0x1", "existing-remote");
    ids.adopt("drive-a", "0x1", "a-later-one");
    ids.adopt("drive-a", undefined, "ignored");
    ids.adopt("drive-a", "0x1", undefined);
    expect(await ids.idFor("drive-a", "0x1")).toBe("existing-remote");
  });

  it("survives corrupt or non-object storage by deriving again", async () => {
    for (const bad of ["not json", "[1,2]", "null"]) {
      const storage = memoryStorage();
      storage.setItem("remote-first:channel-ids", bad);
      expect(await createChannelIds(storage, derive).idFor("drive-a", "0x1")).toBe("0x1|drive-a");
    }
  });

  it("still returns an id for this page when storage refuses writes", async () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(await createChannelIds(storage, derive).idFor("drive-a", "0x1")).toBe("0x1|drive-a");
  });
});

describe("derivedChannelId", () => {
  it("is deterministic, case-insensitive on the address, and shaped like a UUID", async () => {
    const a = await derivedChannelId("0xAbC", "c60679ae-8775-4576-acc6-cd364022df1b");
    const b = await derivedChannelId("0xabc", "c60679ae-8775-4576-acc6-cd364022df1b");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs per address and per drive", async () => {
    const base = await derivedChannelId("0x1", "drive-a");
    expect(await derivedChannelId("0x2", "drive-a")).not.toBe(base);
    expect(await derivedChannelId("0x1", "drive-b")).not.toBe(base);
  });
});

describe("signedInAddress", () => {
  it("reads the Renown user from window.ph, and is undefined when signed out", () => {
    const g = globalThis as unknown as { ph?: unknown };
    const saved = g.ph;
    g.ph = { renown: { user: { address: "0xabc" } } };
    expect(signedInAddress()).toBe("0xabc");
    g.ph = { renown: { user: undefined } };
    expect(signedInAddress()).toBeUndefined();
    g.ph = saved;
  });
});
