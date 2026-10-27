/**
 * The live chat session per drive: the thread on screen and at most one
 * pending card. It lives in a module store, not in component state, so it
 * outlives the sheet collapsing and the drive app re-rendering on
 * navigation. A pending card keeps the target it was created for; the tag
 * moving on never changes it, and Confirm dispatches to it.
 */
import type { ContextTarget, DocumentTarget } from "./context-frame.js";
import type { HistoryEntry } from "./history-store.js";

export interface PendingCard<P> {
  payload: P;
  /** The document the card acts on (what Confirm dispatches to). */
  target: DocumentTarget;
  /** The tag when the card was created. */
  context: ContextTarget;
  /** Set when the request named another document than the viewed one. */
  retargetedFrom?: DocumentTarget;
}

export interface ChatSessionState<P> {
  loaded: boolean;
  entries: HistoryEntry[];
  pending: PendingCard<P> | null;
  /** Recently opened or dispatched-to documents, most recent first. */
  recent: DocumentTarget[];
}

export type ChatSessionAction<P> =
  | { type: "loaded"; entries: HistoryEntry[]; recent: DocumentTarget[] }
  | { type: "recent"; doc: DocumentTarget; cap?: number }
  | { type: "append"; entry: HistoryEntry }
  | { type: "pending"; card: PendingCard<P> }
  | { type: "settle" }
  | { type: "clear" };

export function initialSession<P>(): ChatSessionState<P> {
  return { loaded: false, entries: [], pending: null, recent: [] };
}

export function chatSessionReducer<P>(
  s: ChatSessionState<P>,
  a: ChatSessionAction<P>,
): ChatSessionState<P> {
  switch (a.type) {
    case "loaded": {
      // entries appended before the load finished stay, after the stored ones
      const ids = new Set(a.entries.map((e) => e.id));
      return {
        ...s,
        loaded: true,
        entries: [...a.entries, ...s.entries.filter((e) => !ids.has(e.id))],
        recent: mergeRecent(s.recent, a.recent),
      };
    }
    case "recent":
      return { ...s, recent: mergeRecent([a.doc], s.recent, a.cap) };
    case "append":
      return { ...s, entries: [...s.entries, a.entry] };
    case "pending":
      return { ...s, pending: a.card };
    case "settle":
      return { ...s, pending: null };
    case "clear":
      return { ...s, entries: [], pending: null, recent: [] };
  }
}

/** `first` ahead of `then`, one entry per id, at most `cap`. */
function mergeRecent(
  first: DocumentTarget[],
  then: DocumentTarget[],
  cap = 20,
): DocumentTarget[] {
  const seen = new Set<string>();
  return [...first, ...then]
    .filter((d) => !seen.has(d.id) && Boolean(seen.add(d.id)))
    .slice(0, cap);
}

/** The document Confirm dispatches to: the card's own target, never the tag. */
export function confirmTargetId<P>(s: ChatSessionState<P>): string | null {
  return s.pending?.target.id ?? null;
}

export interface ChatSessionStore<P> {
  get(driveId: string): ChatSessionState<P>;
  dispatch(driveId: string, a: ChatSessionAction<P>): void;
  subscribe(cb: () => void): () => void;
}

export function createSessionStore<P>(): ChatSessionStore<P> {
  const sessions = new Map<string, ChatSessionState<P>>();
  const listeners = new Set<() => void>();
  const get = (driveId: string) => {
    let s = sessions.get(driveId);
    if (!s) {
      s = initialSession<P>();
      sessions.set(driveId, s);
    }
    return s;
  };
  return {
    get,
    dispatch(driveId, a) {
      sessions.set(driveId, chatSessionReducer(get(driveId), a));
      for (const l of listeners) l();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface CardTargetNotice {
  /** The request named another document than the one being viewed. */
  switchedFrom?: DocumentTarget;
  /** The user has since moved to another document or the drive. */
  nowViewing?: ContextTarget;
}

/** What a card says about its target next to the tag's current value. */
export function cardTargetNotice<P>(
  card: Pick<PendingCard<P>, "target" | "retargetedFrom">,
  viewing: ContextTarget,
): CardTargetNotice {
  const moved = !(viewing.kind === "document" && viewing.id === card.target.id);
  const stillOnSource = card.retargetedFrom?.id === viewing.id;
  return {
    switchedFrom: card.retargetedFrom,
    nowViewing: moved && !stillOnSource ? viewing : undefined,
  };
}
