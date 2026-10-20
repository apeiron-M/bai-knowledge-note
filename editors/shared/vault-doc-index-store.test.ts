import { describe, expect, it, vi } from "vitest";
import {
  createDocIndexStore,
  indexAffected,
  type IndexData,
} from "./vault-doc-index-store.js";

function data(title: string): IndexData {
  return {
    knowledgeDocs: [
      { id: "n1", title, documentType: "bai/knowledge-note", noteType: "concept" },
    ],
    all: [{ id: "n1", title, documentType: "bai/knowledge-note", noteType: "concept" }],
  };
}

function clock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createDocIndexStore", () => {
  it("fetches once and serves the cached promise to later readers", async () => {
    const fetch = vi.fn().mockResolvedValue(data("a"));
    const store = createDocIndexStore({ fetch, now: clock().now });
    await Promise.all([store.read("d1"), store.read("d1"), store.read("d1")]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps drives separate", async () => {
    const fetch = vi.fn().mockResolvedValue(data("a"));
    const store = createDocIndexStore({ fetch, now: clock().now });
    await Promise.all([store.read("d1"), store.read("d2")]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches once the stale TTL has passed", async () => {
    const fetch = vi.fn().mockResolvedValue(data("a"));
    const c = clock();
    const store = createDocIndexStore({ fetch, now: c.now, staleTtlMs: 30_000 });
    await store.read("d1");
    c.advance(29_000);
    await store.read("d1");
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(2_000);
    await store.read("d1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("trusts the cache far longer while the change feed is live", async () => {
    const fetch = vi.fn().mockResolvedValue(data("a"));
    const c = clock();
    const store = createDocIndexStore({
      fetch,
      now: c.now,
      isLive: () => true,
      staleTtlMs: 30_000,
      liveTtlMs: 300_000,
    });
    await store.read("d1");
    c.advance(120_000); // four stale-TTLs later
    await store.read("d1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not poison the cache with a failed fetch", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(data("a"));
    const store = createDocIndexStore({ fetch, now: clock().now });
    await expect(store.read("d1")).rejects.toThrow("offline");
    await expect(store.read("d1")).resolves.toMatchObject({
      knowledgeDocs: [{ title: "a" }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("invalidate causes exactly ONE refetch however many consumers re-read", async () => {
    const fetch = vi.fn().mockResolvedValue(data("a"));
    const store = createDocIndexStore({ fetch, now: clock().now });
    await store.read("d1");
    expect(store.fetchCount()).toBe(1);

    // Five mounted consumers, each of which re-reads when told to.
    for (let i = 0; i < 5; i++) store.subscribe("d1", () => void store.read("d1"));
    store.invalidate("d1");

    expect(store.fetchCount()).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("notifies only subscribers of the invalidated drive", () => {
    const store = createDocIndexStore({ fetch: () => Promise.resolve(data("a")) });
    const one = vi.fn();
    const two = vi.fn();
    store.subscribe("d1", one);
    store.subscribe("d2", two);
    store.invalidate("d1");
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createDocIndexStore({ fetch: () => Promise.resolve(data("a")) });
    const fn = vi.fn();
    const off = store.subscribe("d1", fn);
    off();
    store.invalidate("d1");
    expect(fn).not.toHaveBeenCalled();
  });

  it("survives a subscriber that unsubscribes during notification", () => {
    const store = createDocIndexStore({ fetch: () => Promise.resolve(data("a")) });
    const second = vi.fn();
    const off = store.subscribe("d1", () => off());
    store.subscribe("d1", second);
    expect(() => store.invalidate("d1")).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("indexAffected", () => {
  const base = { driveId: "drive", structural: false, documents: [] };

  it("is true for any structural change", () => {
    expect(indexAffected({ ...base, structural: true })).toBe(true);
  });

  it("is true when the drive document itself changed", () => {
    expect(
      indexAffected({ ...base, documents: [{ id: "drive", documentType: null }] }),
    ).toBe(true);
  });

  it("is true for a knowledge-note or MoC title change", () => {
    expect(
      indexAffected({ ...base, documents: [{ id: "n1", documentType: "bai/knowledge-note" }] }),
    ).toBe(true);
    expect(
      indexAffected({ ...base, documents: [{ id: "m1", documentType: "bai/moc" }] }),
    ).toBe(true);
  });

  it("is false for types the index does not project", () => {
    expect(
      indexAffected({
        ...base,
        documents: [
          { id: "s1", documentType: "bai/source" },
          { id: "t1", documentType: "bai/tension" },
        ],
      }),
    ).toBe(false);
  });

  it("is false for an empty change", () => {
    expect(indexAffected(base)).toBe(false);
  });
});
