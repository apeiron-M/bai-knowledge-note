/**
 * A tiny notification bus, so a failed write says so instead of failing
 * silently.
 *
 * The gap this closes: every write goes through one GraphQL helper, which
 * throws on a GraphQL error — but callers largely swallow the rejection, so a
 * server refusal like
 *
 *   Forbidden: insufficient permissions to execute operation
 *   "UPDATE_ORIENTATION" on this document
 *
 * was visible only in devtools. Authorization is exactly the case where a
 * silent failure is worst: the UI looks like it worked, and the user believes
 * their edit was saved.
 *
 * Deliberately not `usePHToast` from reactor-browser, though it exists: this
 * vault has never used it, so whether Connect mounts a toast host in this
 * editor's context is unverified, and an error reporter that itself fails
 * silently would be worse than none. Consolidating onto the platform toast is
 * a reasonable follow-up once that is confirmed.
 */
export type NoticeLevel = "error" | "warning" | "info" | "success";

export type Notice = {
  id: number;
  level: NoticeLevel;
  message: string;
  /** Context the user can act on, e.g. which document refused the write. */
  detail?: string;
};

type Listener = (notice: Notice) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/**
 * Suppress repeats of the same headline in quick succession.
 *
 * One user action often dispatches several operations — ingesting a source
 * sends INGEST_SOURCE and SET_SOURCE_STATUS — and when the document is
 * protected every one of them is refused. Reporting each produces a stack of
 * toasts saying the same thing, which is noise rather than information: the
 * headline is the actionable part, and it is identical.
 *
 * Deliberately keyed on the headline rather than the full text, since the
 * detail differs by operation name and keying on it would defeat the purpose.
 * The first message through wins, so the detail shown is the first refusal
 * rather than an arbitrary one.
 */
const DEDUPE_WINDOW_MS = 4000;
const recent = new Map<string, number>();

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(
  level: NoticeLevel,
  message: string,
  detail?: string,
): void {
  const key = `${level}|${message}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;

  recent.set(key, now);
  // Keep the map from growing across a long session.
  if (recent.size > 32) {
    for (const [k, t] of recent) {
      if (now - t >= DEDUPE_WINDOW_MS) recent.delete(k);
    }
  }

  const notice: Notice = { id: nextId++, level, message, detail };
  for (const fn of listeners) fn(notice);
}

/**
 * Turn a GraphQL error into something a person can act on.
 *
 * The server's own wording is kept — it names the operation and the reason,
 * which is more useful than anything generic — but it is prefixed by what kind
 * of problem it is, because "Forbidden: …" alone reads like a bug rather than
 * a permissions decision.
 */
export function notifyGraphQLError(messages: string[]): void {
  const first = messages[0] ?? "The request was refused.";
  const rest = messages.length > 1 ? `+${messages.length - 1} more` : undefined;

  if (/forbidden|insufficient permissions/i.test(first)) {
    notify("error", "You do not have permission to do that", `${first}${rest ? ` (${rest})` : ""}`);
    return;
  }
  if (/authentication required|unauthenticated|401/i.test(first)) {
    notify("error", "You are signed out", "Sign in again to continue — your session or credential has expired.");
    return;
  }
  notify("error", "That did not work", `${first}${rest ? ` (${rest})` : ""}`);
}

/**
 * Report any thrown request error, whatever threw it.
 *
 * graphql-request rejects with a ClientError carrying the full payload on
 * `.response.errors`, so the server's own message survives — including the
 * FORBIDDEN wording that names the refused operation. Anything else falls back
 * to the error's message.
 *
 * This exists because there are two write paths in this app, and the first
 * version of these notifications only covered one: the hand-rolled GraphQL
 * helper. Everything dispatched from a document editor goes through
 * reactor-browser's client instead, so a refused SET_CONTENT still failed
 * silently.
 */
export function notifyRequestError(err: unknown): void {
  // `err` is genuinely unknown here — a thrown null is legal — so the cast has
  // to admit that rather than the optional chain being decorative.
  const response = (
    err as { response?: { errors?: { message?: string }[] } } | null | undefined
  )?.response;
  const messages = response?.errors
    ?.map((e) => e.message)
    .filter((m): m is string => typeof m === "string" && m.length > 0);

  if (messages && messages.length > 0) {
    notifyGraphQLError(messages);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  // A bare network failure is not worth a modal-grade error; the app retries.
  if (/fetch failed|network|load failed/i.test(message)) {
    notify("warning", "Lost contact with the Switchboard", message);
    return;
  }
  notify("error", "That did not work", message);
}
