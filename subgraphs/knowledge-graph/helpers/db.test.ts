import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import {
  clearDbHandleCache,
  clearDriveIdCache,
  getDb,
  resolveCanonicalDriveId,
} from "./db.js";

function subgraph(get: ReturnType<typeof vi.fn>): ISubgraph {
  return { reactorClient: { get } } as unknown as ISubgraph;
}

describe("resolveCanonicalDriveId", () => {
  beforeEach(() => {
    clearDriveIdCache();
    vi.useRealTimers();
  });

  it("resolves a slug to the drive's canonical id", async () => {
    const get = vi.fn(async () => ({ header: { id: "uuid-drive" } }));
    await expect(
      resolveCanonicalDriveId(subgraph(get), "my-slug"),
    ).resolves.toBe("uuid-drive");
  });

  it("fetches the drive once, not once per query", async () => {
    const get = vi.fn(async () => ({ header: { id: "uuid-drive" } }));
    const s = subgraph(get);
    for (let i = 0; i < 5; i++) {
      await expect(resolveCanonicalDriveId(s, "my-slug")).resolves.toBe(
        "uuid-drive",
      );
    }
    // The whole point: the drive document is large and was being fetched and
    // JSON-parsed on every single graph query.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after the TTL, so a reassigned slug is not served forever", async () => {
    vi.useFakeTimers();
    const get = vi
      .fn()
      .mockResolvedValueOnce({ header: { id: "drive-a" } })
      .mockResolvedValueOnce({ header: { id: "drive-b" } });
    const s = subgraph(get);
    await expect(resolveCanonicalDriveId(s, "slug")).resolves.toBe("drive-a");
    vi.advanceTimersByTime(61_000);
    await expect(resolveCanonicalDriveId(s, "slug")).resolves.toBe("drive-b");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ header: { id: "uuid-drive" } });
    const s = subgraph(get);
    // falls back to the input rather than masking the misconfiguration
    await expect(resolveCanonicalDriveId(s, "slug")).resolves.toBe("slug");
    // and the next call retries instead of serving a poisoned entry
    await expect(resolveCanonicalDriveId(s, "slug")).resolves.toBe("uuid-drive");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps separate entries per identifier", async () => {
    const get = vi.fn(async (id: string) => ({ header: { id: `uuid-${id}` } }));
    const s = subgraph(get);
    await expect(resolveCanonicalDriveId(s, "a")).resolves.toBe("uuid-a");
    await expect(resolveCanonicalDriveId(s, "b")).resolves.toBe("uuid-b");
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("getDb handle identity", () => {
  beforeEach(() => {
    clearDbHandleCache();
  });

  function fakeSubgraph() {
    const queryNamespace = vi.fn((ns: string) => ({
      __ns: ns,
      selectFrom: vi.fn(),
    }));
    return {
      subgraph: { relationalDb: { queryNamespace } } as unknown as ISubgraph,
      queryNamespace,
    };
  }

  it("returns the same handle for the same drive", () => {
    const { subgraph: s } = fakeSubgraph();
    const a = getDb(s, "drive-1");
    const b = getDb(s, "drive-1");
    // Identity matters: embedding-store caches its matrix in a WeakMap keyed
    // on this object. A fresh handle per call silently disables that cache.
    expect(a).toBe(b);
  });

  it("builds the namespaced handle once per drive", () => {
    const { subgraph: s, queryNamespace } = fakeSubgraph();
    for (let i = 0; i < 5; i++) getDb(s, "drive-1");
    expect(queryNamespace).toHaveBeenCalledTimes(1);
  });

  it("keeps drives on separate handles", () => {
    const { subgraph: s } = fakeSubgraph();
    expect(getDb(s, "drive-1")).not.toBe(getDb(s, "drive-2"));
  });

  it("does not serve one relational db's handle to another", () => {
    const a = fakeSubgraph();
    const b = fakeSubgraph();
    expect(getDb(a.subgraph, "drive-1")).not.toBe(getDb(b.subgraph, "drive-1"));
  });
});
