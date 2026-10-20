import type { ConvertedFile, IntakeFile } from "./intake-model.js";

/**
 * The Add sources batch, written down as it changes: a page reloaded — or a
 * desktop window restarted — while files converted or waited for review
 * brings them back as they were, instead of dropping them while the reader
 * carries on converting for nobody (a book takes a quarter of an hour).
 *
 * Three things per file, kept apart by size: its row (small, written again as
 * it changes — state, selection, folder), its bytes (once, when it joins), and
 * its conversion (once, when it arrives — tens of megabytes for a book). A
 * file leaves when it leaves the batch: removed, cancelled, or handed to the
 * add, which publish-journal.ts carries on from there.
 *
 * Each file belongs to one page at a time — the one that added it, or the
 * first to bring it back — held by a Web Lock, so two tabs of one vault never
 * both convert it or add it.
 */

export type SavedRow = {
  id: string;
  driveId: string;
  /** The row, without its conversion (kept apart) and its live progress. */
  file: Omit<IntakeFile, "converted" | "progress">;
  /** The service's job while it converted: what a page brought back asks after. */
  job?: string;
  /** When it joined the batch: rows come back in this order. */
  addedAt: string;
};

export type BatchJournal = {
  /** A file joined the batch: its row and its bytes. */
  add(driveId: string, file: IntakeFile, bytes: Blob): Promise<void>;
  /** The row changed; its conversion is written too when `withConversion`. */
  save(
    driveId: string,
    file: IntakeFile,
    job: string | undefined,
    withConversion: boolean,
  ): Promise<void>;
  remove(id: string): Promise<void>;
  /** The rows the pages of this vault left in their batches. */
  rows(driveId: string): Promise<SavedRow[]>;
  bytes(id: string): Promise<Blob | null>;
  conversion(id: string): Promise<ConvertedFile | null>;
  /** Take a file for this page: false when another page of this vault holds it. Held until `release`. */
  claim(id: string): Promise<boolean>;
  release(id: string): void;
};

const nowIso = () => new Date().toISOString();

function rowOf(driveId: string, file: IntakeFile, addedAt: string, job?: string): SavedRow {
  const { converted: _converted, progress: _progress, ...rest } = file;
  return { id: file.id, driveId, file: rest, ...(job ? { job } : {}), addedAt };
}

/** In memory: tests, and a page without IndexedDB (the batch then lives as long as the page). */
export function memoryBatchJournal(): BatchJournal {
  const rows = new Map<string, SavedRow>();
  const bytes = new Map<string, Blob>();
  const conversions = new Map<string, ConvertedFile>();
  const held = new Set<string>();
  return {
    add(driveId, file, blob) {
      rows.set(file.id, rowOf(driveId, file, nowIso()));
      bytes.set(file.id, blob);
      return Promise.resolve();
    },
    save(driveId, file, job, withConversion) {
      rows.set(file.id, rowOf(driveId, file, rows.get(file.id)?.addedAt ?? nowIso(), job));
      if (withConversion && file.converted) conversions.set(file.id, file.converted);
      return Promise.resolve();
    },
    remove(id) {
      rows.delete(id);
      bytes.delete(id);
      conversions.delete(id);
      return Promise.resolve();
    },
    rows(driveId) {
      return Promise.resolve([...rows.values()].filter((r) => r.driveId === driveId));
    },
    bytes: (id) => Promise.resolve(bytes.get(id) ?? null),
    conversion: (id) => Promise.resolve(conversions.get(id) ?? null),
    claim(id) {
      if (held.has(id)) return Promise.resolve(false);
      held.add(id);
      return Promise.resolve(true);
    },
    release(id) {
      held.delete(id);
    },
  };
}

const DB = "bai-intake-batch";
const ROWS = "rows";
const BYTES = "bytes";
const CONVERSIONS = "conversions";

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
      for (const store of [ROWS, BYTES, CONVERSIONS]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB unavailable"));
  }).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

/** The locks this page holds, by file. */
const releases = new Map<string, () => void>();

function claimLock(id: string): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || releases.has(id)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    locks
      .request(`bai-intake-file:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => releases.set(id, release));
      })
      .catch(() => resolve(true));
  });
}

function releaseLock(id: string) {
  releases.get(id)?.();
  releases.delete(id);
}

/** The page's batch journal: IndexedDB, or memory where there is none. */
export function pageBatchJournal(): BatchJournal {
  if (typeof indexedDB === "undefined") return memoryBatchJournal();
  return {
    async add(driveId, file, blob) {
      const db = await database();
      const tx = db.transaction([ROWS, BYTES], "readwrite");
      tx.objectStore(ROWS).put(rowOf(driveId, file, nowIso()));
      tx.objectStore(BYTES).put({ id: file.id, blob });
      await done(tx);
    },
    async save(driveId, file, job, withConversion) {
      const db = await database();
      const stores = withConversion && file.converted ? [ROWS, CONVERSIONS] : [ROWS];
      const tx = db.transaction(stores, "readwrite");
      const rowStore = tx.objectStore(ROWS);
      const before = (await request(rowStore.get(file.id))) as SavedRow | undefined;
      rowStore.put(rowOf(driveId, file, before?.addedAt ?? nowIso(), job));
      if (withConversion && file.converted) {
        tx.objectStore(CONVERSIONS).put({ id: file.id, converted: file.converted });
      }
      await done(tx);
    },
    async remove(id) {
      const db = await database();
      const tx = db.transaction([ROWS, BYTES, CONVERSIONS], "readwrite");
      tx.objectStore(ROWS).delete(id);
      tx.objectStore(BYTES).delete(id);
      tx.objectStore(CONVERSIONS).delete(id);
      await done(tx);
    },
    async rows(driveId) {
      const db = await database();
      const all = (await request(db.transaction(ROWS).objectStore(ROWS).getAll())) as SavedRow[];
      return all.filter((r) => r.driveId === driveId).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    },
    async bytes(id) {
      const db = await database();
      const row = (await request(db.transaction(BYTES).objectStore(BYTES).get(id))) as
        | { blob: Blob }
        | undefined;
      return row?.blob ?? null;
    },
    async conversion(id) {
      const db = await database();
      const row = (await request(db.transaction(CONVERSIONS).objectStore(CONVERSIONS).get(id))) as
        | { converted: ConvertedFile }
        | undefined;
      return row?.converted ?? null;
    },
    claim: claimLock,
    release: releaseLock,
  };
}
