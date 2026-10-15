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
import type { ChatEndpoint } from "../lib/chat/provider.js";
import { collectEvidence, parseMarker } from "../lib/chat/evidence.js";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chatRun, clearChatRun, endChatRun, runFor, startChatRun, stopChatRun, subscribeChatRun, updateChatRun } from "./chat-runs.js";
import {
  ProviderError,
  streamChat as realStreamChat,
  type ChatMessage,
  type ToolCall,
  type ToolSchema,
} from "../lib/chat/completions-client.js";
import {
  CHAT_TOOLS,
  executeTool as realExecuteTool,
  resetVaultDocumentListing,
} from "../lib/chat/vault-tools.js";
import { classifyFailure, type Failure } from "../lib/chat/failure.js";
import { outcomeNote } from "../lib/chat/proposal-outcomes.js";
import type { WorkProposal } from "../lib/chat/work-changes.js";
import {
  hasToolCallMarkup,
  parseTextToolCalls,
  stripToolCallMarkup,
} from "../lib/chat/text-tool-calls.js";
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
 * Rounds of tool calls before the loop forces an answer. Ten covers
 * search → read × several → widen → read for a model that reads one note
 * per round; more than that on a paid API is a runaway-cost bug, not
 * diligence. When the cap is hit the model is TOLD to answer (see
 * `ANSWER_NOW`) rather than merely denied tools — a model that is denied
 * tools mid-investigation tends to write the calls it wanted as text and
 * answer nothing.
 */
export const MAX_ITERATIONS = 10;

/** The instruction that ends the investigation when the round cap is hit. */
export const ANSWER_NOW =
  "The tool budget for this answer is used up and no further tool calls will run. " +
  "Write the final answer now from the results you already have, citing each document as [[documentId]]. " +
  "If something important is still unread, say so in one sentence instead of calling a tool.";

/** One more nudge when a forced answer still contains nothing but tool calls. */
const ANSWER_NOW_RETRY =
  "That reply contained tool calls written as text; they were not run and were removed. " +
  "Answer in prose now, from the results above, with [[documentId]] citations.";

/**
 * The one nudge a final answer gets when it was built on documents the tools
 * surfaced yet cites none of them. A model that reads three notes and then
 * answers in fluent prose drops the markers more often than it keeps them;
 * a single repair round with the ids spelled out fixes most of those. One is
 * the cap — a second miss is shown as written, and the documents it read are
 * still listed under the answer as consulted.
 */
export const CITE_NOW = (documents: string): string =>
  "Your answer draws on documents you read this turn but cites none of them. " +
  "Rewrite the same answer with a [[documentId]] marker directly after each claim it supports — keep the content, add nothing new, call no tools. " +
  "If the vault did not answer the question, keep saying so and cite the closest documents as leads. The documents you read:\n" +
  documents;

/** How many surfaced documents the repair nudge lists by id. */
const CITE_NOW_MAX_DOCUMENTS = 12;

/**
 * The nudge when a reply carried tool calls written in a form none of the
 * templates could read (see text-tool-calls.ts). Local servers that do not
 * parse their model's tool template hand it to us as prose; the model is told
 * the one text form that always works and asked again. Once — a second miss
 * is stripped from the answer and noted in the trail.
 */
/**
 * Questions whose answer is only true at the moment it is asked. A model
 * that has answered one of these before will happily repeat itself from the
 * transcript — which is wrong the moment anyone edits the vault, and someone
 * always has. Deliberately narrow: it gates a nudge, not an accusation.
 */
const FRESHNESS_RE =
  /\b(latest|last|newest|recent(ly)?|current(ly)?|now|today|yesterday|this (week|month)|up[- ]to[- ]date|changed?|updated?|who (is|are|has|have|did|made|edits?|edited|wrote|works?|working))\b/i;

/**
 * True when a turn answered a "what is true right now" question without
 * consulting the vault at all. Tool failures count as looking: the model
 * tried, and a second nudge would not help.
 */
export function answeredWithoutLooking(
  userText: string,
  trail: TrailEntry[],
): boolean {
  const consulted = trail.some((e) => e.tool !== "compat" && e.tool !== "router");
  return !consulted && FRESHNESS_RE.test(userText);
}

/**
 * An answer that reports the vault as unreachable. Worth detecting because
 * the vault being down is a claim like any other: it has to have happened.
 * A model that produced one of these earlier in a conversation will produce
 * more — the transcript teaches it that this is what answers look like here
 * — and the reader is told the vault is broken when it is not.
 */
const OUTAGE_CLAIM_RE =
  /\b(?:not responding|unavailable|inaccessible|offline|temporary outage|system-wide issue)\b|\b(?:cannot|can(?:'|’)t|could\s?not|couldn(?:'|’)t|unable to)\b[^.]{0,80}\b(?:access|reach|retrieve|read|query|check)\b/i;

/**
 * True when an answer blames the vault for something that did not happen:
 * it reports an outage while every tool this turn either succeeded or was
 * never called. A tool that genuinely failed leaves its error in the trail,
 * and then the claim is fair.
 */
export function claimsAnOutageThatDidNotHappen(
  text: string,
  trail: TrailEntry[],
): boolean {
  if (!OUTAGE_CLAIM_RE.test(text)) return false;
  return !trail.some((e) => !e.ok);
}

/** The nudge for an answer that reports a failure nothing recorded. */
export const NO_OUTAGE =
  "Your answer says the vault could not be read, but no tool reported an error this turn. " +
  "The vault is there. Call the tool you need now — list_projects for projects, recent_changes for what changed, search_vault for anything else — and answer from what it returns. " +
  "If a call does fail, quote the error it gave you instead of describing an outage.";

/** The nudge for an answer given from memory rather than from the vault. */
export const CHECK_NOW =
  "You answered without calling any tool, and the question is about what is true in the vault right now. " +
  "The vault changes between messages, and an earlier answer in this conversation is not evidence about the present. " +
  "Check now — recent_changes for what changed, document_history for who changed it, vault_editors for who works here — and answer from what the tools return.";

export const TOOL_TEXT_RETRY =
  "Your reply contained tool calls written as text in a format this interface cannot run, so nothing ran and the user saw the raw markup. " +
  "Call tools through the function-calling interface. If your runtime cannot, write each call on its own line exactly as " +
  '<tool_call>{"name": "<tool>", "arguments": {<arguments>}}</tool_call> — JSON, nothing else inside the tags. ' +
  "A documentId is the full UUID string exactly as a result gave it, never a number and never wrapped in brackets. Continue now.";

/* ------------------------------------------------------------------ */
/*  Answers that point instead of answering                           */
/* ------------------------------------------------------------------ */

/**
 * Wording that sends the reader to documents instead of telling them what the
 * documents say: "read the note…", "start with the map…", "the note explains
 * how…", "follow the notes in this order". One or two can be ordinary prose;
 * an answer made of them is a reading list — which the person did not ask for:
 * they asked the chat so they would not have to read, and the citations are
 * how they check a claim.
 */
const DESCRIBING_VERBS =
  "explains|describes|covers|discusses|details|outlines|shows|frames|gives|lists|introduces|highlights|walks|argues|refines|lays out|indicates|notes that|states|emphasi[sz]es|warns";
const POINTING_RES = [
  /\b(?:read|reading|start(?:ing)? with|begin with|look at|check out|explore|dig into|drill into|refer to|consult|follow|open|examine|revisit|study)\b[^.\n]{0,60}?\b(?:notes?|maps?(?: of content)?|MoCs?|documents?|resources?)\b/gi,
  // "The note “…a title of any length…” explains…" — the title sits between the two.
  new RegExp(
    `\\b(?:the|this|that|each|a|companion)\\s+(?:(?:concept|pattern|architecture|observation|decision|companion|knowledge)\\s+)?(?:note|map|MoC|document|observation)\\b[^\\n]{0,220}?\\b(?:${DESCRIBING_VERBS})\\b`,
    "gi",
  ),
  // A line that is a quoted title and what it "shows": — *“Title”* – shows why…
  new RegExp(`^\\s*(?:[-*•]|\\d+[.)])?\\s*\\*?[“"][^”"\\n]{12,}[”"]\\*?\\s*[–—-]\\s*(?:${DESCRIBING_VERBS})\\b`, "gim"),
  /\b(?:learning path|reading (?:order|list)|where to read|entry point)\b/gi,
];
/** How many of those make an answer a reading list. */
export const POINTING_THRESHOLD = 3;

export function pointsInsteadOfAnswering(text: string): boolean {
  let hits = 0;
  for (const re of POINTING_RES) hits += text.match(re)?.length ?? 0;
  return hits >= POINTING_THRESHOLD;
}

/** A question that does ask which documents to read: then a list is the answer. */
const ASKS_FOR_DOCUMENTS_RE =
  /\b(?:which|what)\s+(?:notes|documents|sources|maps)\b|\b(?:notes|documents|sources)\s+(?:should|could|can|do)\s+i\b|\blist (?:the |all |every )?(?:notes|documents|sources|maps)\b|\bwhere (?:can|do|should) i (?:read|find)\b|\breading list\b/i;

export function asksForDocuments(question: string): boolean {
  return ASKS_FOR_DOCUMENTS_RE.test(question);
}

/** Tools whose result is one or more documents read in full — a source consulted. */
const FULL_READ_TOOLS = new Set(["read_note", "read_notes", "read_document"]);

/** The documents one trail entry handed over in full. */
function readIn(e: TrailEntry): { documentId?: unknown; title?: unknown; documentType?: unknown }[] {
  if (!e.ok || !e.data || typeof e.data !== "object") return [];
  if (e.tool === "read_notes") {
    const notes = (e.data as { notes?: unknown }).notes;
    return Array.isArray(notes) ? (notes as { documentId?: unknown }[]) : [];
  }
  if (FULL_READ_TOOLS.has(e.tool)) return [e.data as { documentId?: unknown }];
  // Search hands over the text of its top hits: those were read too.
  if (e.tool === "search_vault") {
    const hits = (e.data as { hits?: unknown }).hits;
    return Array.isArray(hits)
      ? (hits as { documentId?: unknown; content?: unknown }[]).filter((h) => typeof h.content === "string")
      : [];
  }
  return [];
}

/** Every document whose text the model has seen this turn. */
export function documentsRead(trail: readonly TrailEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of trail) {
    for (const d of readIn(e)) if (typeof d.documentId === "string") ids.add(d.documentId);
  }
  return ids;
}

/** Kinds whose citation stands for a claim — and so for what the note says. */
const CLAIM_KINDS = new Set(["bai/knowledge-note", "bai/research-claim"]);

/**
 * Notes an answer cites without having read them: it can only repeat their
 * titles, and a sentence it hangs one on may say something the note does not.
 * Maps, contradictions, projects and sources are left out — citing a map for
 * how the vault is organised needs no reading.
 */
export function unreadCitations(text: string, trail: readonly TrailEntry[]): KnownDocument[] {
  const known = collectKnownDocuments([...trail]);
  const read = documentsRead(trail);
  const out: KnownDocument[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]#]+)(?:#[^\]]*)?\]\]/g)) {
    const id = m[1].trim();
    if (seen.has(id) || read.has(id)) continue;
    seen.add(id);
    const doc = known.get(id);
    if (doc && (doc.documentType === null || CLAIM_KINDS.has(doc.documentType))) out.push(doc);
  }
  return out;
}

/** How many unread notes, and what share of the cited ones, send an answer back to read. */
const UNREAD_MIN = 3;
/** How many of them the loop reads for the model: one read_notes call. */
const READ_FOR_MODEL = 8;
/** Rewrites an answer may be sent back for: once to read, once more if it still points. */
const SUBSTANCE_ROUNDS = 2;

/**
 * The one nudge an answer gets when it points instead of answering, or rests
 * on notes it never read. Tools stay on: reading is the point.
 */
export function ANSWER_FROM_VAULT(o: {
  pointing: boolean;
  unread: KnownDocument[];
  /** The draft being sent back, so the rewrite keeps what was right in it. */
  draft?: string;
  /** True when the loop has already read the notes and their text is above. */
  readForYou?: boolean;
}): string {
  const list = o.unread
    .slice(0, 12)
    .map((d) => `- [[${d.documentId}]] ${d.title}`)
    .join("\n");
  const why = o.pointing
    ? "Your draft points the reader to notes instead of telling them what the notes say. They asked you so they would not have to read the notes; the citations are how they check a claim. "
    : "Your draft cites notes you had not read, so it could only repeat their titles, and a sentence you hang one on may say what the note does not. ";
  const reading = o.readForYou
    ? "The notes it leans on have been read for you: their full text is in the read_notes result just above. "
    : o.unread.length > 0
      ? `Read these first — read_notes reads them all at once:\n${list}\n`
      : "";
  return (
    why +
    reading +
    "Rewrite the answer from that content: the facts, mechanisms, figures, trade-offs and conclusions the notes hold, each claim followed by its [[documentId]]. " +
    "Do not tell the reader to read, open, start with, explore or follow anything, and do not describe what a note covers — say what it says. " +
    "Keep the shape the question asked for: a plan stays a plan, each step explained from the notes." +
    (o.draft ? `\n\nYour draft was:\n---\n${o.draft}\n---` : "")
  );
}

/** Whether a final draft goes back to read and answer from the vault (see `ANSWER_FROM_VAULT`). */
export function needsSubstance(
  text: string,
  trail: readonly TrailEntry[],
  question: string,
): { pointing: boolean; unread: KnownDocument[] } | null {
  if (!text.trim() || asksForDocuments(question)) return null;
  const pointing = pointsInsteadOfAnswering(text);
  const unread = unreadCitations(text, trail);
  const cited = new Set([...text.matchAll(/\[\[([^\]#]+)/g)].map((m) => m[1].trim())).size;
  const leansOnUnread = unread.length >= UNREAD_MIN && unread.length * 2 >= cited;
  return pointing || leansOnUnread ? { pointing, unread } : null;
}

/**
 * True when an answer should be sent back for citations: at least one tool
 * result named a document (so there is something to cite) and the text
 * resolves to no citation at all — not a `[[…]]`, not a bracketed title,
 * not a Sources section.
 */
export function needsCitationRepair(
  text: string,
  trail: TrailEntry[],
  priorCitations: Citation[] = [],
): boolean {
  if (!text.trim()) return false;
  if (collectKnownDocuments(trail).size === 0 && priorCitations.length === 0) return false;
  return resolveCitations(text, trail, priorCitations).citations.length === 0;
}

/* ------------------------------------------------------------------ */
/*  Fitting every model: brief failures and full context windows       */
/* ------------------------------------------------------------------ */

/**
 * HTTP statuses that mean the model's service failed for a moment, not that
 * the request was wrong: a gateway that timed out, a server briefly down or
 * overloaded. ChatGPT answers 504 when it is slow; Cloudflare in front of a
 * provider answers 52x. Asking again usually works — and the tool calls made
 * so far are kept, so a long answer does not start over.
 *
 * 503 is not here: the desktop app's gateway already asks again twice on a
 * 503, for every provider and for ChatGPT, and a third layer of retries would
 * turn one outage into nine requests.
 */
const TRANSIENT_STATUSES = new Set([408, 502, 504, 520, 521, 522, 523, 524, 529]);
/**
 * The slow ones: each already cost the reader a long wait (Cloudflare gives up
 * after about a hundred seconds), so they are asked again once per answer.
 */
const SLOW_STATUSES = new Set([408, 504, 522, 524]);
/** How many rounds of one answer may be asked again after a quick failure. */
export const TRANSIENT_RETRIES = 2;
/** How many after a slow one. */
export const SLOW_RETRIES = 1;
/** The pause before asking again: long enough for a blip to pass. */
export const RETRY_DELAY_MS = 2000;

export function isTransientFailure(err: unknown): boolean {
  return err instanceof ProviderError && TRANSIENT_STATUSES.has(err.status);
}

/**
 * How each kind of server says a request did not fit its context window:
 * llama.cpp ("exceeds the available context size"), OpenAI and OpenRouter
 * ("maximum context length", context_length_exceeded), Anthropic ("prompt is
 * too long"), Gemini ("input token count … exceeds"), vLLM and others.
 */
const CONTEXT_OVERFLOW_RE =
  /context[ _](?:length|window|size)|maximum context|exceeds? the (?:available )?context|too many (?:input )?tokens|prompt is too long|input is too long|reduce the length|token count[^.]*exceeds|exceed_context_size/i;

export function isContextOverflow(err: unknown): boolean {
  return (
    err instanceof ProviderError &&
    err.status >= 400 &&
    err.status < 600 &&
    CONTEXT_OVERFLOW_RE.test(`${err.providerMessage} ${err.raw}`)
  );
}

/**
 * A ceiling no answer is allowed past, whatever the model: beyond it the
 * request is slow and expensive everywhere and fails outright on most
 * windows. Tokens are estimated, conservatively, at 3.5 characters each.
 */
export const CONTEXT_CEILING_TOKENS = 96_000;
const CHARS_PER_TOKEN = 3.5;
/** At the strongest shortening, the one result kept in full is cut to this. */
export const LAST_RESULT_MAX_CHARS = 24_000;
/** Documents a shortened result still names, so the model can cite or reread them. */
const SHORTENED_DOCUMENTS = 25;

export function estimateTokens(messages: readonly ChatMessage[], tools: readonly ToolSchema[]): number {
  let chars = JSON.stringify(tools).length;
  for (const m of messages) {
    chars += m.content.length + 16;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Every {documentId, title, documentType} a tool result named, first ones first. */
function documentsNamed(data: unknown, limit: number): { documentId: string; title: string; documentType?: string }[] {
  const out: { documentId: string; title: string; documentType?: string }[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.documentId === "string" && typeof o.title === "string" && !seen.has(o.documentId)) {
      seen.add(o.documentId);
      out.push({
        documentId: o.documentId,
        title: o.title,
        ...(typeof o.documentType === "string" ? { documentType: o.documentType } : {}),
      });
    }
    for (const value of Object.values(o)) visit(value, depth + 1);
  };
  visit(data, 0);
  return out;
}

/** A tool result as the model sees it once shortened: what it found, not every field of it. */
export function shortenedResult(entry: Pick<TrailEntry, "summary" | "data">): string {
  const documents = documentsNamed(entry.data, SHORTENED_DOCUMENTS);
  return JSON.stringify({
    shortened:
      "This earlier result was shortened to fit the model's context window. Call the tool again if you need its details.",
    summary: entry.summary,
    ...(documents.length > 0 ? { documents } : {}),
  });
}

/**
 * The transcript at a level of shortening. 0: as it is. 1: every tool result
 * but the latest round's shortened — what the model read earlier it has
 * already used. 2: every tool result but the last one shortened, and that one
 * cut to `LAST_RESULT_MAX_CHARS`. The full results stay in the trail, so
 * citations and evidence are untouched; only what is sent shrinks.
 */
export function fitTranscript(
  messages: readonly ChatMessage[],
  results: ReadonlyMap<string, { round: number; entry: TrailEntry }>,
  level: 0 | 1 | 2,
): ChatMessage[] {
  if (level === 0) return [...messages];
  const tools = messages.filter((m) => m.role === "tool" && m.tool_call_id && results.has(m.tool_call_id));
  const lastId = tools.at(-1)?.tool_call_id;
  const latestRound = Math.max(-1, ...tools.map((m) => results.get(m.tool_call_id!)!.round));
  return messages.map((m) => {
    const info = m.role === "tool" && m.tool_call_id ? results.get(m.tool_call_id) : undefined;
    if (!info) return m;
    const keep = level === 1 ? info.round === latestRound : m.tool_call_id === lastId;
    if (!keep) return { ...m, content: shortenedResult(info.entry) };
    if (level === 2 && m.content.length > LAST_RESULT_MAX_CHARS) {
      return {
        ...m,
        content: JSON.stringify({
          truncated: `Only the first ${LAST_RESULT_MAX_CHARS} of ${m.content.length} characters of this result fit the model's context window.`,
          partial: m.content.slice(0, LAST_RESULT_MAX_CHARS),
        }),
      };
    }
    return m;
  });
}

/** Wait, unless the person stops the answer first. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

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
  endpoint: ChatEndpoint;
  model: string;
  /** Free models OpenRouter may fail over to inside each request. */
  fallbackModels?: string[];
  /** Display names for the router trail entry; defaults to the raw id. */
  modelName?: (id: string) => string;
  driveId: string;
  messages: ChatMessage[];
  /** What the model may call this turn; defaults to the chat's whole set. */
  tools?: ToolSchema[];
  /**
   * What earlier answers in this conversation cited. A follow-up ("make that
   * a plan") is often written from the conversation without a tool call; it
   * still has to cite, and these are the documents it can.
   */
  priorCitations?: Citation[];
  onText?: (delta: string) => void;
  onTrail?: (entry: TrailEntry) => void;
  /** Fires when a new round starts; the UI clears the streamed text of the previous one. */
  onRound?: (iteration: number) => void;
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

  let retriedForcedAnswer = false;
  // The citation repair round: the uncited draft is kept so an empty rewrite
  // falls back to it rather than to an empty bubble, and it happens once.
  let uncitedDraft: string | null = null;
  let repairedCitations = false;
  let toolsOffNextRound = false;
  let retriedToolMarkup = false;
  let retriedStaleAnswer = false;
  let retriedFalseOutage = false;
  // The answer-from-the-vault round: once per answer, and its draft kept in
  // case the rewrite comes back empty.
  let substanceRounds = 0;
  let pointingDraft: string | null = null;
  const tools = o.tools ?? CHAT_TOOLS;
  const asked =
    [...o.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // Each tool result by its call id: the round that produced it, and the
  // trail entry that says what it found — what a shortened copy keeps.
  const results = new Map<string, { round: number; entry: TrailEntry }>();
  let shortening: 0 | 1 | 2 = 0;
  let transientLeft = TRANSIENT_RETRIES;
  let slowLeft = SLOW_RETRIES;
  const record = (entry: TrailEntry) => {
    trail.push(entry);
    o.onTrail?.(entry);
  };
  const shorten = (reason: string) => {
    shortening = (shortening + 1) as 1 | 2;
    const before = messages.filter((m) => m.role === "tool").length;
    const sent = fitTranscript(messages, results, shortening);
    const kept = sent.filter((m, i) => m.role === "tool" && m.content === messages[i].content).length;
    record({
      tool: "compat",
      summary: `${reason} — shortened ${before - kept} earlier tool result${before - kept === 1 ? "" : "s"} and asked again`,
      ok: true,
    });
  };
  /**
   * One request to the model, fitted to it: shortened first when the
   * conversation is past the ceiling, shortened further when the model says
   * its window is full, and asked again after a brief failure of its service
   * — as long as nothing of the reply has reached the reader yet.
   */
  const ask = async (toolsOff: boolean): Promise<Awaited<ReturnType<typeof deps.streamChat>>> => {
    for (;;) {
      while (shortening < 2 && estimateTokens(fitTranscript(messages, results, shortening), tools) > CONTEXT_CEILING_TOKENS) {
        shorten("the conversation passed the size any answer is allowed");
      }
      // An object, not a `let`: the stream's callback sets it, which a
      // narrowed boolean would hide from the check below.
      const reply = { streamed: false };
      try {
        return await deps.streamChat({
          endpoint: o.endpoint,
          model: o.model,
          fallbackModels: o.fallbackModels,
          messages: fitTranscript(messages, results, shortening),
          tools,
          toolChoice: toolsOff ? "none" : "auto",
          signal: o.signal,
          onText: (d) => {
            reply.streamed = true;
            o.onText?.(d);
          },
        });
      } catch (err) {
        if (o.signal?.aborted) throw err;
        if (isContextOverflow(err) && shortening < 2) {
          shorten("the model's context window was full");
          continue;
        }
        const slow = err instanceof ProviderError && SLOW_STATUSES.has(err.status);
        if (isTransientFailure(err) && !reply.streamed && transientLeft > 0 && (!slow || slowLeft > 0)) {
          transientLeft--;
          if (slow) slowLeft--;
          record({
            tool: "compat",
            summary: `${o.endpoint.label} did not answer (HTTP ${(err as ProviderError).status}) — asked again`,
            ok: true,
          });
          await pause(RETRY_DELAY_MS, o.signal);
          continue;
        }
        throw err;
      }
    }
  };

  for (;;) {
    iterations++;
    o.onRound?.(iterations);
    const forceAnswer = iterations > MAX_ITERATIONS;
    if (forceAnswer && iterations === MAX_ITERATIONS + 1) {
      messages.push({ role: "system", content: ANSWER_NOW });
    }
    // Tools are withheld when the budget is spent and during a repair round,
    // which only rewrites what the model already said.
    const toolsOff = forceAnswer || toolsOffNextRound;
    toolsOffNextRound = false;
    const result = await ask(toolsOff);

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

    // Some model/provider routes write their tool calls into the text in
    // their training-time template instead of returning `tool_calls`. Run
    // them anyway: the user asked a question, not for a template.
    let toolCalls = result.toolCalls;
    let text = result.text;
    if (toolCalls.length === 0) {
      const parsed = parseTextToolCalls(result.text, `text-${iterations}`);
      if (parsed.calls.length > 0) {
        text = parsed.text;
        if (!toolsOff) {
          toolCalls = parsed.calls;
          const entry: TrailEntry = {
            tool: "compat",
            summary: `model wrote ${parsed.calls.length} tool call${parsed.calls.length === 1 ? "" : "s"} as text — parsed and run`,
            ok: true,
            data: { calls: parsed.calls.map((c) => c.function.name) },
          };
          trail.push(entry);
          o.onTrail?.(entry);
        }
      }
    }

    const wantsTools = !toolsOff && toolCalls.length > 0;
    if (!wantsTools) {
      // Tool calls in a shape no template reads: ask once for a form that
      // runs; the second time, drop the markup rather than show it.
      if (!toolsOff && toolCalls.length === 0 && hasToolCallMarkup(text)) {
        if (!retriedToolMarkup) {
          retriedToolMarkup = true;
          const entry: TrailEntry = {
            tool: "compat",
            summary: "model wrote tool calls in a format that cannot be run — asked once for a runnable form",
            ok: true,
          };
          trail.push(entry);
          o.onTrail?.(entry);
          messages.push({ role: "assistant", content: result.text });
          messages.push({ role: "system", content: TOOL_TEXT_RETRY });
          continue;
        }
        const entry: TrailEntry = {
          tool: "compat",
          summary: "model kept writing unrunnable tool calls — removed from the answer",
          ok: false,
          error: "tool-call markup in an unrecognised format",
        };
        trail.push(entry);
        o.onTrail?.(entry);
        text = stripToolCallMarkup(text);
      }
      // An answer that reports an outage nothing recorded. Checked before
      // the freshness nudge: this one is wrong whatever was asked.
      if (!toolsOff && !retriedFalseOutage && claimsAnOutageThatDidNotHappen(text, trail)) {
        retriedFalseOutage = true;
        const entry: TrailEntry = {
          tool: "compat",
          summary: "answer reported the vault as unreachable, but nothing failed — asked once to call the tool",
          ok: true,
        };
        trail.push(entry);
        o.onTrail?.(entry);
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "system", content: NO_OUTAGE });
        continue;
      }
      // An answer about the vault's present, given without looking at it.
      // Ask once; a model that still declines has said its piece.
      if (!toolsOff && !retriedStaleAnswer && answeredWithoutLooking(asked, trail)) {
        retriedStaleAnswer = true;
        const entry: TrailEntry = {
          tool: "compat",
          summary: "answered from the conversation without checking the vault — asked once to look",
          ok: true,
        };
        trail.push(entry);
        o.onTrail?.(entry);
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "system", content: CHECK_NOW });
        continue;
      }
      // An answer that points instead of answering, or rests on notes it
      // never read, goes back once to read them — tools on.
      // Twice at most: the second time only for an answer that still points,
      // the notes it leans on having been read the first time.
      const candidate = !toolsOff && substanceRounds < SUBSTANCE_ROUNDS ? needsSubstance(text, trail, asked) : null;
      const thin = candidate && (substanceRounds === 0 || candidate.pointing) ? candidate : null;
      if (thin) {
        substanceRounds++;
        pointingDraft = text;
        record({
          tool: "compat",
          summary: thin.pointing
            ? "answer pointed to notes instead of answering — asked once to answer from them"
            : `answer cited ${thin.unread.length} notes it had not read — read them and asked once for an answer from them`,
          ok: true,
        });
        // The reading is not left to the model: a smaller one told to read
        // first rewrites from the titles anyway. The loop reads the notes the
        // draft leans on, hands their text over as a tool exchange of its own,
        // then asks for the answer from them.
        const toRead = thin.unread.slice(0, READ_FOR_MODEL).map((d) => d.documentId);
        if (toRead.length > 0) {
          const call: ToolCall = {
            id: `vault-read-${iterations}`,
            type: "function",
            function: { name: "read_notes", arguments: JSON.stringify({ documentIds: toRead }) },
          };
          messages.push({ role: "assistant", content: "", tool_calls: [call] });
          const r = await deps.executeTool("read_notes", { documentIds: toRead }, { driveId: o.driveId });
          const entry: TrailEntry = r.ok
            ? { tool: "read_notes", summary: r.summary, ok: true, data: r.data }
            : { tool: "read_notes", summary: `read_notes: ${r.error}`, ok: false, error: r.error };
          record(entry);
          results.set(call.id, { round: iterations, entry });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(r.ok ? (r.forModel ?? r.data) : { error: r.error }) });
        }
        messages.push({ role: "system", content: ANSWER_FROM_VAULT({ ...thin, draft: text, readForYou: toRead.length > 0 }) });
        continue;
      }
      if (pointingDraft !== null && !text.trim()) text = pointingDraft;
      // A repair round that came back empty keeps the uncited draft: an
      // answer without markers beats no answer.
      if (uncitedDraft !== null && !text.trim()) text = uncitedDraft;
      // A forced answer that was nothing but stripped tool calls gets one
      // more chance, with the reason spelled out; after that the user gets
      // an honest note instead of an empty bubble.
      if (forceAnswer && !text.trim()) {
        if (!retriedForcedAnswer) {
          retriedForcedAnswer = true;
          messages.push({ role: "assistant", content: result.text });
          messages.push({ role: "system", content: ANSWER_NOW_RETRY });
          continue;
        }
        const entry: TrailEntry = {
          tool: "compat",
          summary: "model kept writing tool calls instead of answering",
          ok: false,
          error: "no prose in the forced answer",
        };
        trail.push(entry);
        o.onTrail?.(entry);
        text =
          "The model kept trying to read more instead of answering. The documents it read are listed below — try asking again, or pick another model.";
      }
      // An answer that used the tools but cites nothing goes back once, with
      // the ids it could have cited — see `CITE_NOW`.
      if (!repairedCitations && needsCitationRepair(text, trail, o.priorCitations)) {
        repairedCitations = true;
        uncitedDraft = text;
        const fromTools = collectKnownDocuments(trail);
        const known = [
          ...fromTools.values(),
          ...(o.priorCitations ?? [])
            .filter((c) => !fromTools.has(c.documentId))
            .map((c) => ({ documentId: c.documentId, title: c.title, documentType: c.documentType ?? null })),
        ];
        const entry: TrailEntry = {
          tool: "compat",
          summary: "answer cited none of the documents it read — asked once for a cited rewrite",
          ok: true,
          data: { documents: known.length },
        };
        trail.push(entry);
        o.onTrail?.(entry);
        const list = known
          .slice(0, CITE_NOW_MAX_DOCUMENTS)
          .map(
            (d) =>
              `- [[${d.documentId}]] ${d.title}${d.documentType ? ` (${d.documentType})` : ""}`,
          )
          .join("\n");
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "system", content: CITE_NOW(list) });
        toolsOffNextRound = true;
        continue;
      }
      return { text, trail, iterations, answeredBy };
    }

    // The assistant turn that requested the tools must precede the results,
    // or the provider rejects the transcript.
    messages.push({
      role: "assistant",
      content: text,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
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
          content = JSON.stringify(r.forModel ?? r.data);
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
      results.set(call.id, { round: iterations, entry });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Citations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Citation markers as models actually write them. Group 1 is the canonical
 * `[[…]]`; group 2 is a single-bracket `[…]` that is not a markdown link
 * (`[text](url)`) — models drift to that form mid-answer, and a UUID or an
 * exact document title inside single brackets is unmistakably a citation.
 * Footnote numbers, tool names and ordinary bracketed prose fall through
 * the resolver and are left exactly as written.
 */
const UUID_SRC =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CITATION_RE = new RegExp(
  [
    String.raw`\[\[([^\]]+?)\]\]`, // 1: [[…]] canonical
    String.raw`\[([^[\]]+?)\](?!\()`, // 2: […] not a markdown link
    String.raw`\(\s*(${UUID_SRC})\s*\)`, // 3: (uuid) — parenthesised id
    String.raw`(?<![\w[(-])(${UUID_SRC})(?![\w\])-])`, // 4: bare uuid in prose
  ].join("|"),
  "gi",
);

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

const URL_IN_TEXT_RE = /https?:\/\/[^\s)"'<>\]]+/gi;

/**
 * Every URL that appeared in a tool result this turn — a source's url, a
 * deliverable link, a reference in a note body. These are the only URLs the
 * answer may link to: anything else is the model's invention.
 */
export function collectKnownUrls(trail: TrailEntry[]): Set<string> {
  const urls = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v === null) return;
    if (typeof v === "string") {
      for (const m of v.matchAll(URL_IN_TEXT_RE)) urls.add(m[0].replace(/[.,;:]+$/, ""));
      return;
    }
    if (typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    for (const value of Object.values(v as Record<string, unknown>)) visit(value, depth + 1);
  };
  for (const e of trail) if (e.ok) visit(e.data, 0);
  return urls;
}

/** Case- and punctuation-insensitive key for matching a label to a title. */
function aliasKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const MIN_EXACT_LABEL = 3;
const MIN_PREFIX_LABEL = 6;

/** The known document whose title equals this label, ignoring case and punctuation. */
function exactTitle(label: string, known: Map<string, KnownDocument>): KnownDocument | null {
  const key = aliasKey(label);
  if (key.length < MIN_EXACT_LABEL) return null;
  for (const doc of known.values()) if (aliasKey(doc.title) === key) return doc;
  return null;
}

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

/** `[text](url)` — not an image, title attribute tolerated. */
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g;

/**
 * Markdown links in an answer. The vault is the only source of truth the
 * model has, so a URL is kept only when a tool result contained it; every
 * other link is the model's guess at where a document might live. When its
 * text (or a UUID in the URL) names a known document, the link becomes a
 * citation — text kept, marker appended — otherwise the text stays and the
 * invented URL goes.
 */
export function groundMarkdownLinks(
  text: string,
  known: Map<string, KnownDocument>,
  knownUrls: Set<string>,
): string {
  return text.replace(MARKDOWN_LINK_RE, (match: string, label: string, url: string) => {
    const cleanUrl = url.replace(/[.,;:]+$/, "");
    if (knownUrls.has(cleanUrl)) return match;
    const uuid = UUID_ANYWHERE_RE.exec(url)?.[0];
    const doc =
      (uuid ? (known.get(uuid) ?? { documentId: uuid, title: uuid, documentType: null }) : null) ??
      known.get(label.trim()) ??
      resolveLabel(label.trim(), known);
    return doc ? `${label} [[${doc.documentId}]]` : label;
  });
}

/** `Sources:` / `## References` / `**Citations**` — a model's own bibliography heading. */
const SOURCES_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources?|references?|citations?|cited (?:notes|documents)|sources? (?:cited|used))\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;
const LIST_MARK_RE = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const MAX_SOURCES_LINES = 15;
const UUID_ANYWHERE_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The document a line of a model-written Sources list names.
 *
 *   - "Renown authentication (ARCHITECTURE) – Detailed login flow…"
 *   - "[Authorization and Identity](https://made.up/url) — overview"
 *   - "3. Powerhouse uses header signing …"
 *
 * A UUID anywhere on the line wins; otherwise the label is the text before
 * the first " – ", " — ", ": " or " (", with markdown link syntax unwrapped,
 * matched against known titles (exact, else unique prefix).
 */
function resolveSourceLine(line: string, known: Map<string, KnownDocument>): KnownDocument | null {
  const uuid = UUID_ANYWHERE_RE.exec(line)?.[0];
  if (uuid) return known.get(uuid) ?? { documentId: uuid, title: uuid, documentType: null };
  let label = line.replace(LIST_MARK_RE, "").trim();
  label = label.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // [text](url) → text
  label = label.replace(/^\*\*(.+?)\*\*/, "$1").replace(/^["'“‘]|["'”’]$/g, "");
  const cut = label.search(/\s[–—]\s|:\s|\s\(|\s-\s/);
  if (cut > 0) label = label.slice(0, cut);
  label = label.trim();
  return known.get(label) ?? resolveLabel(label, known);
}

/**
 * Small models write a "Sources:" section of their own at the end of the
 * answer — plain titles, sometimes wrapped in invented links that lead out
 * of the app. The interface already renders sources as chips, so fold the
 * section into them: every line that names a known document becomes a
 * citation, and when every line resolved the section itself is removed
 * from the text. A line that resolves to nothing keeps the whole section
 * in place — the reader loses no information the chips cannot carry.
 */
export function foldSourcesSection(
  text: string,
  known: Map<string, KnownDocument>,
): { text: string; sources: KnownDocument[] } {
  const lines = text.split("\n");
  let heading = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SOURCES_HEADING_RE.test(lines[i])) {
      heading = i;
      break;
    }
  }
  if (heading < 0) return { text, sources: [] };
  const items = lines.slice(heading + 1).filter((l) => l.trim() !== "");
  if (items.length === 0 || items.length > MAX_SOURCES_LINES) return { text, sources: [] };
  const sources: KnownDocument[] = [];
  let unresolved = false;
  for (const line of items) {
    const doc = resolveSourceLine(line, known);
    if (doc) {
      if (!sources.some((d) => d.documentId === doc.documentId)) sources.push(doc);
    } else {
      unresolved = true;
    }
  }
  if (sources.length === 0) return { text, sources: [] };
  return {
    text: unresolved ? text : lines.slice(0, heading).join("\n").trimEnd(),
    sources,
  };
}

/**
 * Resolve every `[[…]]` marker in an answer. A UUID stands for itself, with
 * the title the trail (or an earlier turn) knew for it — an unseen UUID is
 * still a door the user can try. A non-UUID label is matched to a known
 * document's title; when that fails the marker is dropped from the text so
 * the reader is not handed a link that cannot open. A model-written
 * "Sources:" section at the end is folded into the citations (see
 * `foldSourcesSection`).
 *
 * Returns the citations in order of first mention and the text with every
 * kept marker rewritten to its `[[documentId]]` form.
 */
export function resolveCitations(
  text: string,
  trail: TrailEntry[],
  priorCitations: Citation[] = [],
): { text: string; citations: Citation[]; dropped: number } {
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
  // UUID-shaped markers naming a document no tool returned and no earlier
  // turn cited. A model cannot know an id it was never shown; such a marker
  // is invented, and a chip that opens nothing is worse than no chip.
  let dropped = 0;
  const grounded = groundMarkdownLinks(text, known, collectKnownUrls(trail));
  const rewritten = grounded.replace(
    CITATION_RE,
    (
      match: string,
      double: string | undefined,
      single: string | undefined,
      parenthesised: string | undefined,
      bare: string | undefined,
    ) => {
      const raw = (double ?? single ?? parenthesised ?? bare ?? "").trim();
      // An anchored marker — [[documentId#itemId]] — cites one item inside a
      // document (an envelope, a deliverable, a goal). The document resolves
      // exactly as before; the item id rides along on the rewritten marker
      // and is what a click opens the document at.
      const parsedMarker = double !== undefined ? parseMarker(raw) : null;
      // Anchored only when the part before `#` is plainly a document — a
      // UUID, or an id a tool surfaced — so a title containing `#` ("C# notes")
      // is still treated as a by-name label.
      const anchored =
        parsedMarker !== null &&
        parsedMarker.anchor !== null &&
        (UUID_RE.test(parsedMarker.documentId) || known.has(parsedMarker.documentId));
      const label = anchored ? parsedMarker.documentId : raw;
      const anchor = anchored ? parsedMarker.anchor : null;
      let doc: KnownDocument | null;
      if (bare !== undefined) {
        // A naked UUID in prose is a citation only when we know the
        // document; an id being discussed as data stays as written.
        doc = known.get(label) ?? null;
        if (!doc) return match;
      } else if (UUID_RE.test(label)) {
        doc = known.get(label) ?? null;
        if (!doc) {
          dropped++;
          return "";
        }
      } else if (double !== undefined) {
        // Explicit citation syntax: resolve generously, drop what fails.
        doc = known.get(label) ?? resolveLabel(label, known);
      } else {
        // Single brackets are also ordinary prose: only an exact title counts,
        // and anything else stays as the author wrote it.
        doc = known.get(label) ?? exactTitle(label, known);
        if (!doc) return match;
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
      return `[[${doc.documentId}${anchor ? `#${anchor}` : ""}]]`;
    },
  );
  // A marker repeated back to back ("[[a]] [[a]] [[a]]") is one citation
  // the model stuttered, not three; collapse before numbering.
  const collapsed = rewritten.replace(/(\[\[([^\]]+)\]\])(?:\s*\[\[\2\]\])+/g, "$1");
  const folded = foldSourcesSection(collapsed, known);
  for (const doc of folded.sources) {
    if (!byId.has(doc.documentId)) {
      order.push(doc.documentId);
      byId.set(doc.documentId, {
        documentId: doc.documentId,
        title: doc.title,
        documentType: doc.documentType,
      });
    }
  }
  return {
    text: folded.text,
    citations: order.map((id) => byId.get(id)!),
    dropped,
  };
}

/**
 * Documents the model read in full this turn and did not cite. Search hits
 * it merely saw are not sources; a note it opened and read is, whether or
 * not it remembered to say so. Ordered by first read, deduplicated.
 */
export function consultedDocuments(
  trail: TrailEntry[],
  cited: Citation[],
): Citation[] {
  const citedIds = new Set(cited.map((c) => c.documentId));
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const e of trail) {
    // Read in full on purpose — not the bodies search handed over unasked.
    if (!e.ok || !FULL_READ_TOOLS.has(e.tool)) continue;
    for (const d of readIn(e)) {
      if (typeof d.documentId !== "string") continue;
      if (citedIds.has(d.documentId) || seen.has(d.documentId)) continue;
      seen.add(d.documentId);
      out.push({
        documentId: d.documentId,
        title: typeof d.title === "string" && d.title ? d.title : d.documentId,
        documentType: typeof d.documentType === "string" ? d.documentType : null,
      });
    }
  }
  return out;
}

/**
 * A stored message as the model is sent it again. Under an answer that
 * proposed changes to work goes what the person did with them — applied,
 * stopped partway, cancelled, or not yet — so a later "is it done?" is
 * answered from what happened, not from the proposal.
 */
export function sentContent(m: Pick<StoredMessage, "role" | "content" | "proposals">): string {
  if (m.role !== "assistant" || !m.proposals?.length) return m.content;
  return [m.content, ...m.proposals.map(outcomeNote).filter((n): n is string => n !== null)].join("\n\n");
}

/** The last proposal of changes to work the turn made, checked — or null. */
export function latestProposal(trail: readonly TrailEntry[]): WorkProposal | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const e = trail[i];
    if (!e.ok || e.tool !== "propose_work_changes") continue;
    const p = (e.data as { proposal?: WorkProposal } | undefined)?.proposal;
    if (p && Array.isArray(p.changes)) return p;
  }
  return null;
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
  /** Where to send completions; null until a provider is connected. */
  endpoint: ChatEndpoint | null;
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
  const { driveId, endpoint, model, fallbackModels, modelName, systemPrompt } = o;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  // The answer in progress lives outside this hook (chat-runs.ts): leaving the chat for another
  // view unmounts it, and the answer keeps arriving there, to be shown again on return.
  const subscribe = useCallback((listener: () => void) => subscribeChatRun(driveId, listener), [driveId]);
  const run = useSyncExternalStore(subscribe, () => chatRun(driveId), () => undefined);
  const active = runFor(run, thread?.id);
  // An answer that finished while the chat was closed is in the run, not yet in `thread`.
  const shown = active ? active.thread : thread;

  // Load history when the drive changes. Reopen the thread that was current in this tab, so
  // leaving the chat to read a cited note and coming back lands in the same conversation — with
  // its answer still streaming if it was. Moving to another vault stops this one's answer.
  const previousDrive = useRef(driveId);
  useEffect(() => {
    if (previousDrive.current && previousDrive.current !== driveId) stopChatRun(previousDrive.current);
    previousDrive.current = driveId;
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
      if (!content || !driveId || !endpoint || chatRun(driveId)?.isStreaming) return;

      const now = new Date().toISOString();
      const current: Thread = shown ?? {
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

      const ctrl = startChatRun(driveId, withUser);
      const update = (patch: Parameters<typeof updateChatRun>[2]) => updateChatRun(driveId, ctrl, patch);
      // The partial answer, read synchronously when the user stops it.
      let streamed = "";

      const history: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...withUser.messages.map<ChatMessage>((m) => ({ role: m.role, content: sentContent(m) })),
      ];

      let finalText = "";
      const collected: TrailEntry[] = [];
      // Every answer starts from fresh data. The listing cache exists so
      // that several tool calls within one answer are free, not so that a
      // later question is answered from an earlier minute's vault.
      resetVaultDocumentListing();
      try {
        const r = await runAgentLoop({
          endpoint,
          model,
          fallbackModels,
          modelName,
          driveId,
          messages: history,
          priorCitations: withUser.messages.flatMap((m) => m.citations ?? []),
          signal: ctrl.signal,
          onText: (d) => {
            streamed += d;
            update({ streamingText: streamed });
          },
          // Each round starts with a clean slate: whatever the model said
          // while asking for tools (or the template it wrote them in) is
          // not part of the answer.
          onRound: () => {
            streamed = "";
            update({ streamingText: "" });
          },
          onTrail: (e) => {
            collected.push(e);
            update({ trail: [...collected] });
          },
        });
        finalText = r.text;
        if (r.answeredBy && r.answeredBy !== model) update({ routedFrom: model });
      } catch (err) {
        if (ctrl.signal.aborted) {
          // Keep whatever streamed; the user asked for it to stop.
          finalText = streamed;
        } else {
          update({ failure: { ...classifyFailure(err, endpoint), model } });
        }
      }

      // Persist the turn if anything came back — a partial answer after Stop,
      // or an answer that was only tool activity, is still worth keeping.
      if (finalText || collected.length > 0) {
        // Earlier turns' citations let a later "[[id]]" keep its title (and
        // let a by-name citation resolve) without re-running the tools.
        const prior = withUser.messages.flatMap((m) => m.citations ?? []);
        const resolved = resolveCitations(finalText, collected, prior);
        if (resolved.dropped > 0) {
          // Visible like every other harness move: the reader should know a
          // reference was removed, and why.
          const entry: TrailEntry = {
            tool: "compat",
            summary: `removed ${resolved.dropped} citation${resolved.dropped === 1 ? "" : "s"} of an id no tool returned`,
            ok: false,
            error: "invented document id",
          };
          collected.push(entry);
        }
        const consulted = consultedDocuments(collected, resolved.citations);
        // The passage behind each marker, from the documents the tools
        // returned this turn — the only moment their text is at hand.
        const evidence = collectEvidence(resolved.text, collected);
        // The turn's proposal, if it made one — the last, when it revised.
        const proposal = latestProposal(collected);
        const assistant: StoredMessage = {
          role: "assistant",
          content: resolved.text,
          ...(proposal ? { proposals: [proposal] } : {}),
          citations: resolved.citations,
          ...(evidence.length > 0 ? { evidence } : {}),
          ...(consulted.length > 0 ? { consulted } : {}),
        };
        const done: Thread = {
          ...withUser,
          updatedAt: new Date().toISOString(),
          messages: [...withUser.messages, assistant],
        };
        setThread(done);
        persist(done);
        update({ thread: done, streamingText: "", trail: [...collected], isStreaming: false });
      } else {
        update({ isStreaming: false });
      }
      endChatRun(driveId, ctrl);
    },
    [
      driveId,
      endpoint,
      model,
      fallbackModels,
      modelName,
      systemPrompt,
      shown,
      persist,
    ],
  );

  const stop = useCallback(() => stopChatRun(driveId), [driveId]);

  const newThread = useCallback(() => {
    stopChatRun(driveId);
    setThread(null);
    if (driveId) writeCurrentThreadId(driveId, null);
  }, [driveId]);

  const openThread = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (!t) return;
      if (chatRun(driveId)?.thread.id !== id) stopChatRun(driveId);
      setThread(t);
      if (driveId) writeCurrentThreadId(driveId, id);
    },
    [threads, driveId],
  );

  const removeThread = useCallback(
    (id: string) => {
      if (!driveId) return;
      if (chatRun(driveId)?.thread.id === id) clearChatRun(driveId);
      deleteThread(driveId, id);
      setThreads(loadThreads(driveId));
      if (thread?.id === id) setThread(null);
    },
    [driveId, thread],
  );

  const messages = useMemo(() => shown?.messages ?? [], [shown]);

  return {
    threads,
    thread: shown,
    messages,
    streamingText: active?.streamingText ?? "",
    trail: active?.trail ?? NO_TRAIL,
    isStreaming: active?.isStreaming ?? false,
    failure: active?.failure ?? null,
    routedFrom: active?.routedFrom ?? null,
    send,
    stop,
    newThread,
    openThread,
    removeThread,
  };
}

/** One empty trail, so a conversation without a run does not get a new array every render. */
const NO_TRAIL: TrailEntry[] = [];
