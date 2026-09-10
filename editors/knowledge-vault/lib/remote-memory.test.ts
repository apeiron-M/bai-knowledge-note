import { describe, expect, it } from "vitest";
import {
  createRemoteMemory,
  driveUrlFromSearch,
  PENDING_DRIVE_URL_TTL_MS,
} from "./remote-memory.js";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const remote = (driveId: string, name = `remote-${driveId}`) => ({
  driveId,
  name,
  branch: "main",
  scope: [] as string[],
  channelConfig: { type: "gql", parameters: { url: "http://x/graphql/r" } },
  options: { sinceTimestampUtcMs: "0" },
});

describe("driveUrlFromSearch", () => {
  it("reads and decodes the driveUrl parameter", () => {
    expect(
      driveUrlFromSearch("?driveUrl=http%3A%2F%2Flocalhost%3A4001%2Fd%2Fabc"),
    ).toBe("http://localhost:4001/d/abc");
  });

  it("is null when absent or empty", () => {
    expect(driveUrlFromSearch("")).toBeNull();
    expect(driveUrlFromSearch("?user=did%3Apkh")).toBeNull();
    expect(driveUrlFromSearch("?driveUrl=")).toBeNull();
  });
});

describe("remembered remotes", () => {
  it("remembers one registration per drive, refreshing on re-adoption", () => {
    const memory = createRemoteMemory(fakeStorage());
    memory.remember(remote("d1", "first"), 1_000);
    memory.remember(remote("d1", "second"), 2_000);
    expect(memory.recall()).toEqual([
      expect.objectContaining({ driveId: "d1", name: "second", rememberedAt: 2_000 }),
    ]);
  });

  it("reports the drives the sync manager is not serving", () => {
    const memory = createRemoteMemory(fakeStorage());
    memory.remember(remote("d1"));
    memory.remember(remote("d2"));
    expect(memory.missing(["d2"]).map((r) => r.driveId)).toEqual(["d1"]);
    expect(memory.missing(["d1", "d2"])).toEqual([]);
  });

  it("forgets a drive, and removes the key when nothing is left", () => {
    const storage = fakeStorage();
    const memory = createRemoteMemory(storage);
    memory.remember(remote("d1"));
    memory.forget("d1");
    expect(memory.recall()).toEqual([]);
    expect(storage.dump()).toEqual({});
  });

  it("survives corrupt storage rather than throwing at boot", () => {
    const storage = fakeStorage();
    storage.setItem("remote-first:adopted-drives", "{not json");
    expect(createRemoteMemory(storage).recall()).toEqual([]);
    storage.setItem("remote-first:adopted-drives", JSON.stringify([1, { driveId: 2 }, null]));
    expect(createRemoteMemory(storage).recall()).toEqual([]);
  });
});

describe("pending share link", () => {
  it("stashes a drive URL and hands it back", () => {
    const memory = createRemoteMemory(fakeStorage());
    memory.stashDriveUrl("http://x/d/abc", 1_000);
    expect(memory.pendingDriveUrl(2_000)).toBe("http://x/d/abc");
  });

  it("expires a stale stash instead of replaying it forever", () => {
    const memory = createRemoteMemory(fakeStorage());
    memory.stashDriveUrl("http://x/d/abc", 1_000);
    expect(memory.pendingDriveUrl(1_000 + PENDING_DRIVE_URL_TTL_MS + 1)).toBeNull();
    // and it is gone, not merely hidden
    expect(memory.pendingDriveUrl(1_000)).toBeNull();
  });

  it("clears on demand", () => {
    const memory = createRemoteMemory(fakeStorage());
    memory.stashDriveUrl("http://x/d/abc");
    memory.clearDriveUrl();
    expect(memory.pendingDriveUrl()).toBeNull();
  });

  it("ignores a malformed entry", () => {
    const storage = fakeStorage();
    storage.setItem("remote-first:pending-drive-url", JSON.stringify({ url: 42 }));
    expect(createRemoteMemory(storage).pendingDriveUrl()).toBeNull();
  });
});
