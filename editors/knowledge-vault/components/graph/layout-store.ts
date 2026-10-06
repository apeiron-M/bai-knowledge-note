/**
 * Remembers the graph's layout per drive, so a reload opens already laid out.
 *
 * In IndexedDB, not localStorage: a 100,000-node layout is ~5 MB of JSON,
 * which is localStorage's entire quota and would starve everything else the
 * app keeps there. IndexedDB stores the ids and a Float32Array as they are.
 * Where IndexedDB is unavailable, layouts are kept in memory for the session.
 */
import type { Point } from "./model.js";

const DB_NAME = "bai-graph-layout";
const STORE = "layouts";
/**
 * 3: layouts saved before the graph waited for its links (Connect loads the
 * notes first) may have been laid out without them; they are not restored.
 */
const FORMAT = 3;
/** Where an earlier build kept layouts; removed on first use. */
const LEGACY_LOCAL_STORAGE_PREFIX = "bai-graph-layout:v1:";

export type StoredLayout = { v: number; ids: string[]; xy: Float32Array };

/** The placed nodes of a layout, ready to store. */
export function encodeLayout(
  ids: readonly string[],
  pos: Float32Array,
): StoredLayout {
  const kept: string[] = [];
  const xy: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    kept.push(ids[i]);
    xy.push(x, y);
  }
  return { v: FORMAT, ids: kept, xy: Float32Array.from(xy) };
}

/** A stored layout as positions by id; null for anything that is not one. */
export function decodeLayout(value: unknown): Map<string, Point> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<StoredLayout>;
  if (
    v.v !== FORMAT ||
    !Array.isArray(v.ids) ||
    !(v.xy instanceof Float32Array)
  )
    return null;
  if (v.xy.length !== v.ids.length * 2) return null;
  const out = new Map<string, Point>();
  for (let i = 0; i < v.ids.length; i++) {
    const id = v.ids[i];
    const x = v.xy[i * 2];
    const y = v.xy[i * 2 + 1];
    if (typeof id === "string" && Number.isFinite(x) && Number.isFinite(y))
      out.set(id, { x, y });
  }
  return out;
}

export interface LayoutStore {
  load(key: string): Promise<Map<string, Point> | null>;
  save(key: string, ids: readonly string[], pos: Float32Array): void;
  clear(key: string): void;
}

/** A store for the session only (no IndexedDB, or it failed to open). */
export function memoryLayoutStore(): LayoutStore {
  const layouts = new Map<string, StoredLayout>();
  return {
    load: (key) => Promise.resolve(decodeLayout(layouts.get(key))),
    save: (key, ids, pos) => void layouts.set(key, encodeLayout(ids, pos)),
    clear: (key) => void layouts.delete(key),
  };
}

let shared: LayoutStore | null = null;

/** The layout store: IndexedDB where it works, memory otherwise. */
export function layoutStore(): LayoutStore {
  shared ??= createStore();
  return shared;
}

function createStore(): LayoutStore {
  removeLegacyLayouts();
  const fallback = memoryLayoutStore();
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return fallback;
  const db = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  const run = (
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest | void,
  ) =>
    db.then(
      (d) =>
        new Promise<unknown>((resolve) => {
          if (!d) return resolve(undefined);
          try {
            const req = fn(d.transaction(STORE, mode).objectStore(STORE));
            if (!req) return resolve(undefined);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        }),
    );
  return {
    load: async (key) => {
      const d = await db;
      if (!d) return fallback.load(key);
      return decodeLayout(await run("readonly", (s) => s.get(key)));
    },
    save: (key, ids, pos) => {
      const value = encodeLayout(ids, pos);
      void db.then((d) =>
        d
          ? run("readwrite", (s) => s.put(value, key))
          : fallback.save(key, ids, pos),
      );
    },
    clear: (key) => {
      void db.then((d) =>
        d ? run("readwrite", (s) => s.delete(key)) : fallback.clear(key),
      );
    },
  };
}

function removeLegacyLayouts(): void {
  try {
    const ls = globalThis.localStorage;
    const stale: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k?.startsWith(LEGACY_LOCAL_STORAGE_PREFIX)) stale.push(k);
    }
    for (const k of stale) ls.removeItem(k);
  } catch {
    // no localStorage: nothing to clean up
  }
}
