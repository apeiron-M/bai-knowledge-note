import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PHDocument } from "document-model";
import {
  DOC_CACHE_MAX_AGE_MS,
  DOC_CACHE_MAX_ENTRIES,
  DOC_CACHE_TTL_MS,
  cachedDocsFor,
  everyDocCached,
  evictDoc,
  fetchThroughCache,
  handleDocumentMutation,
  isStale,
  peekDoc,
  putDoc,
  recallIds,
  rememberIds,
  resetDocCache,
  subscribeDocMutations,
  wireDocMutationEvents,
  type DocFetchOutcome,
} from "./reactor-doc-cache.js";

function doc(id: string, title = id): PHDocument {
  return {
    header: { id, documentType: "bai/source", name: id },
    state: { global: { title } },
  } as unknown as PHDocument;
}

function title(d: PHDocument): string {
  return (d.state as unknown as { global: { title: string } }).global.title;
}

const T0 = 1_700_000_000_000;

describe("reactor-doc-cache", () => {
  beforeEach(() => {
    resetDocCache();
  });

  describe("cold miss", () => {
    it("has nothing to paint and reports the set as not fully cached", () => {
      expect(cachedDocsFor(["a", "b"], T0)).toEqual([]);
      expect(everyDocCached(["a", "b"], T0)).toBe(false);
      expect(peekDoc("a", T0)).toBeUndefined();
    });

    it("treats an empty id list as NOT fully cached", () => {
      // Otherwise a view whose spec list has not arrived yet would report
      // "loaded" with zero rows and render its empty state.
      expect(everyDocCached([], T0)).toBe(false);
    });

    it("caches what the fetcher returns", async () => {
      const fetcher = vi.fn(
        (id: string): Promise<DocFetchOutcome> =>
          Promise.resolve({ kind: "doc", doc: doc(id) }),
      );
      const outcome = await fetchThroughCache("a", fetcher, () => T0);

      expect(outcome).toEqual({ kind: "doc", doc: doc("a") });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(peekDoc("a", T0)?.fetchedAt).toBe(T0);
    });
  });

  describe("warm hit", () => {
    it("paints in spec order without reporting loading", () => {
      putDoc("a", doc("a"), T0);
      putDoc("b", doc("b"), T0);

      expect(cachedDocsFor(["b", "a"], T0).map(title)).toEqual(["b", "a"]);
      expect(everyDocCached(["a", "b"], T0)).toBe(true);
    });

    it("omits misses but still paints the hits (partial set)", () => {
      putDoc("a", doc("a"), T0);

      expect(cachedDocsFor(["a", "b"], T0).map(title)).toEqual(["a"]);
      // Honest: the list really is incomplete, so the caller keeps
      // isLoading true while showing what it has.
      expect(everyDocCached(["a", "b"], T0)).toBe(false);
    });

    it("de-duplicates simultaneous reads of the same id", async () => {
      // The fetcher is invoked on a microtask, so the deferred has to
      // exist before the first call rather than be captured from inside.
      let resolve!: (o: DocFetchOutcome) => void;
      const pending = new Promise<DocFetchOutcome>((r) => {
        resolve = r;
      });
      const fetcher = vi.fn(() => pending);

      const first = fetchThroughCache("a", fetcher, () => T0);
      const second = fetchThroughCache("a", fetcher, () => T0);
      expect(first).toBe(second);

      resolve({ kind: "doc", doc: doc("a") });
      await first;
      expect(fetcher).toHaveBeenCalledTimes(1);

      // The in-flight slot is released once settled, so the next mount
      // revalidates rather than replaying the finished promise.
      await fetchThroughCache("a", fetcher, () => T0);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe("TTL", () => {
    it("marks an entry stale past the freshness horizon", () => {
      putDoc("a", doc("a"), T0);
      const entry = peekDoc("a", T0);

      expect(entry && isStale(entry, T0 + DOC_CACHE_TTL_MS - 1)).toBe(false);
      expect(entry && isStale(entry, T0 + DOC_CACHE_TTL_MS)).toBe(true);
    });

    it("still paints a stale hit and still revalidates it", async () => {
      putDoc("a", doc("a", "old"), T0);
      const later = T0 + DOC_CACHE_TTL_MS + 1;

      // Stale does NOT gate painting — that is the point of SWR.
      expect(cachedDocsFor(["a"], later).map(title)).toEqual(["old"]);
      expect(everyDocCached(["a"], later)).toBe(true);

      const fetcher = vi.fn(
        (id: string): Promise<DocFetchOutcome> =>
          Promise.resolve({ kind: "doc", doc: doc(id, "fresh") }),
      );
      await fetchThroughCache("a", fetcher, () => later);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cachedDocsFor(["a"], later).map(title)).toEqual(["fresh"]);
    });

    it("revalidates a fresh entry too — the cache never suppresses a read", async () => {
      putDoc("a", doc("a", "old"), T0);
      const fetcher = vi.fn(
        (id: string): Promise<DocFetchOutcome> =>
          Promise.resolve({ kind: "doc", doc: doc(id, "fresh") }),
      );

      await fetchThroughCache("a", fetcher, () => T0 + 1);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cachedDocsFor(["a"], T0).map(title)).toEqual(["fresh"]);
    });

    it("drops entries past the retention horizon so nothing lives forever", () => {
      putDoc("a", doc("a"), T0);

      expect(peekDoc("a", T0 + DOC_CACHE_MAX_AGE_MS - 1)).toBeDefined();
      expect(peekDoc("a", T0 + DOC_CACHE_MAX_AGE_MS)).toBeUndefined();
      // …and the expired entry is gone, not merely hidden.
      expect(peekDoc("a", T0)).toBeUndefined();
    });

    it("caps the number of retained entries, dropping the oldest first", () => {
      for (let i = 0; i < DOC_CACHE_MAX_ENTRIES + 5; i += 1) {
        putDoc(`doc-${i}`, doc(`doc-${i}`), T0 + i);
      }

      expect(peekDoc("doc-0", T0)).toBeUndefined();
      expect(peekDoc("doc-4", T0)).toBeUndefined();
      expect(peekDoc("doc-5", T0)).toBeDefined();
      expect(
        peekDoc(`doc-${DOC_CACHE_MAX_ENTRIES + 4}`, T0),
      ).toBeDefined();
    });
  });

  describe("invalidation", () => {
    it("evicts the mutated document and notifies subscribers", () => {
      putDoc("a", doc("a"), T0);
      putDoc("b", doc("b"), T0);
      const seen: string[] = [];
      const unsubscribe = subscribeDocMutations((id) => seen.push(id));

      handleDocumentMutation("a");

      expect(peekDoc("a", T0)).toBeUndefined();
      expect(peekDoc("b", T0)).toBeDefined();
      expect(seen).toEqual(["a"]);
      unsubscribe();

      handleDocumentMutation("b");
      expect(seen).toEqual(["a"]);
    });

    it("keeps notifying after one subscriber throws", () => {
      const seen: string[] = [];
      const un1 = subscribeDocMutations(() => {
        throw new Error("broken subscriber");
      });
      const un2 = subscribeDocMutations((id) => seen.push(id));

      handleDocumentMutation("a");

      expect(seen).toEqual(["a"]);
      un1();
      un2();
    });

    it("discards a read that was already in flight when the write landed", async () => {
      let resolve!: (o: DocFetchOutcome) => void;
      const pending = new Promise<DocFetchOutcome>((r) => {
        resolve = r;
      });
      const promise = fetchThroughCache("a", () => pending, () => T0);

      // The write invalidates the id mid-flight.
      handleDocumentMutation("a");
      resolve({ kind: "doc", doc: doc("a", "pre-write") });
      await promise;

      // The pre-write body must not be resurrected into the cache.
      expect(peekDoc("a", T0)).toBeUndefined();
    });

    it("re-reads through a fresh request after an eviction", async () => {
      const fetcher = vi.fn(
        (id: string): Promise<DocFetchOutcome> =>
          Promise.resolve({ kind: "doc", doc: doc(id) }),
      );
      await fetchThroughCache("a", fetcher, () => T0);
      evictDoc("a");
      await fetchThroughCache("a", fetcher, () => T0);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(peekDoc("a", T0)).toBeDefined();
    });

    it("wires the MutateDocument window events", () => {
      const listeners = new Map<string, (event: Event) => void>();
      (globalThis as { window?: unknown }).window = {
        addEventListener: (type: string, fn: (event: Event) => void) =>
          listeners.set(type, fn),
      };
      try {
        wireDocMutationEvents();
        putDoc("a", doc("a"), T0);

        listeners.get("MutateDocument")?.({
          detail: { identifier: "a" },
        } as unknown as Event);

        expect(peekDoc("a", T0)).toBeUndefined();
        expect(listeners.has("MutateDocumentAsync")).toBe(true);
      } finally {
        delete (globalThis as { window?: unknown }).window;
      }
    });
  });

  describe("deletion", () => {
    it("removes the entry when the server reports the document gone", async () => {
      putDoc("a", doc("a"), T0);

      const outcome = await fetchThroughCache(
        "a",
        (): Promise<DocFetchOutcome> => Promise.resolve({ kind: "missing" }),
        () => T0,
      );

      expect(outcome).toEqual({ kind: "missing" });
      // No ghost row on the next visit.
      expect(peekDoc("a", T0)).toBeUndefined();
      expect(cachedDocsFor(["a"], T0)).toEqual([]);
    });

    it("keeps the last good body when the read merely failed in transit", async () => {
      putDoc("a", doc("a", "last-good"), T0);

      const outcome = await fetchThroughCache(
        "a",
        (): Promise<DocFetchOutcome> => Promise.resolve({ kind: "error" }),
        () => T0,
      );

      expect(outcome).toEqual({ kind: "error" });
      expect(cachedDocsFor(["a"], T0).map(title)).toEqual(["last-good"]);
    });

    it("reports a thrown fetcher as an error rather than rejecting", async () => {
      putDoc("a", doc("a", "last-good"), T0);

      const outcome = await fetchThroughCache(
        "a",
        () => Promise.reject(new Error("socket hang up")),
        () => T0,
      );

      expect(outcome).toEqual({ kind: "error" });
      expect(cachedDocsFor(["a"], T0).map(title)).toEqual(["last-good"]);
    });
  });

  describe("retained id lists", () => {
    it("recalls the last non-empty list for a key", () => {
      expect(recallIds("sources")).toEqual([]);

      rememberIds("sources", ["a", "b"]);
      expect(recallIds("sources")).toEqual(["a", "b"]);

      // An empty list is the "tree still reloading" state, not new truth.
      rememberIds("sources", []);
      expect(recallIds("sources")).toEqual(["a", "b"]);

      rememberIds("sources", ["a"]);
      expect(recallIds("sources")).toEqual(["a"]);
    });

    it("keys retained lists per consumer", () => {
      rememberIds("sources", ["a"]);
      rememberIds("projects", ["b"]);

      expect(recallIds("sources")).toEqual(["a"]);
      expect(recallIds("projects")).toEqual(["b"]);
    });
  });
});

describe("reactor-doc-cache module state", () => {
  afterEach(() => resetDocCache());

  it("survives across consumers so a remount paints from cache", () => {
    // What the complaint was about: view A fetched these documents, the
    // user switched away (unmount), and view A's remount must find them.
    putDoc("a", doc("a"), T0);
    putDoc("b", doc("b"), T0);
    rememberIds("source-list", ["a", "b"]);

    // Remount with a spec list that has not arrived yet.
    const seedIds = recallIds("source-list");
    expect(cachedDocsFor(seedIds, T0 + 5_000).map(title)).toEqual(["a", "b"]);
    expect(everyDocCached(seedIds, T0 + 5_000)).toBe(true);
  });
});
