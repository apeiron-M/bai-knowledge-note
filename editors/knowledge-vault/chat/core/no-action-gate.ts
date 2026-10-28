/**
 * No-action gate (spike round 6): "does this request ask to change the
 * document?", scored by likelihood instead of sampled. Both answers are
 * forced with a one-literal grammar; the score is the calibrated log-odds
 *   [lp(yes | request) − lp(no | request)] − [lp(yes | N/A) − lp(no | N/A)]
 * and the request is treated as no-action when it falls below a threshold.
 * The content-free pair depends only on the document type, so it is cached.
 */
import type { ScoreText } from "./llm-client.js";
import {
  aggregate,
  CONTENT_FREE,
  literalGrammar,
  scoreCacheKey,
  type ScoreCache,
  type ScoredRequest,
} from "./op-scorer.js";
import type { WllamaChatMessage } from "./wllama-types.js";
import { looksLikeQuestion } from "nl-runtime";

export { looksLikeQuestion } from "nl-runtime";

export const GATE_SYSTEM =
  "You decide whether the user's request asks to change the current document. Questions, thanks and comments do not change it. Answer with JSON.";

export const GATE_ANSWERS = {
  yes: '{"change": "yes"}',
  no: '{"change": "no"}',
} as const;

/** `bai/knowledge-note` → `knowledge note`. */
export function docTypeLabel(docType: string): string {
  const slash = docType.indexOf("/");
  return (slash === -1 ? docType : docType.slice(slash + 1)).replace(/-/g, " ");
}

export function gateMessages(
  utterance: string,
  docType: string,
): WllamaChatMessage[] {
  return [
    { role: "system", content: GATE_SYSTEM },
    {
      role: "user",
      content: `Document: ${docTypeLabel(docType)}\nRequest: ${utterance}\n\nDoes the request change the document?`,
    },
  ];
}

/** Calibrated log-odds of "yes" from the four answer scores. */
export function gateLogOdds(
  yes: number,
  no: number,
  cfYes: number,
  cfNo: number,
): number {
  return yes - no - (cfYes - cfNo);
}

export interface GateResult {
  /** Calibrated log-odds that the request changes the document. */
  score: number;
  /** Uncalibrated log-odds (for reporting). */
  rawScore: number;
  /** Below the threshold: answer instead of acting. */
  noAction: boolean;
  /** Wall time of the requests made now (cache hits cost 0). */
  wallMs: number;
  requests: ScoredRequest[];
}

export interface GateOptions {
  scoreText: ScoreText;
  cache?: ScoreCache;
  threshold?: number;
}

export async function scoreChangeGate(
  utterance: string,
  docType: string,
  opts: GateOptions,
): Promise<GateResult> {
  const reqs: ScoredRequest[] = [];
  const score = async (input: string, key: "yes" | "no") => {
    const messages = gateMessages(input, docType);
    const text = GATE_ANSWERS[key];
    const contentFree = input === CONTENT_FREE;
    const ck = scoreCacheKey(messages, text);
    const hit = contentFree ? opts.cache?.get(ck) : undefined;
    if (hit) {
      reqs.push({ ...hit, wallMs: 0, cached: true });
      return aggregate(hit.logprobs, "sum");
    }
    const r = await opts.scoreText(messages, literalGrammar(text));
    const req: ScoredRequest = {
      key,
      offset: 0,
      contentFree,
      text: r.text,
      logprobs: r.tokens.map((t) => t.logprob),
      tokens: r.tokens.map((t) => t.token),
      wallMs: r.wallMs,
      computeMs: r.wallMs,
      cached: false,
      promptN: r.timings?.prompt_n,
      cacheN: r.timings?.cache_n,
      predictedN: r.timings?.predicted_n,
    };
    if (contentFree) opts.cache?.set(ck, req);
    reqs.push(req);
    return aggregate(req.logprobs, "sum");
  };
  const yes = await score(utterance, "yes");
  const no = await score(utterance, "no");
  const cfYes = await score(CONTENT_FREE, "yes");
  const cfNo = await score(CONTENT_FREE, "no");
  const s = gateLogOdds(yes, no, cfYes, cfNo);
  return {
    score: s,
    rawScore: yes - no,
    noAction: s < (opts.threshold ?? 0),
    wallMs: reqs.reduce((t, r) => t + r.wallMs, 0),
    requests: reqs,
  };
}

/**
 * Generic requests that change nothing (questions, thanks, comments), for
 * the embedding gate. Written once, not tuned per item.
 */
export const NO_ACTION_EXEMPLARS = [
  "what does this mean?",
  "can you explain this to me?",
  "why is it like that?",
  "how many are there?",
  "who is responsible for this?",
  "is this correct?",
  "what changed recently?",
  "tell me more about it",
  "summarize this for me",
  "thanks",
  "thank you, that looks great",
  "ok, got it",
  "hello",
  "never mind",
  "I'm not sure yet, let me think about it",
  "interesting, I didn't know that",
];

/**
 * Embedding gate score: best similarity to a no-action exemplar minus best
 * similarity to an op. Positive means "answer instead of acting".
 */
export function embeddingGateScore(
  exemplarSims: number[],
  opSims: number[],
): number {
  return Math.max(-1, ...exemplarSims) - Math.max(-1, ...opSims);
}

/** Ends with "?" and is not a polite command ("can you tag it …?"). */
/** Round-6 combined gate: a question, or the embedding score above 0.04. */
export const EMBEDDING_GATE_THRESHOLD = 0.04;

export function combinedNoAction(utterance: string, embScore: number): boolean {
  return looksLikeQuestion(utterance) || embScore > EMBEDDING_GATE_THRESHOLD;
}
