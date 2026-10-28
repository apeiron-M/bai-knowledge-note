// Moved to nl-runtime in M1 (M1-UI). This shim keeps the old path for the
// test importers; M3 retargets them and deletes it.
import {
  type ChatHistoryStore,
  chatHistoryStore as coreChatHistoryStore,
  historyDbName,
  indexedDbBackend as coreIndexedDbBackend,
  type ThreadBackend,
} from "nl-runtime";

export {
  type ChatHistoryStore,
  type ChatThread,
  createHistoryStore,
  HISTORY_CAP,
  type HistoryEntry,
  type HistoryRole,
  memoryBackend,
  RECENT_CAP,
  type ThreadBackend,
} from "nl-runtime";

/** The vault's database, `bai-chat-history` (the old UI's name). */
const DB_NAME = historyDbName("bai.chat");

/** The IndexedDB backend, or `null` when the database cannot be opened. */
export const indexedDbBackend = (): Promise<ThreadBackend | null> =>
  coreIndexedDbBackend(DB_NAME);

/** The page's history store: IndexedDB when it opens, else memory. */
export const chatHistoryStore = (): Promise<ChatHistoryStore> =>
  coreChatHistoryStore(DB_NAME);
