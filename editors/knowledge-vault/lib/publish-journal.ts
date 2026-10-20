import { authHeaders } from "../../shared/authed-fetch.js";
import { resolveReactorEndpoint } from "../../shared/subgraph-endpoint.js";

/**
 * Adding a file's sections, written down as it goes: an add the page did not
 * live to finish — a reload, the app quitting, a crash — carries on the next
 * time the vault opens instead of stopping silently part-way (a 1,000-page
 * book needs minutes; one cut short left 57 of its 920 sections and nothing
 * to say the rest was missing).
 *
 * What is kept is everything the rest of the add needs and nothing more: the
 * sources still to create — title, content, and the actions that attach the
 * original and its figures, all uploaded before the first source is created,
 * so the file's bytes are never needed again — and how many are done.
 * IndexedDB where there is one (Connect and the desktop app both have it);
 * without one, memory, which is how it always behaved.
 */

export type JournalAction = { type: string; scope: "global"; input: unknown };

/** One source still to create. */
export type JournalItem = {
  title: string;
  content: string;
  sourceType: string;
  /** Applied right after it is created: the original and figures it claims. */
  actions: JournalAction[];
};

export type JournalEntry = {
  id: string;
  driveId: string;
  /** The file it came from, as the person knows it. */
  fileName: string;
  folderId: string;
  folderName: string;
  total: number;
  /** Items created so far, from the first: the add goes in order. */
  done: number;
  sourceIds: string[];
  /** The vault refused a source: the add waits for the person rather than retrying by itself. */
  error?: string;
  startedAt: string;
  updatedAt: string;
};

export type PublishJournal = {
  start(
    entry: Pick<JournalEntry, "driveId" | "fileName" | "folderId" | "folderName">,
    items: readonly JournalItem[],
  ): Promise<string>;
  /** One more item is in the vault (its id, or `null` when it was found already there). */
  advance(id: string, sourceId: string | null): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  /** Clear a refusal, before trying again. */
  clearError(id: string): Promise<void>;
  /** Done, or given up: forget it. */
  finish(id: string): Promise<void>;
  entries(driveId: string): Promise<JournalEntry[]>;
  items(id: string): Promise<JournalItem[]>;
};

const nowIso = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** In memory: tests, and a page without IndexedDB (an add then lives as long as the page). */
export function memoryJournal(): PublishJournal {
  const entries = new Map<string, JournalEntry>();
  const items = new Map<string, JournalItem[]>();
  const update = (id: string, patch: (e: JournalEntry) => JournalEntry): Promise<void> => {
    const entry = entries.get(id);
    if (entry) entries.set(id, patch(entry));
    return Promise.resolve();
  };
  return {
    start(entry, list) {
      const id = newId();
      const at = nowIso();
      entries.set(id, { ...entry, id, total: list.length, done: 0, sourceIds: [], startedAt: at, updatedAt: at });
      items.set(id, [...list]);
      return Promise.resolve(id);
    },
    advance: (id, sourceId) =>
      update(id, (e) => ({
        ...e,
        done: e.done + 1,
        sourceIds: sourceId ? [...e.sourceIds, sourceId] : e.sourceIds,
        updatedAt: nowIso(),
      })),
    fail: (id, error) => update(id, (e) => ({ ...e, error, updatedAt: nowIso() })),
    clearError: (id) =>
      update(id, (e) => {
        const { error: _cleared, ...rest } = e;
        return { ...rest, updatedAt: nowIso() };
      }),
    finish(id) {
      entries.delete(id);
      items.delete(id);
      return Promise.resolve();
    },
    entries(driveId) {
      return Promise.resolve([...entries.values()].filter((e) => e.driveId === driveId));
    },
    items(id) {
      return Promise.resolve(items.get(id) ?? []);
    },
  };
}

const DB = "bai-publish-journal";
const ENTRIES = "entries";
const ITEMS = "items";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let opened: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB unavailable"));
  }).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

/** The page's journal: IndexedDB, or memory where there is none. */
export function pageJournal(): PublishJournal {
  if (typeof indexedDB === "undefined") return memoryJournal();
  const update = async (id: string, patch: (e: JournalEntry) => JournalEntry) => {
    const db = await database();
    const tx = db.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    const entry = (await request(store.get(id))) as JournalEntry | undefined;
    if (entry) store.put(patch(entry));
    await done(tx);
  };
  return {
    async start(entry, list) {
      const db = await database();
      const id = newId();
      const at = nowIso();
      const tx = db.transaction([ENTRIES, ITEMS], "readwrite");
      tx.objectStore(ITEMS).put({ id, items: list });
      tx.objectStore(ENTRIES).put({ ...entry, id, total: list.length, done: 0, sourceIds: [], startedAt: at, updatedAt: at });
      await done(tx);
      return id;
    },
    advance: (id, sourceId) =>
      update(id, (e) => ({
        ...e,
        done: e.done + 1,
        sourceIds: sourceId ? [...e.sourceIds, sourceId] : e.sourceIds,
        updatedAt: nowIso(),
      })),
    fail: (id, error) => update(id, (e) => ({ ...e, error, updatedAt: nowIso() })),
    clearError: (id) =>
      update(id, (e) => {
        const { error: _cleared, ...rest } = e;
        return { ...rest, updatedAt: nowIso() };
      }),
    async finish(id) {
      const db = await database();
      const tx = db.transaction([ENTRIES, ITEMS], "readwrite");
      tx.objectStore(ENTRIES).delete(id);
      tx.objectStore(ITEMS).delete(id);
      await done(tx);
    },
    async entries(driveId) {
      const db = await database();
      const all = (await request(db.transaction(ENTRIES).objectStore(ENTRIES).getAll())) as JournalEntry[];
      return all.filter((e) => e.driveId === driveId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    },
    async items(id) {
      const db = await database();
      const row = (await request(db.transaction(ITEMS).objectStore(ITEMS).get(id))) as
        | { items: JournalItem[] }
        | undefined;
      return row?.items ?? [];
    },
  };
}

/**
 * The titles of the sources in a folder, read from the vault's drive tree (a
 * source's node is named by its title): what an add that carries on checks
 * first, so the one source created as the page went away is not made twice.
 */
export async function readFolderTitles(driveId: string, folderId: string): Promise<string[]> {
  const res = await fetch(resolveReactorEndpoint(), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      query: `query VaultFolderTitles($id: String!) { document(idOrSlug: $id) { document { state } } }`,
      variables: { id: driveId },
    }),
  });
  if (!res.ok) throw new Error(`The vault's files could not be read (HTTP ${res.status}).`);
  const body = (await res.json()) as {
    data?: { document?: { document?: { state?: { global?: { nodes?: unknown } } & { nodes?: unknown } } } };
  };
  const state = body.data?.document?.document?.state;
  const nodes = (state?.global?.nodes ?? state?.nodes ?? []) as {
    name?: string;
    parentFolder?: string | null;
    documentType?: string;
  }[];
  return nodes
    .filter((n) => n.parentFolder === folderId && n.documentType === "bai/source" && typeof n.name === "string")
    .map((n) => n.name as string);
}

type LockManagerLike = {
  request<T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T>): Promise<T>;
};

function lockManager(): LockManagerLike | null {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManagerLike });
  return nav?.locks ?? null;
}

/**
 * Run an add holding its lock, so no other window of this vault — Connect open
 * in two tabs — carries the same add on at the same time and makes every
 * source twice. Without Web Locks (an old browser) it simply runs.
 */
export function holdingJournal<T>(id: string, run: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  return locks ? locks.request(`bai-publish:${id}`, {}, run) : run();
}

/** Like `holdingJournal`, but only if no other window holds it: `null` when one does. */
export function ifJournalFree<T>(id: string, run: () => Promise<T>): Promise<T | null> {
  const locks = lockManager();
  if (!locks) return run();
  return locks.request(`bai-publish:${id}`, { ifAvailable: true }, async (lock) => (lock ? run() : null));
}
