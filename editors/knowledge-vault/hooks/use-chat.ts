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
import { classifyFailure, type Failure } from "../lib/chat/failure.js";
import {
  deleteThread,
  loadThreads,
  readCurrentThreadId,
  saveThread,
  threadTitleFrom,
  writeCurrentThreadId,
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
  /** Free models OpenRouter may fail over to inside each request. */
  fallbackModels?: string[];
  /** Display names for the router trail entry; defaults to the raw id. */
  modelName?: (id: string) => string;
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
  /** The model that produced the final answer; differs from `model` after a fallback. */
  answeredBy: string | null;
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
  let answeredBy: string | null = null;
  let routed = false;

  for (;;) {
    iterations++;
    const forceAnswer = iterations > MAX_ITERATIONS;
    const result = await deps.streamChat({
      key: o.key,
      model: o.model,
      fallbackModels: o.fallbackModels,
      messages,
      tools: VAULT_TOOLS,
      toolChoice: forceAnswer ? "none" : "auto",
      signal: o.signal,
      onText: o.onText,
    });

    if (result.model) answeredBy = result.model;
    // Say so once when OpenRouter answered with a fallback: the user should
    // know which model they are talking to, and why it changed.
    if (!routed && result.model && result.model !== o.model) {
      routed = true;
      const name = o.modelName ?? ((id: string) => id);
      const entry: TrailEntry = {
        tool: "router",
        summary: `answered by ${name(result.model)} — ${name(o.model)} was unavailable`,
        ok: true,
        data: { requested: o.model, answeredBy: result.model },
      };
      trail.push(entry);
      o.onTrail?.(entry);
    }

    const wantsTools =
      !forceAnswer &&
      result.finishReason === "tool_calls" &&
      result.toolCalls.length > 0;
    if (!wantsTools)
      return { text: result.text, trail, iterations, answeredBy };

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

const CITATION_RE = /\[\[([^\]]+?)\]\]/g;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a tool told us about a document: enough to label and open it. */
type KnownDocument = { documentId: string; title: string; documentType: string | null };

/**
 * Walk tool results collecting every `{documentId, title[, documentType]}`
 * seen — every tool follows that contract for every kind of document, so
 * a project, a source or a tension is picked up exactly like a note.
 */
export function collectKnownDocuments(trail: TrailEntry[]): Map<string, KnownDocument> {
  const known = new Map<string, KnownDocument>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (typeof obj.documentId === "string") {
      const prev = known.get(obj.documentId);
      const title = typeof obj.title === "string" && obj.title ? obj.title : null;
      const documentType =
        typeof obj.documentType === "string" ? obj.documentType : null;
      if (!prev) {
        if (title) {
          known.set(obj.documentId, { documentId: obj.documentId, title, documentType });
        }
      } else if (!prev.documentType && documentType) {
        prev.documentType = documentType;
      }
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };
  for (const e of trail) if (e.ok) visit(e.data, 0);
  return known;
}

/** Case- and punctuation-insensitive key for matching a label to a title. */
function aliasKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const MIN_EXACT_LABEL = 3;
const MIN_PREFIX_LABEL = 6;

/**
 * The model sometimes cites by label instead of id — `[[AuthScope]]` for a
 * project titled "Auth Scope Enforcement". A label that names exactly one
 * known document — its whole title, or a unique prefix of it at least six
 * characters long — resolves to that document; anything else resolves to
 * nothing, because a chip that navigates to a slug is a door that never opens.
 */
function resolveLabel(label: string, known: Map<string, KnownDocument>): KnownDocument | null {
  const key = aliasKey(label);
  if (key.length < MIN_EXACT_LABEL) return null;
  let exact: KnownDocument | null = null;
  const prefixed: KnownDocument[] = [];
  for (const doc of known.values()) {
    const k = aliasKey(doc.title);
    if (k === key) {
      exact = doc;
      break;
    }
    if (key.length >= MIN_PREFIX_LABEL && k.startsWith(key)) prefixed.push(doc);
  }
  if (exact) return exact;
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * Resolve every `[[…]]` marker in an answer. A UUID stands for itself, with
 * the title the trail (or an earlier turn) knew for it — an unseen UUID is
 * still a door the user can try. A non-UUID label is matched to a known
 * document's title; when that fails the marker is dropped from the text so
 * the reader is not handed a link that cannot open.
 *
 * Returns the citations in order of first mention and the text with every
 * kept marker rewritten to its `[[documentId]]` form.
 */
export function resolveCitations(
  text: string,
  trail: TrailEntry[],
  priorCitations: Citation[] = [],
): { text: string; citations: Citation[] } {
  const known = collectKnownDocuments(trail);
  for (const c of priorCitations) {
    if (!known.has(c.documentId)) {
      known.set(c.documentId, {
        documentId: c.documentId,
        title: c.title,
        documentType: c.documentType ?? null,
      });
    }
  }
  const order: string[] = [];
  const byId = new Map<string, Citation>();
  const rewritten = text.replace(CITATION_RE, (_m, raw: string) => {
    const label = raw.trim();
    let doc: KnownDocument | null;
    if (UUID_RE.test(label)) {
      doc = known.get(label) ?? { documentId: label, title: label, documentType: null };
    } else {
      doc = known.get(label) ?? resolveLabel(label, known);
    }
    if (!doc) return "";
    if (!byId.has(doc.documentId)) {
      order.push(doc.documentId);
      byId.set(doc.documentId, {
        documentId: doc.documentId,
        title: doc.title,
        documentType: doc.documentType,
      });
    }
    return `[[${doc.documentId}]]`;
  });
  return {
    text: rewritten,
    citations: order.map((id) => byId.get(id)!),
  };
}

/** Citations only — see `resolveCitations` for the text rewrite. */
export function extractCitations(
  text: string,
  trail: TrailEntry[],
  priorCitations: Citation[] = [],
): Citation[] {
  return resolveCitations(text, trail, priorCitations).citations;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export interface UseChatOptions {
  driveId: string | undefined;
  key: string | null;
  model: string;
  fallbackModels?: string[];
  modelName?: (id: string) => string;
  systemPrompt: string;
}

/** A failed turn, with the model it was addressed to so the UI can act. */
export interface ChatFailure extends Failure {
  model: string;
}

export interface UseChat {
  threads: Thread[];
  thread: Thread | null;
  messages: StoredMessage[];
  streamingText: string;
  trail: TrailEntry[];
  isStreaming: boolean;
  failure: ChatFailure | null;
  /** Set when the last turn was answered by a fallback: the model that was skipped. */
  routedFrom: string | null;
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
  const { driveId, key, model, fallbackModels, modelName, systemPrompt } = o;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [routedFrom, setRoutedFrom] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Mirrors `streamingText` so the abort path can read the partial answer
  // synchronously — a setState callback would only run on the next render.
  const streamedRef = useRef("");

  // Load history when the drive changes; drop any in-flight stream. Reopen
  // the thread that was current in this tab, so leaving the chat to read a
  // cited note and coming back lands in the same conversation.
  useEffect(() => {
    abortRef.current?.abort();
    setStreamingText("");
    setTrail([]);
    setFailure(null);
    const loaded = driveId ? loadThreads(driveId) : [];
    setThreads(loaded);
    const currentId = driveId ? readCurrentThreadId(driveId) : null;
    setThread(loaded.find((t) => t.id === currentId) ?? null);
  }, [driveId]);

  // The pointer to the open thread is written by the actions below, never
  // from an effect: an effect's closure can lag one render behind, and under
  // React StrictMode's mount/unmount/mount it would clear the pointer the
  // restore above has just read.

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
      writeCurrentThreadId(driveId, withUser.id);
      persist(withUser);

      setStreamingText("");
      streamedRef.current = "";
      setTrail([]);
      setFailure(null);
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
      setRoutedFrom(null);
      try {
        const r = await runAgentLoop({
          key,
          model,
          fallbackModels,
          modelName,
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
        if (r.answeredBy && r.answeredBy !== model) setRoutedFrom(model);
      } catch (err) {
        if (ctrl.signal.aborted) {
          // Keep whatever streamed; the user asked for it to stop.
          finalText = streamedRef.current;
        } else {
          setFailure({ ...classifyFailure(err), model });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }

      // Persist the turn if anything came back — a partial answer after Stop,
      // or an answer that was only tool activity, is still worth keeping.
      if (finalText || collected.length > 0) {
        // Earlier turns' citations let a later "[[id]]" keep its title (and
        // let a by-name citation resolve) without re-running the tools.
        const prior = withUser.messages.flatMap((m) => m.citations ?? []);
        const resolved = resolveCitations(finalText, collected, prior);
        const assistant: StoredMessage = {
          role: "assistant",
          content: resolved.text,
          citations: resolved.citations,
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
    [
      driveId,
      key,
      model,
      fallbackModels,
      modelName,
      systemPrompt,
      thread,
      isStreaming,
      persist,
    ],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThread(null);
    if (driveId) writeCurrentThreadId(driveId, null);
    setStreamingText("");
    setTrail([]);
    setFailure(null);
  }, [driveId]);

  const openThread = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (!t) return;
      abortRef.current?.abort();
      setThread(t);
      if (driveId) writeCurrentThreadId(driveId, id);
      setStreamingText("");
      setTrail([]);
      setFailure(null);
    },
    [threads, driveId],
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
    failure,
    routedFrom,
    send,
    stop,
    newThread,
    openThread,
    removeThread,
  };
}
