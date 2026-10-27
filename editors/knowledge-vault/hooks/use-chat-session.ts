import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { generateId } from "document-model";
import {
  createSessionStore,
  type PendingCard,
} from "../chat/context/chat-session.js";
import type { ContextTarget, DocumentTarget } from "../chat/context/context-frame.js";
import {
  chatHistoryStore,
  type HistoryEntry,
  type HistoryRole,
} from "../chat/context/history-store.js";
import type { PendingChoice, ProposedAction } from "./use-chat-llm.js";

export type CardPayload =
  | { kind: "proposal"; proposal: ProposedAction }
  | { kind: "choice"; choice: PendingChoice }
  /** Which document to change, asked before the models run: the open one
   * (the card's target) or the one the request names. */
  | { kind: "target"; utterance: string; open: DocumentTarget; named: DocumentTarget }
  /** Which document a non-verbatim mention means, asked before the models
   * run: the top 3 matches, plus the open document when it has ops. */
  | {
      kind: "pick";
      utterance: string;
      phrase: string;
      candidates: DocumentTarget[];
      open?: DocumentTarget;
    };

export type ChatCard = PendingCard<CardPayload>;

const store = createSessionStore<CardPayload>();
const loading = new Set<string>();

function persist(f: (h: Awaited<ReturnType<typeof chatHistoryStore>>) => Promise<void>) {
  void chatHistoryStore()
    .then(f)
    .catch((err: unknown) => console.warn("[chat history]", err));
}

/**
 * The drive's chat session (module store) and its history (IndexedDB):
 * loaded once per drive per page, appended as the turn runs.
 */
export function useChatSession(driveId: string) {
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(driveId),
  );
  const [persistent, setPersistent] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void chatHistoryStore().then((h) => {
      if (live) setPersistent(h.persistent);
    });
    if (driveId && !store.get(driveId).loaded && !loading.has(driveId)) {
      loading.add(driveId);
      void chatHistoryStore()
        .then((h) => h.load(driveId))
        .then(
          (t) => store.dispatch(driveId, { type: "loaded", entries: t.entries, recent: t.recent }),
          () => store.dispatch(driveId, { type: "loaded", entries: [], recent: [] }),
        )
        .finally(() => loading.delete(driveId));
    }
    return () => {
      live = false;
    };
  }, [driveId]);

  const append = useCallback(
    (
      role: HistoryRole,
      text: string,
      meta: { turnId: string; target?: ContextTarget; context?: ContextTarget },
    ) => {
      const entry: HistoryEntry = { id: generateId(), at: Date.now(), role, text, ...meta };
      store.dispatch(driveId, { type: "append", entry });
      persist((h) => h.append(driveId, entry));
    },
    [driveId],
  );

  const touchRecent = useCallback(
    (doc: DocumentTarget) => {
      const head = store.get(driveId).recent.at(0);
      if (head?.id === doc.id && head.title === doc.title) return;
      store.dispatch(driveId, { type: "recent", doc });
      persist((h) => h.touchRecent(driveId, doc));
    },
    [driveId],
  );

  return useMemo(
    () => ({
      state,
      /** `null` until known; `false`: memory only (lost on reload). */
      persistent,
      append,
      touchRecent,
      setPending: (card: ChatCard) => store.dispatch(driveId, { type: "pending", card }),
      settle: () => store.dispatch(driveId, { type: "settle" }),
      clear: () => {
        store.dispatch(driveId, { type: "clear" });
        persist((h) => h.clear(driveId));
      },
    }),
    [state, persistent, append, touchRecent, driveId],
  );
}

export type ChatSession = ReturnType<typeof useChatSession>;
