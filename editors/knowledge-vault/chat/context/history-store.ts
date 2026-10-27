/**
 * Chat history (M0): one thread per drive, per browser, in IndexedDB, with
 * an in-memory fallback when IndexedDB is missing or throws (private
 * windows). Each entry stores the target it was about; a ring of recent
 * documents lives beside the thread. The model never sees any of this: the
 * pipeline stays single-turn.
 */
import type { ContextTarget, DocumentTarget } from "./context-frame.js";

export type HistoryRole = "user" | "assistant" | "system" | "error";

export interface HistoryEntry {
  id: string;
  /** Epoch ms. */
  at: number;
  /** Entries of one request share it. */
  turnId: string;
  role: HistoryRole;
  text: string;
  /** What the entry is about: the action's target, or the tag on send. */
  target?: ContextTarget;
  /** On a user entry: the tag when it was sent. */
  context?: ContextTarget;
}

export interface ChatThread {
  driveId: string;
  entries: HistoryEntry[];
  /** Most recent first. */
  recent: DocumentTarget[];
}

/** The storage under a history store: whole threads by drive id. */
export interface ThreadBackend {
  readonly persistent: boolean;
  get(driveId: string): Promise<ChatThread | undefined>;
  put(thread: ChatThread): Promise<void>;
  delete(driveId: string): Promise<void>;
}

export interface ChatHistoryStore {
  /** `false` when history lives in memory only (lost on reload). */
  readonly persistent: boolean;
  load(driveId: string): Promise<ChatThread>;
  append(driveId: string, entry: HistoryEntry): Promise<void>;
  /** Move a document to the front of the drive's recent ring. */
  touchRecent(driveId: string, doc: DocumentTarget): Promise<void>;
  clear(driveId: string): Promise<void>;
}

export const HISTORY_CAP = 200;
export const RECENT_CAP = 20;

export function memoryBackend(): ThreadBackend {
  const m = new Map<string, ChatThread>();
  return {
    persistent: false,
    get: (id) => Promise.resolve(m.get(id)),
    put: (t) => {
      m.set(t.driveId, structuredClone(t));
      return Promise.resolve();
    },
    delete: (id) => {
      m.delete(id);
      return Promise.resolve();
    },
  };
}

const empty = (driveId: string): ChatThread => ({ driveId, entries: [], recent: [] });

/**
 * A store over `backend`: threads are cached after the first load and
 * writes are queued, so appends never race each other. Over the caps the
 * oldest entries and the least recent documents drop.
 */
export function createHistoryStore(
  backend: ThreadBackend,
  caps: { entries?: number; recent?: number } = {},
): ChatHistoryStore {
  const maxEntries = caps.entries ?? HISTORY_CAP;
  const maxRecent = caps.recent ?? RECENT_CAP;
  const cache = new Map<string, Promise<ChatThread>>();
  let queue: Promise<unknown> = Promise.resolve();

  const thread = (driveId: string) => {
    let t = cache.get(driveId);
    if (!t) {
      t = backend
        .get(driveId)
        .catch(() => undefined)
        .then((x) => x ?? empty(driveId));
      cache.set(driveId, t);
    }
    return t;
  };
  const update = (driveId: string, f: (t: ChatThread) => ChatThread) => {
    const next = queue.then(async () => {
      const t = f(await thread(driveId));
      cache.set(driveId, Promise.resolve(t));
      await backend.put(t);
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    persistent: backend.persistent,
    async load(driveId) {
      await queue;
      return thread(driveId);
    },
    append: (driveId, entry) =>
      update(driveId, (t) => ({ ...t, entries: [...t.entries, entry].slice(-maxEntries) })),
    touchRecent: (driveId, doc) =>
      update(driveId, (t) => ({
        ...t,
        recent: [doc, ...t.recent.filter((d) => d.id !== doc.id)].slice(0, maxRecent),
      })),
    clear(driveId) {
      const next = queue.then(async () => {
        cache.set(driveId, Promise.resolve(empty(driveId)));
        await backend.delete(driveId);
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

const DB_NAME = "bai-chat-history";
const STORE = "threads";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

/** The IndexedDB backend, or `null` when the database cannot be opened. */
export async function indexedDbBackend(): Promise<ThreadBackend | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE))
        open.result.createObjectStore(STORE, { keyPath: "driveId" });
    };
    const db = await req(open);
    const store = (mode: IDBTransactionMode) =>
      db.transaction(STORE, mode).objectStore(STORE);
    return {
      persistent: true,
      get: async (id) => {
        const v: unknown = await req(store("readonly").get(id));
        return isThread(v) ? v : undefined;
      },
      put: async (t) => {
        await req(store("readwrite").put(t));
      },
      delete: async (id) => {
        await req(store("readwrite").delete(id));
      },
    };
  } catch {
    return null;
  }
}

function isThread(v: unknown): v is ChatThread {
  return (
    typeof v === "object" &&
    v !== null &&
    "entries" in v &&
    Array.isArray(v.entries) &&
    "recent" in v &&
    Array.isArray(v.recent)
  );
}

let shared: Promise<ChatHistoryStore> | null = null;

/** The page's history store: IndexedDB when it opens, else memory. */
export function chatHistoryStore(): Promise<ChatHistoryStore> {
  shared ??= indexedDbBackend().then((b) => createHistoryStore(b ?? memoryBackend()));
  return shared;
}
