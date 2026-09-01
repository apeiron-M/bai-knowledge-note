import "../../../shared/test/browser-globals.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_THREADS,
  deleteThread,
  loadThreads,
  saveThread,
  threadTitleFrom,
  type Thread,
} from "./chat-storage.js";

const thread = (id: string, updatedAt: string): Thread => ({
  id,
  title: `t-${id}`,
  updatedAt,
  messages: [{ role: "user", content: "hi" }],
});
beforeEach(() => localStorage.clear());

describe("chat-storage", () => {
  it("returns an empty list for an unseen drive", () => {
    expect(loadThreads("d1")).toEqual([]);
  });

  it("round-trips and keeps drives separate", () => {
    saveThread("d1", thread("a", "2026-01-01T00:00:00Z"));
    saveThread("d2", thread("b", "2026-01-01T00:00:00Z"));
    expect(loadThreads("d1").map((t) => t.id)).toEqual(["a"]);
    expect(loadThreads("d2").map((t) => t.id)).toEqual(["b"]);
    expect(localStorage.getItem("bai-chat:v1:d1")).toBeTruthy();
  });

  it("orders most-recent-first and updates in place", () => {
    saveThread("d1", thread("a", "2026-01-01T00:00:00Z"));
    saveThread("d1", thread("b", "2026-01-02T00:00:00Z"));
    saveThread("d1", {
      ...thread("a", "2026-01-03T00:00:00Z"),
      title: "renamed",
    });
    const got = loadThreads("d1");
    expect(got.map((t) => t.id)).toEqual(["a", "b"]);
    expect(got[0].title).toBe("renamed");
  });

  it("evicts the oldest beyond MAX_THREADS", () => {
    for (let i = 0; i < MAX_THREADS + 5; i++) {
      saveThread(
        "d1",
        thread(`t${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
      );
    }
    const got = loadThreads("d1");
    expect(got).toHaveLength(MAX_THREADS);
    expect(got.some((t) => t.id === "t0")).toBe(false);
    expect(got[0].id).toBe(`t${MAX_THREADS + 4}`);
  });

  it("deletes a thread", () => {
    saveThread("d1", thread("a", "2026-01-01T00:00:00Z"));
    saveThread("d1", thread("b", "2026-01-01T00:00:01Z"));
    deleteThread("d1", "a");
    expect(loadThreads("d1").map((t) => t.id)).toEqual(["b"]);
  });

  it("returns an empty list rather than throwing on corrupt storage", () => {
    localStorage.setItem("bai-chat:v1:d1", "{not json");
    expect(loadThreads("d1")).toEqual([]);
    localStorage.setItem("bai-chat:v1:d1", JSON.stringify({ not: "an array" }));
    expect(loadThreads("d1")).toEqual([]);
    localStorage.setItem(
      "bai-chat:v1:d1",
      JSON.stringify([{ id: 1 }, thread("ok", "2026-01-01T00:00:00Z")]),
    );
    expect(loadThreads("d1").map((t) => t.id)).toEqual(["ok"]);
  });

  it("does not throw when the quota is exhausted, and retries with fewer threads", () => {
    for (let i = 0; i < 10; i++) {
      saveThread(
        "d1",
        thread(`t${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
      );
    }
    let calls = 0;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        calls++;
        // First attempt over-quota; second (halved) attempt succeeds.
        if (calls === 1)
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        (this as unknown as { map: Map<string, string> }).map.set(k, v);
      });
    expect(() =>
      saveThread("d1", thread("new", "2026-01-01T00:01:00Z")),
    ).not.toThrow();
    spy.mockRestore();
    const got = loadThreads("d1");
    expect(got[0].id).toBe("new");
    expect(got.length).toBeLessThan(11);
  });
});

describe("threadTitleFrom", () => {
  it("uses the first line of the first user message, trimmed to a sane length", () => {
    expect(threadTitleFrom("What do we know about audit trails?\nmore")).toBe(
      "What do we know about audit trails?",
    );
    expect(threadTitleFrom("x".repeat(200)).length).toBeLessThanOrEqual(61);
    expect(threadTitleFrom("   ")).toBe("New chat");
  });
});
