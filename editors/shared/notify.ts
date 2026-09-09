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

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(
  level: NoticeLevel,
  message: string,
  detail?: string,
): void {
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
