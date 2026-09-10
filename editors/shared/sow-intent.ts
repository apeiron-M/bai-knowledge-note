/**
 * One-shot "open this document AT this item" handoff between editors.
 *
 * The vault's Projects tab, a chat citation, or the WBS editor's "← Delivers"
 * link want to open a scope of work (or a WBS) already showing a particular
 * envelope, item or goal. Connect's navigation carries only the document id,
 * so the target is parked in sessionStorage just before `setSelectedNode` and
 * picked up by the editor that mounts for that document.
 *
 * ## Read in render, consume after commit — never the other way round
 *
 * The editor needs the intent in a `useState` initialiser, so the FIRST paint
 * is already the requested view rather than an overview that then jumps. But
 * an initialiser runs during render, and a render can be discarded: if
 * anything below suspends — the project view reads the envelope's WBS
 * document through `use()`, which suspends the first time that document is
 * not cached — React throws the whole in-progress render away and retries
 * once the promise settles. The original read here REMOVED the intent as a
 * side effect of reading it, so the retry found nothing and landed on the
 * overview. Exactly once per cold cache, never once warm — which is what made
 * it look flaky.
 *
 * So: `peekSowIntent` reads without consuming, and `useSowIntent` consumes in
 * an effect, which React runs only for renders it committed. A discarded
 * render leaves the intent in place for the retry. Idempotent under
 * StrictMode's double-invocation of both.
 *
 * A time-to-live bounds the cost of the one case that could now leave an
 * intent behind (the editor never committing at all): a stale intent is
 * ignored and dropped rather than steering an unrelated open minutes later.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "bai:sow-open-intent";

/** An intent older than this is stale: whatever wrote it has moved on. */
export const SOW_INTENT_TTL_MS = 60_000;

export type SowIntentView =
  | { kind: "project"; id: string }
  | { kind: "deliverables" }
  | { kind: "team" }
  /**
   * Any item by id — envelope, deliverable, milestone, roadmap or
   * contributor. A chat citation names an item without saying what it is;
   * the scope resolves the id against its own state (`locate` in the
   * editor's model) and opens the view that shows it.
   */
  | { kind: "locate"; id: string }
  /** A goal in a work breakdown — read by the WBS editor, which selects it. */
  | { kind: "goal"; id: string };

export type SowIntent = {
  documentId: string;
  view: SowIntentView;
};

type Stored = SowIntent & { at: number };

export function writeSowIntent(intent: SowIntent, now = Date.now()): void {
  try {
    const stored: Stored = { ...intent, at: now };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A private-mode or quota failure only costs the deep link, so the
    // navigation itself must still happen.
  }
}

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.documentId !== "string") return null;
    if (typeof parsed.at !== "number") return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

function viewOf(raw: unknown): SowIntentView | null {
  const view = raw as { kind?: unknown; id?: unknown } | undefined;
  const kind = view?.kind;
  const id = typeof view?.id === "string" ? view.id : null;
  if (kind === "project" && id) return { kind: "project", id };
  if (kind === "locate" && id) return { kind: "locate", id };
  if (kind === "goal" && id) return { kind: "goal", id };
  if (kind === "deliverables") return { kind: "deliverables" };
  if (kind === "team") return { kind: "team" };
  return null;
}

/**
 * The intent parked for `documentId`, WITHOUT consuming it. Safe to call
 * during render. Null when there is none, when it belongs to another document
 * (left in place — it is that document's to consume), or when it has expired
 * (dropped).
 */
export function peekSowIntent(
  documentId: string,
  now = Date.now(),
): SowIntentView | null {
  const stored = readStored();
  if (!stored) return null;
  if (now - stored.at > SOW_INTENT_TTL_MS) {
    clearSowIntent(stored.documentId);
    return null;
  }
  if (stored.documentId !== documentId) return null;
  return viewOf(stored.view);
}

/** Consume the intent, but only if it is this document's. */
export function clearSowIntent(documentId: string): void {
  try {
    const stored = readStored();
    if (stored && stored.documentId !== documentId) return;
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear, or storage is unavailable — either way nothing lingers.
  }
}

/**
 * The intent for this document as of the first committed mount: read during
 * render (so the first paint honours it), consumed in an effect (so a render
 * that suspends and is retried still finds it).
 */
export function useSowIntent(documentId: string): SowIntentView | null {
  const [intent] = useState(() => peekSowIntent(documentId));
  useEffect(() => {
    if (intent) clearSowIntent(documentId);
  }, [documentId, intent]);
  return intent;
}
