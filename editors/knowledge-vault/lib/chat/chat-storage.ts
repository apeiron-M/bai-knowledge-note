/**
 * Browser-local chat history, scoped per drive.
 *
 * No document model: the vault is remote-first and anything modelled as a
 * document would sync to Switchboard, which is exactly what the user asked
 * this not to do. localStorage under `bai-chat:v1:<driveId>` follows the
 * existing `bai-graph-snapshot:v1:<driveId>` convention.
 *
 * Only user/assistant turns and citation stubs are persisted — never raw tool
 * payloads. Re-running a search costs ~0.4s; storing full note bodies would
 * exhaust the ~5MB budget within a few conversations.
 */

export const MAX_THREADS = 20;
const TITLE_MAX = 60;

export interface Citation {
  documentId: string;
  title: string;
  /** `bai/knowledge-note`, `bai/moc`, `powerhouse/scopeofwork`, … when the tool that surfaced it said. */
  documentType?: string | null;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  /** Documents the answer cites inline, in order of first mention. */
  citations?: Citation[];
  /**
   * Documents the model read in full during this turn but did not cite.
   * Listed in the same Sources row after the cited ones, so the reader sees
   * everything the answer was generated from whatever the model's citing
   * discipline was on the day.
   */
  consulted?: Citation[];
}

export interface Thread {
  id: string;
  title: string;
  updatedAt: string;
  messages: StoredMessage[];
}

const key = (driveId: string) => `bai-chat:v1:${driveId}`;

function isThread(v: unknown): v is Thread {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<Thread>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.updatedAt === "string" &&
    Array.isArray(t.messages)
  );
}

export function loadThreads(driveId: string): Thread[] {
  const raw = localStorage.getItem(key(driveId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A single malformed entry must not take the whole history with it.
    return parsed.filter(isThread);
  } catch {
    return [];
  }
}

function write(driveId: string, threads: Thread[]): void {
  try {
    localStorage.setItem(key(driveId), JSON.stringify(threads));
  } catch {
    // Over quota. Drop the older half and try once more; if that also fails,
    // history simply stays in memory for this session.
    const trimmed = threads.slice(
      0,
      Math.max(1, Math.floor(threads.length / 2)),
    );
    try {
      localStorage.setItem(key(driveId), JSON.stringify(trimmed));
    } catch {
      /* give up silently */
    }
  }
}

/** Upsert by id, most-recent-first, capped at MAX_THREADS. */
export function saveThread(driveId: string, thread: Thread): void {
  const others = loadThreads(driveId).filter((t) => t.id !== thread.id);
  const next = [thread, ...others]
    .sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    )
    .slice(0, MAX_THREADS);
  write(driveId, next);
}

export function deleteThread(driveId: string, threadId: string): void {
  write(
    driveId,
    loadThreads(driveId).filter((t) => t.id !== threadId),
  );
  if (readCurrentThreadId(driveId) === threadId)
    writeCurrentThreadId(driveId, null);
}

/*
 * Which thread is open. This is tab navigation state, not history, so it
 * lives in sessionStorage — like the search view's `bai-search-state`. It is
 * what lets the chat come back to the same conversation after the user opens
 * a cited note (which replaces the chat view) and closes it again.
 */
const currentKey = (driveId: string) => `bai-chat:current:v1:${driveId}`;

export function readCurrentThreadId(driveId: string): string | null {
  return sessionStorage.getItem(currentKey(driveId));
}

export function writeCurrentThreadId(
  driveId: string,
  threadId: string | null,
): void {
  if (threadId) sessionStorage.setItem(currentKey(driveId), threadId);
  else sessionStorage.removeItem(currentKey(driveId));
}

/** A thread's title is its opening question, first line, trimmed. */
export function threadTitleFrom(firstUserMessage: string): string {
  const line = firstUserMessage.split("\n")[0]?.trim() ?? "";
  if (!line) return "New chat";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line;
}
