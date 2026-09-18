import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isOperationCache } from "@powerhousedao/reactor-browser";
import type { Operation } from "document-model";
import {
  batchKeyContains,
  VaultDocumentCache,
  type OperationsPage,
} from "./remote-first.js";

describe("batchKeyContains", () => {
  it("finds an id at any position in the key", () => {
    const key = "aaa,bbb,ccc";
    expect(batchKeyContains(key, "aaa")).toBe(true);
    expect(batchKeyContains(key, "bbb")).toBe(true);
    expect(batchKeyContains(key, "ccc")).toBe(true);
  });

  it("is false for an id the batch does not contain", () => {
    expect(batchKeyContains("aaa,bbb", "ccc")).toBe(false);
  });

  it("does NOT match on a substring — the trap this function exists for", () => {
    // A naive `key.includes(id)` would return true for all three.
    expect(batchKeyContains("abc-1,abc-2", "abc")).toBe(false);
    expect(batchKeyContains("note-100", "note-10")).toBe(false);
    expect(batchKeyContains("xy", "x")).toBe(false);
  });

  it("handles a single-member key", () => {
    expect(batchKeyContains("only", "only")).toBe(true);
  });

  it("is false for an empty key", () => {
    expect(batchKeyContains("", "anything")).toBe(false);
  });
});

/**
 * The vault swaps Connect's document cache for its own. Connect's toolbar
 * opens the revision-history panel through `useDocumentOperations`, which
 * probes the installed cache with upstream's `isOperationCache` and, when
 * the probe fails, serves a frozen empty list with `status: "idle"` and NO
 * error — an empty panel and no way to tell why. These tests pin the probe
 * and the paging contract behind it.
 */
describe("VaultDocumentCache operation history", () => {
  const DOC = "doc-1";
  const SCOPE = "global";

  // The cache subscribes to `MutateDocument` window events in its
  // constructor. These tests run under vitest's node environment, so give
  // it the smallest surface that satisfies that: an EventTarget.
  const hadWindow = "window" in globalThis;
  beforeAll(() => {
    if (!hadWindow) {
      (globalThis as { window?: unknown }).window = new EventTarget();
    }
  });
  afterAll(() => {
    if (!hadWindow) delete (globalThis as { window?: unknown }).window;
  });

  function op(index: number): Operation {
    return { index, action: { type: `OP_${index}` } } as unknown as Operation;
  }

  function makeCache(pages: OperationsPage[]) {
    const calls: Array<{ cursor: string; limit: number }> = [];
    let next = 0;
    const cache = new VaultDocumentCache(
      () => Promise.reject(new Error("not used")),
      (_id, _scope, cursor, limit) => {
        calls.push({ cursor, limit });
        return Promise.resolve(pages[next++] ?? { results: [] });
      },
    );
    return { cache, calls };
  }

  it("satisfies upstream's isOperationCache probe — the actual bug", () => {
    const { cache } = makeCache([]);
    // Before the operations API existed this returned false, and Connect's
    // History button opened a permanently empty panel.
    expect(isOperationCache(cache)).toBe(true);
  });

  it("reads as idle before anything is requested", () => {
    const { cache } = makeCache([]);
    const entry = cache.getOperationsState(DOC, SCOPE);
    expect(entry.status).toBe("idle");
    expect(entry.operations).toEqual([]);
  });

  it("loads the first page and reports it as success", async () => {
    const { cache, calls } = makeCache([
      { results: [op(0), op(1)], nextCursor: "c1", totalCount: 4 },
    ]);
    cache.loadOperations(DOC, SCOPE, 2);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).status).toBe("success"),
    );
    const entry = cache.getOperationsState(DOC, SCOPE);
    expect(entry.operations.map((o) => o.index)).toEqual([0, 1]);
    expect(entry.hasNextPage).toBe(true);
    expect(entry.totalCount).toBe(4);
    expect(calls).toEqual([{ cursor: "", limit: 2 }]);
  });

  it("appends the next page rather than replacing it", async () => {
    const { cache, calls } = makeCache([
      { results: [op(0), op(1)], nextCursor: "c1" },
      { results: [op(2)] },
    ]);
    cache.loadOperations(DOC, SCOPE, 2);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).status).toBe("success"),
    );
    cache.loadMoreOperations(DOC, SCOPE);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).operations).toHaveLength(3),
    );
    const entry = cache.getOperationsState(DOC, SCOPE);
    expect(entry.operations.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(entry.hasNextPage).toBe(false);
    expect(calls[1]).toEqual({ cursor: "c1", limit: 2 });
  });

  it("does not re-request a scope that is already loaded", async () => {
    const { cache, calls } = makeCache([{ results: [op(0)] }]);
    cache.loadOperations(DOC, SCOPE, 10);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).status).toBe("success"),
    );
    cache.loadOperations(DOC, SCOPE, 10);
    expect(calls).toHaveLength(1);
  });

  it("records a failure as an error entry instead of throwing", async () => {
    const cache = new VaultDocumentCache(
      () => Promise.reject(new Error("not used")),
      () => Promise.reject(new Error("boom")),
    );
    cache.loadOperations(DOC, SCOPE, 10);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).status).toBe("error"),
    );
    expect((cache.getOperationsState(DOC, SCOPE).error as Error).message).toBe(
      "boom",
    );
  });

  it("notifies subscribers and drops history on invalidation", async () => {
    const { cache } = makeCache([{ results: [op(0)] }]);
    let notified = 0;
    const unsubscribe = cache.subscribeOperations(DOC, () => {
      notified += 1;
    });
    cache.loadOperations(DOC, SCOPE, 10);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, SCOPE).status).toBe("success"),
    );
    expect(notified).toBeGreaterThan(0);

    cache.invalidateOperations(DOC);
    expect(cache.getOperationsState(DOC, SCOPE).status).toBe("idle");

    const before = notified;
    unsubscribe();
    cache.invalidateOperations(DOC);
    expect(notified).toBe(before);
  });

  it("serves history per scope", async () => {
    const { cache } = makeCache([
      { results: [op(0)] },
      { results: [op(5)] },
    ]);
    cache.loadOperations(DOC, "global", 10);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, "global").status).toBe("success"),
    );
    cache.loadOperations(DOC, "local", 10);
    await vi.waitFor(() =>
      expect(cache.getOperationsState(DOC, "local").status).toBe("success"),
    );
    expect(cache.getOperationsState(DOC, "global").operations).toHaveLength(1);
    expect(cache.getOperationsState(DOC, "local").operations).toHaveLength(1);
  });
});
