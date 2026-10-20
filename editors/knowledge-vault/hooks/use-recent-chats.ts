import { useEffect, useState } from "react";
import { loadThreads, THREADS_CHANGED, type Thread } from "../lib/chat/chat-storage.js";

/** What the sidebar and the palette need of a chat: no messages. */
export type ChatSummary = Pick<Thread, "id" | "title" | "updatedAt">;

const summarize = (threads: Thread[]): ChatSummary[] =>
  threads.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));

/**
 * A vault's chats, newest first, kept current: the chat store announces every
 * change in this tab, and the browser's storage event covers other tabs.
 */
export function useRecentChats(driveId: string | null | undefined): ChatSummary[] {
  const [chats, setChats] = useState<ChatSummary[]>(() => (driveId ? summarize(loadThreads(driveId)) : []));
  useEffect(() => {
    if (!driveId) {
      setChats([]);
      return;
    }
    const read = () => setChats(summarize(loadThreads(driveId)));
    read();
    const onChange = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === driveId) read();
    };
    window.addEventListener(THREADS_CHANGED, onChange);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(THREADS_CHANGED, onChange);
      window.removeEventListener("storage", read);
    };
  }, [driveId]);
  return chats;
}
