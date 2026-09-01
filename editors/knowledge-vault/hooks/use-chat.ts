/**
 * The chat's agent loop, and the React hook that drives it.
 *
 * `runAgentLoop` is a pure async function with injected dependencies so the
 * loop's behaviour — tool dispatch, failure handling, the iteration cap — is
 * tested without React or a network. `useChat` wraps it with state, an abort
 * controller, and thread persistence.
 *
 * The loop mirrors how the Claude plugin works against the same vault: the
 * model asks for a tool, the tool runs locally against Switchboard, the
 * result goes back as a `tool` message, repeat until the model answers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  streamChat as realStreamChat,
  type ChatMessage,
  type ToolCall,
} from "../lib/chat/openrouter-client.js";
import {
  VAULT_TOOLS,
  executeTool as realExecuteTool,
} from "../lib/chat/vault-tools.js";
import {
  deleteThread,
  loadThreads,
  saveThread,
  threadTitleFrom,
  type Citation,
  type StoredMessage,
  type Thread,
} from "../lib/chat/chat-storage.js";

/**
 * Rounds of tool calls before the loop forces an answer. Six is enough for
 * search → read → widen → read → link → read; more than that on a paid API
 * is a runaway-cost bug, not diligence.
 */
export const MAX_ITERATIONS = 6;

export interface TrailEntry {
  tool: string;
  summary: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface LoopDeps {
  streamChat: typeof realStreamChat;
  executeTool: typeof realExecuteTool;
}

export interface LoopOptions {
  key: string;
  model: string;
  driveId: string;
  messages: ChatMessage[];
  onText?: (delta: string) => void;
  onTrail?: (entry: TrailEntry) => void;
  signal?: AbortSignal;
  deps?: LoopDeps;
}

export interface LoopResult {
  text: string;
  trail: TrailEntry[];
  iterations: number;
}

function parseArgs(call: ToolCall): Record<string, unknown> | null {
  try {
    const parsed: unknown = call.function.arguments.trim()
      ? JSON.parse(call.function.arguments)
      : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function runAgentLoop(o: LoopOptions): Promise<LoopResult> {
  const deps: LoopDeps = o.deps ?? {
    streamChat: realStreamChat,
    executeTool: realExecuteTool,
  };
  const messages: ChatMessage[] = [...o.messages];
  const trail: TrailEntry[] = [];
  let iterations = 0;

  for (;;) {
    iterations++;
    const forceAnswer = iterations > MAX_ITERATIONS;
    const result = await deps.streamChat({
      key: o.key,
      model: o.model,
      messages,
      tools: VAULT_TOOLS,
      toolChoice: forceAnswer ? "none" : "auto",
      signal: o.signal,
      onText: o.onText,
    });

    const wantsTools =
      !forceAnswer &&
      result.finishReason === "tool_calls" &&
      result.toolCalls.length > 0;
    if (!wantsTools) return { text: result.text, trail, iterations };

    // The assistant turn that requested the tools must precede the results,
    // or the provider rejects the transcript.
    messages.push({
      role: "assistant",
      content: result.text,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call);
      let entry: TrailEntry;
      let content: string;

      if (!args) {
        entry = {
          tool: name,
          summary: `${name}: malformed arguments`,
          ok: false,
          error: "arguments were not a JSON object",
        };
        content = JSON.stringify({ error: entry.error });
      } else {
        const r = await deps.executeTool(name, args, { driveId: o.driveId });
        if (r.ok) {
          entry = { tool: name, summary: r.summary, ok: true, data: r.data };
          content = JSON.stringify(r.data);
        } else {
          entry = {
            tool: name,
            summary: `${name}: ${r.error}`,
            ok: false,
            error: r.error,
          };
          content = JSON.stringify({ error: r.error });
        }
      }

      trail.push(entry);
      o.onTrail?.(entry);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Citations                                                         */
/* ------------------------------------------------------------------ */

const CITATION_RE = /\[\[([^\]\s]+)\]\]/g;

/** Walk tool results collecting every `{documentId, title}` pair seen. */
function collectTitles(trail: TrailEntry[]): Map<string, string> {
  const titles = new Map<string, string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (typeof obj.documentId === "string" && typeof obj.title === "string") {
      if (!titles.has(obj.documentId)) titles.set(obj.documentId, obj.title);
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };
  for (const e of trail) if (e.ok) visit(e.data, 0);
  return titles;
}

/**
 * Resolve `[[documentId]]` markers in the answer to citation stubs, in order
 * of first mention. An id the trail never saw keeps a fallback title rather
 * than vanishing — a dangling citation is still a door the user can try.
 */
export function extractCitations(
  text: string,
  trail: TrailEntry[],
): Citation[] {
  const titles = collectTitles(trail);
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ documentId: id, title: titles.get(id) ?? id });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export interface UseChatOptions {
  driveId: string | undefined;
  key: string | null;
  model: string;
  systemPrompt: string;
}

export interface UseChat {
  threads: Thread[];
  thread: Thread | null;
  messages: StoredMessage[];
  streamingText: string;
  trail: TrailEntry[];
  isStreaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  newThread: () => void;
  openThread: (id: string) => void;
  removeThread: (id: string) => void;
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useChat(o: UseChatOptions): UseChat {
  const { driveId, key, model, systemPrompt } = o;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Mirrors `streamingText` so the abort path can read the partial answer
  // synchronously — a setState callback would only run on the next render.
  const streamedRef = useRef("");

  // Load history when the drive changes; drop any in-flight stream.
  useEffect(() => {
    abortRef.current?.abort();
    setThread(null);
    setStreamingText("");
    setTrail([]);
    setError(null);
    setThreads(driveId ? loadThreads(driveId) : []);
  }, [driveId]);

  const persist = useCallback(
    (t: Thread) => {
      if (!driveId) return;
      saveThread(driveId, t);
      setThreads(loadThreads(driveId));
    },
    [driveId],
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !driveId || !key || isStreaming) return;

      const now = new Date().toISOString();
      const current: Thread = thread ?? {
        id: newId(),
        title: threadTitleFrom(content),
        updatedAt: now,
        messages: [],
      };
      const withUser: Thread = {
        ...current,
        updatedAt: now,
        messages: [...current.messages, { role: "user", content }],
      };
      setThread(withUser);
      persist(withUser);

      setStreamingText("");
      streamedRef.current = "";
      setTrail([]);
      setError(null);
      setIsStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...withUser.messages.map<ChatMessage>((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      let finalText = "";
      const collected: TrailEntry[] = [];
      try {
        const r = await runAgentLoop({
          key,
          model,
          driveId,
          messages: history,
          signal: ctrl.signal,
          onText: (d) => {
            streamedRef.current += d;
            setStreamingText(streamedRef.current);
          },
          onTrail: (e) => {
            collected.push(e);
            setTrail((t) => [...t, e]);
          },
        });
        finalText = r.text;
      } catch (err) {
        if (ctrl.signal.aborted) {
          // Keep whatever streamed; the user asked for it to stop.
          finalText = streamedRef.current;
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }

      // Persist the turn if anything came back — a partial answer after Stop,
      // or an answer that was only tool activity, is still worth keeping.
      if (finalText || collected.length > 0) {
        const assistant: StoredMessage = {
          role: "assistant",
          content: finalText,
          citations: extractCitations(finalText, collected),
        };
        const done: Thread = {
          ...withUser,
          updatedAt: new Date().toISOString(),
          messages: [...withUser.messages, assistant],
        };
        setThread(done);
        persist(done);
        setStreamingText("");
      }
    },
    [driveId, key, model, systemPrompt, thread, isStreaming, persist],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThread(null);
    setStreamingText("");
    setTrail([]);
    setError(null);
  }, []);

  const openThread = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (!t) return;
      abortRef.current?.abort();
      setThread(t);
      setStreamingText("");
      setTrail([]);
      setError(null);
    },
    [threads],
  );

  const removeThread = useCallback(
    (id: string) => {
      if (!driveId) return;
      deleteThread(driveId, id);
      setThreads(loadThreads(driveId));
      if (thread?.id === id) setThread(null);
    },
    [driveId, thread],
  );

  const messages = useMemo(() => thread?.messages ?? [], [thread]);

  return {
    threads,
    thread,
    messages,
    streamingText,
    trail,
    isStreaming,
    error,
    send,
    stop,
    newThread,
    openThread,
    removeThread,
  };
}
