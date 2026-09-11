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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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

/**
 * True when an answer should be sent back for citations: at least one tool
 * result named a document (so there is something to cite) and the text
 * resolves to no citation at all — not a `[[…]]`, not a bracketed title,
 * not a Sources section.
 */
export function needsCitationRepair(text: string, trail: TrailEntry[]): boolean {
  if (!text.trim()) return false;
  if (collectKnownDocuments(trail).size === 0) return false;
  return resolveCitations(text, trail).citations.length === 0;
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
  const tools = o.tools ?? CHAT_TOOLS;
  const asked =
    [...o.messages].reverse().find((m) => m.role === "user")?.content ?? "";

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
    const result = await deps.streamChat({
      endpoint: o.endpoint,
      model: o.model,
      fallbackModels: o.fallbackModels,
      messages,
      tools,
      toolChoice: toolsOff ? "none" : "auto",
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
      if (!repairedCitations && needsCitationRepair(text, trail)) {
        repairedCitations = true;
        uncitedDraft = text;
        const known = [...collectKnownDocuments(trail).values()];
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

/** Tools whose result is one document read in full — a source consulted. */
const FULL_READ_TOOLS = new Set(["read_note", "read_document"]);

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
    if (!e.ok || !FULL_READ_TOOLS.has(e.tool)) continue;
    const d = e.data as
      | { documentId?: unknown; title?: unknown; documentType?: unknown }
      | undefined;
    if (!d || typeof d.documentId !== "string") continue;
    if (citedIds.has(d.documentId) || seen.has(d.documentId)) continue;
    seen.add(d.documentId);
    out.push({
      documentId: d.documentId,
      title: typeof d.title === "string" && d.title ? d.title : d.documentId,
      documentType: typeof d.documentType === "string" ? d.documentType : null,
    });
  }
  return out;
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
      if (!content || !driveId || !endpoint || isStreaming) return;

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
          signal: ctrl.signal,
          onText: (d) => {
            streamedRef.current += d;
            setStreamingText(streamedRef.current);
          },
          // Each round starts with a clean slate: whatever the model said
          // while asking for tools (or the template it wrote them in) is
          // not part of the answer.
          onRound: () => {
            streamedRef.current = "";
            setStreamingText("");
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
          setFailure({ ...classifyFailure(err, endpoint), model });
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
          setTrail((t) => [...t, entry]);
        }
        const consulted = consultedDocuments(collected, resolved.citations);
        // The passage behind each marker, from the documents the tools
        // returned this turn — the only moment their text is at hand.
        const evidence = collectEvidence(resolved.text, collected);
        const assistant: StoredMessage = {
          role: "assistant",
          content: resolved.text,
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
        setStreamingText("");
      }
    },
    [
      driveId,
      endpoint,
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
