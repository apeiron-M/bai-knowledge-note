/**
 * A tiny notification bus, so a failed request says so instead of failing
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
 * Rendered by `Notifications.tsx`, which prefers Connect's own toast and falls
 * back to a local one when no toast host is mounted.
 */
export type NoticeLevel = "error" | "warning" | "info" | "success";

export type Notice = {
  id: number;
  level: NoticeLevel;
  message: string;
  /** Context the user can act on, e.g. which document refused the write. */
  detail?: string;
  /** How long the renderer keeps it on screen. Every notice expires. */
  ttlMs: number;
};

export type NotifyOptions = {
  /** Suppress a repeat of the same headline for this long. */
  dedupeMs?: number;
  /** Override the level's default lifetime. */
  ttlMs?: number;
};

type Listener = (notice: Notice) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/**
 * Every notice disappears on its own.
 *
 * These report on *requests* — a refused write, a lost connection, an expired
 * session — and a toast is the wrong place for the durable statement of such a
 * state: that belongs in the UI itself (AuthGate's sign-in card, an inline
 * "not saved" mark), where it stays until the state changes. A toast that never
 * leaves just stacks up; three identical ones after a sign-out were the
 * reminder. Errors get a little longer so the operation name can be read.
 */
export const NOTICE_TTL_MS = 6_000;
export const ERROR_TTL_MS = 8_000;

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
const DEDUPE_WINDOW_MS = 4_000;
/**
 * A session ends once. Signing out fails every request that was in flight and
 * every poll that fires before the app notices, and each of them says 401 —
 * that is one event for the user, so it gets one notice, however many
 * refusals arrive over the next half minute.
 */
export const SIGNED_OUT_DEDUPE_MS = 30_000;
const recent = new Map<string, number>();

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(
  level: NoticeLevel,
  message: string,
  detail?: string,
  options: NotifyOptions = {},
): void {
  const dedupeMs = options.dedupeMs ?? DEDUPE_WINDOW_MS;
  const key = `${level}|${message}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < dedupeMs) return;

  recent.set(key, now);
  // Keep the map from growing across a long session. Prune by the longest
  // window in use, so a headline still inside its own window is never dropped.
  if (recent.size > 32) {
    for (const [k, t] of recent) {
      if (now - t >= SIGNED_OUT_DEDUPE_MS) recent.delete(k);
    }
  }

  const ttlMs =
    options.ttlMs ?? (level === "error" ? ERROR_TTL_MS : NOTICE_TTL_MS);
  const notice: Notice = { id: nextId++, level, message, detail, ttlMs };
  for (const fn of listeners) fn(notice);
}

/**
 * The one message for "your session is gone", however the server phrased it.
 *
 * A warning, not an error: nothing is broken and nothing was lost that a
 * sign-in will not restore. The vault's AuthGate already explains the state at
 * length, so this only has to name it.
 */
export function notifySignedOut(): void {
  notify(
    "warning",
    "You are signed out",
    "Sign in again to keep working with this vault.",
    { dedupeMs: SIGNED_OUT_DEDUPE_MS },
  );
}

/**
 * A signed-in caller whose credential the vault refused — no grant, or a
 * credential the server would not accept. Signing in again cannot fix it, so
 * the message points at the administrator. Said once per half minute: AuthGate
 * re-checks on every render of its card, and the card itself carries the
 * address to hand over.
 */
export function notifyUnauthorized(): void {
  notify(
    "error",
    "Your credential is not authorised",
    "You are signed in, but this vault did not accept your credential. Ask an administrator to grant your address access.",
    { dedupeMs: SIGNED_OUT_DEDUPE_MS },
  );
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
    notifySignedOut();
    return;
  }
  notify("error", "That did not work", `${first}${rest ? ` (${rest})` : ""}`);
}

/**
 * What a thrown request carries, from whichever client threw it.
 *
 * graphql-request rejects with a `ClientError` whose `response` holds the HTTP
 * status and the parsed body. A GraphQL-level refusal arrives as
 * `response.errors[]`; a refusal from middleware that runs BEFORE GraphQL —
 * REQUIRE_AUTHENTICATED_CALLER answering 401 — has no `errors` at all, only
 * `status` and the body `{ "error": "Authentication required" }`, which
 * graphql-request surfaces as `response.error`. Both shapes are read here so
 * that a 401 is a 401 whichever layer said it.
 */
type RequestFailure = {
  status?: number;
  serverError?: string;
  messages: string[];
};

function describeFailure(err: unknown): RequestFailure {
  // `err` is genuinely unknown here — a thrown null is legal — so the cast has
  // to admit that rather than the optional chain being decorative.
  const response = (
    err as
      | {
          response?: {
            status?: unknown;
            error?: unknown;
            errors?: { message?: unknown }[];
          };
        }
      | null
      | undefined
  )?.response;
  const status = typeof response?.status === "number" ? response.status : undefined;
  const serverError =
    typeof response?.error === "string" && response.error.length > 0
      ? response.error
      : undefined;
  const messages = (response?.errors ?? [])
    .map((e) => e?.message)
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  return { status, serverError, messages };
}

/**
 * graphql-request's message is "GraphQL Error (Code: N): " followed by the
 * whole request and response as JSON — the query text, the variables, the
 * headers. That is a debugging record, not a sentence, and it is what used to
 * fill the toast. Only the status is kept from it.
 */
const RAW_CLIENT_ERROR = /^GraphQL Error \(Code: (\d+)\)/;
const MAX_DETAIL_CHARS = 240;

function humanMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const raw = RAW_CLIENT_ERROR.exec(message);
  if (raw) return `The Switchboard answered HTTP ${raw[1]}`;
  return message.length > MAX_DETAIL_CHARS
    ? `${message.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : message;
}

/**
 * Report any thrown request error, whatever threw it.
 *
 * This exists because there are two write paths in this app, and the first
 * version of these notifications only covered one: the hand-rolled GraphQL
 * helper. Everything dispatched from a document editor goes through
 * reactor-browser's client instead, so a refused SET_CONTENT still failed
 * silently.
 */
export function notifyRequestError(err: unknown): void {
  const { status, serverError, messages } = describeFailure(err);

  if (messages.length > 0) {
    notifyGraphQLError(messages);
    return;
  }
  if (
    status === 401 ||
    (serverError !== undefined &&
      /authentication required|unauthenticated/i.test(serverError))
  ) {
    notifySignedOut();
    return;
  }
  if (status === 403) {
    notify(
      "error",
      "You do not have permission to do that",
      serverError ?? "The Switchboard refused the request (HTTP 403).",
    );
    return;
  }

  const message = humanMessage(err);
  // A bare network failure is not worth a modal-grade error; the app retries.
  if (/fetch failed|network|load failed/i.test(message)) {
    notify("warning", "Lost contact with the Switchboard", message);
    return;
  }
  notify(
    "error",
    "That did not work",
    serverError ? `${message} — ${serverError}` : message,
  );
}
