import { describe, expect, it } from "vitest";
import type { DocumentTarget } from "../../editors/knowledge-vault/chat/context/context-frame.js";
import {
  createHistoryStore,
  indexedDbBackend,
  memoryBackend,
  type HistoryEntry,
  type ThreadBackend,
} from "../../editors/knowledge-vault/chat/context/history-store.js";

const doc = (id: string): DocumentTarget => ({
  kind: "document",
  id,
  driveId: "d1",
  title: `Doc ${id}`,
  docType: "bai/knowledge-note",
});
const entry = (id: string, target = doc("a")): HistoryEntry => ({
  id,
  at: Number(id.replace(/\D/g, "")) || 0,
  turnId: `t${id}`,
  role: "user",
  text: `message ${id}`,
  target,
  context: target,
});

describe("chat history store", () => {
  it("keeps one thread per drive, each entry with its target", async () => {
    const backend = memoryBackend();
    const store = createHistoryStore(backend);
    await store.append("d1", entry("1", doc("a")));
    await store.append("d1", entry("2", doc("b")));
    await store.append("d2", entry("3"));
    const t1 = await store.load("d1");
    expect(t1.entries.map((e) => [e.id, e.target?.id])).toEqual([
      ["1", "a"],
      ["2", "b"],
    ]);
    expect((await store.load("d2")).entries).toHaveLength(1);
    // survives a "reload": a new store over the same backend
    const again = createHistoryStore(backend);
    expect((await again.load("d1")).entries.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("caps the thread (oldest dropped) and the recent ring", async () => {
    const store = createHistoryStore(memoryBackend(), { entries: 3, recent: 2 });
    for (let i = 1; i <= 5; i++) await store.append("d1", entry(String(i)));
    for (const id of ["a", "b", "a", "c"]) await store.touchRecent("d1", doc(id));
    const t = await store.load("d1");
    expect(t.entries.map((e) => e.id)).toEqual(["3", "4", "5"]);
    expect(t.recent.map((d) => d.id)).toEqual(["c", "a"]);
  });

  it("queues concurrent appends without losing any", async () => {
    const store = createHistoryStore(memoryBackend());
    await Promise.all(["1", "2", "3", "4"].map((id) => store.append("d1", entry(id))));
    expect((await store.load("d1")).entries.map((e) => e.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("clears one drive only", async () => {
    const backend = memoryBackend();
    const store = createHistoryStore(backend);
    await store.append("d1", entry("1"));
    await store.touchRecent("d1", doc("a"));
    await store.append("d2", entry("2"));
    await store.clear("d1");
    expect(await store.load("d1")).toEqual({ driveId: "d1", entries: [], recent: [] });
    expect((await createHistoryStore(backend).load("d1")).entries).toEqual([]);
    expect((await store.load("d2")).entries).toHaveLength(1);
  });

  it("starts empty when the backend fails to read", async () => {
    const broken: ThreadBackend = {
      persistent: true,
      get: () => Promise.reject(new Error("blocked")),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    expect((await createHistoryStore(broken).load("d1")).entries).toEqual([]);
  });

  it("falls back to memory where IndexedDB is missing", async () => {
    // node has no indexedDB: the page store then runs in memory
    expect(await indexedDbBackend()).toBeNull();
    expect(createHistoryStore(memoryBackend()).persistent).toBe(false);
  });
});
