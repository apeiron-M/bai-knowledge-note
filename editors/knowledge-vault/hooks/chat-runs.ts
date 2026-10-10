import type { Thread } from "../lib/chat/chat-storage.js";
import type { ChatFailure, TrailEntry } from "./use-chat.js";

/**
 * A vault's chat answer in progress, kept outside the chat screen. Switching views unmounts the
 * screen, but the answer keeps arriving here — the text so far, the tool steps, a failure — and the
 * screen shows it again, still streaming, when it mounts. One run per vault (drive).
 */
export interface ChatRun {
  /** The conversation being answered: with the user's turn while streaming, with the answer after. */
  thread: Thread;
  streamingText: string;
  trail: TrailEntry[];
  isStreaming: boolean;
  failure: ChatFailure | null;
  /** Set when the turn was answered by a fallback: the model that was skipped. */
  routedFrom: string | null;
}

const runs = new Map<string, ChatRun>();
const owners = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();

function notify(driveId: string): void {
  for (const listener of listeners.get(driveId) ?? []) listener();
}

/** The vault's run, the same object until it changes (a React external-store snapshot). */
export function chatRun(driveId: string | null | undefined): ChatRun | undefined {
  return driveId ? runs.get(driveId) : undefined;
}

export function subscribeChatRun(driveId: string | null | undefined, listener: () => void): () => void {
  if (!driveId) return () => {};
  let set = listeners.get(driveId);
  if (!set) listeners.set(driveId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** A new answer for this vault: any answer still running in it stops first. */
export function startChatRun(driveId: string, thread: Thread): AbortController {
  owners.get(driveId)?.abort();
  const controller = new AbortController();
  owners.set(driveId, controller);
  runs.set(driveId, { thread, streamingText: "", trail: [], isStreaming: true, failure: null, routedFrom: null });
  notify(driveId);
  return controller;
}

/** Changes the run while it is still the vault's current one: a replaced run's late steps are dropped. */
export function updateChatRun(driveId: string, controller: AbortController, patch: Partial<ChatRun> | ((run: ChatRun) => Partial<ChatRun>)): void {
  const run = runs.get(driveId);
  if (!run || owners.get(driveId) !== controller) return;
  runs.set(driveId, { ...run, ...(typeof patch === "function" ? patch(run) : patch) });
  notify(driveId);
}

/** The answer is over (finished, failed or stopped) and its last update made: the run stays to be shown. */
export function endChatRun(driveId: string, controller: AbortController): void {
  if (owners.get(driveId) === controller) owners.delete(driveId);
}

export function stopChatRun(driveId: string | null | undefined): void {
  if (driveId) owners.get(driveId)?.abort();
}

/** Forgets the vault's run (its conversation was deleted). */
export function clearChatRun(driveId: string): void {
  owners.get(driveId)?.abort();
  owners.delete(driveId);
  runs.delete(driveId);
  notify(driveId);
}

/** What the open conversation shows of the vault's run: the run, when it answers this conversation. */
export function runFor(run: ChatRun | undefined, threadId: string | undefined): ChatRun | undefined {
  return run && threadId !== undefined && run.thread.id === threadId ? run : undefined;
}
