/**
 * Likelihood scoring for op selection (spike round 5). Instead of letting
 * the model sample an op under an enum constraint, each candidate's answer
 * is forced with a one-literal GBNF grammar and its token logprobs (which
 * llama.cpp reports before the grammar mask) are summed. Calibration,
 * order averaging and BM25 fusion are pure functions over those scores.
 */
import type { ScoreResult, ScoreText } from "./llm-client.js";
import type { CatalogEntry } from "./op-catalog.js";
import type { WllamaChatMessage } from "./wllama-types.js";

/* ------------------------------------------------------------------ */
/* Grammar helpers                                                      */
/* ------------------------------------------------------------------ */

/** A GBNF string literal (quoted) matching `text` exactly. */
export function gbnfLiteral(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f)
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `"${out}"`;
}

/** Grammar whose only sentence is `text`. */
export function literalGrammar(text: string): string {
  return `root ::= ${gbnfLiteral(text)}`;
}

/** The forced assistant answer for one option, e.g. `{"op": "add topic"}`. */
export function forcedOpText(label: string): string {
  return `{"op": ${JSON.stringify(label)}}`;
}

/* ------------------------------------------------------------------ */
/* Options and prompt                                                   */
/* ------------------------------------------------------------------ */

/** One line of the candidate list. `key` is a catalog key or `NONE_KEY`. */
export interface OpOption {
  key: string;
  /** What the prompt lists and the forced answer contains. */
  label: string;
  description: string;
  fields: string[];
}

/** Pseudo-candidate for "no document change". */
export const NONE_KEY = "none";

function fieldNames(entry: CatalogEntry): string[] {
  const props = entry.modelSchema.properties;
  return typeof props === "object" && props !== null ? Object.keys(props) : [];
}

/** `ADD_TOPIC` → `add topic`. */
export function readableOpName(opName: string): string {
  return opName.toLowerCase().replace(/_/g, " ");
}

export type LabelStyle = "key" | "readable";

/**
 * Labels for a candidate list. `key` uses the catalog key (round 1–2
 * layout). `readable` uses the op name in words; when two candidates would
 * share a label (unscoped: `set owner` in project and wbs) each gets its
 * model name in brackets.
 */
export function optionLabels(
  candidates: Pick<CatalogEntry, "key" | "opName" | "model">[],
  style: LabelStyle,
): string[] {
  if (style === "key") return candidates.map((c) => c.key);
  const base = candidates.map((c) => readableOpName(c.opName));
  const count = new Map<string, number>();
  for (const b of base) count.set(b, (count.get(b) ?? 0) + 1);
  return base.map((b, i) =>
    (count.get(b) ?? 0) > 1
      ? `${b} (${candidates[i].model.replace(/-/g, " ")})`
      : b,
  );
}

export function toOptions(
  candidates: CatalogEntry[],
  style: LabelStyle,
): OpOption[] {
  const labels = optionLabels(candidates, style);
  return candidates.map((c, i) => ({
    key: c.key,
    label: labels[i],
    description: c.description || readableOpName(c.opName),
    fields: fieldNames(c),
  }));
}

export function noneOption(style: LabelStyle): OpOption {
  return {
    key: NONE_KEY,
    label: style === "key" ? NONE_KEY : "none (just reply)",
    description:
      "no document change: the request is a question, a comment or thanks",
    fields: [],
  };
}

/**
 * Same layout as `selectOpMessages` (round 1): system instruction, then the
 * option list, then the request last so the content-free pass shares the
 * longest possible prefix.
 */
export function scoringMessages(
  utterance: string,
  options: OpOption[],
): WllamaChatMessage[] {
  const lines = options.map(
    (o) =>
      `- ${o.label}: ${o.description} (fields: ${o.fields.length ? o.fields.join(", ") : "none"})`,
  );
  return [
    {
      role: "system",
      content:
        "You choose the single document operation that carries out the user's request. Answer with JSON.",
    },
    {
      role: "user",
      content: `Operations:\n${lines.join("\n")}\n\nRequest: ${utterance}`,
    },
  ];
}

/** Content-free input for calibration. */
export const CONTENT_FREE = "N/A";

/* ------------------------------------------------------------------ */
/* Score arithmetic                                                     */
/* ------------------------------------------------------------------ */

export type Aggregate = "sum" | "mean";

export function aggregate(logprobs: number[], mode: Aggregate): number {
  if (logprobs.length === 0) return -Infinity;
  const sum = logprobs.reduce((s, x) => s + x, 0);
  return mode === "sum" ? sum : sum / logprobs.length;
}

/** score(c | utterance) − score(c | content-free), element-wise. */
export function calibrate(scores: number[], contentFree: number[]): number[] {
  return scores.map((s, i) => s - contentFree[i]);
}

/** Rotate left by `k`: `[a,b,c]`, 1 → `[b,c,a]`. */
export function rotate<T>(xs: T[], k: number): T[] {
  if (xs.length === 0) return [];
  const s = ((k % xs.length) + xs.length) % xs.length;
  return [...xs.slice(s), ...xs.slice(0, s)];
}

/** `n` rotation offsets spread evenly over a list of length `len`. */
export function rotationOffsets(len: number, n: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const o = Math.round((j * len) / n) % Math.max(len, 1);
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** Mean score per key over several orderings. */
export function averageByKey(runs: Map<string, number>[]): Map<string, number> {
  const sums = new Map<string, { s: number; n: number }>();
  for (const run of runs) {
    for (const [k, v] of run) {
      const cur = sums.get(k) ?? { s: 0, n: 0 };
      sums.set(k, { s: cur.s + v, n: cur.n + 1 });
    }
  }
  return new Map([...sums].map(([k, { s, n }]) => [k, s / n]));
}

/**
 * Hybrid score: LLM score plus `lambda` × BM25 score normalized by the
 * top candidate's BM25 score (so the BM25 term is in [0, 1]).
 */
export function fuse(llm: number[], bm25: number[], lambda: number): number[] {
  const max = Math.max(0, ...bm25);
  return llm.map((s, i) => s + (max > 0 ? (lambda * bm25[i]) / max : 0));
}

/** Index of the largest value; ties go to the earliest index. */
export function argmax(xs: number[]): number {
  let best = -1;
  for (let i = 0; i < xs.length; i++) {
    if (best === -1 || xs[i] > xs[best]) best = i;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Model calls                                                          */
/* ------------------------------------------------------------------ */

/**
 * Logprobs of every reported token. llama.cpp reports the end-of-generation
 * token too (as an empty-text entry, observed in round 5), so the score is
 * log P(text, then stop | prompt) and is comparable across options.
 */
export function forcedLogprobs(r: ScoreResult): number[] {
  return r.tokens.map((t) => t.logprob);
}

export interface ScoredRequest {
  key: string;
  /** Rotation offset of the option list. */
  offset: number;
  contentFree: boolean;
  text: string;
  logprobs: number[];
  tokens: string[];
  wallMs: number;
  promptN?: number;
  cacheN?: number;
  predictedN?: number;
}

export interface ScoreRunOptions {
  scoreText: ScoreText;
  style: LabelStyle;
  /** Rotation offsets to score; `[0]` is the original order. */
  offsets: number[];
  /** Also score each option against the content-free input. */
  contentFree: boolean;
  /** Append the "none" pseudo-candidate (last, before rotation). */
  includeNone?: boolean;
}

/**
 * Score every option under every requested ordering (and the content-free
 * input). Requests run in the order a real client would issue them: all
 * options for the utterance, then the content-free pass, per ordering.
 */
export async function scoreOptions(
  utterance: string,
  candidates: CatalogEntry[],
  opts: ScoreRunOptions,
): Promise<ScoredRequest[]> {
  const base = toOptions(candidates, opts.style);
  if (opts.includeNone) base.push(noneOption(opts.style));
  const out: ScoredRequest[] = [];
  for (const offset of opts.offsets) {
    const options = rotate(base, offset);
    const inputs = opts.contentFree ? [utterance, CONTENT_FREE] : [utterance];
    for (const [ii, input] of inputs.entries()) {
      const messages = scoringMessages(input, options);
      for (const o of options) {
        const text = forcedOpText(o.label);
        const r = await opts.scoreText(messages, literalGrammar(text));
        out.push({
          key: o.key,
          offset,
          contentFree: ii === 1,
          text: r.text,
          logprobs: forcedLogprobs(r),
          tokens: r.tokens.map((t) => t.token),
          wallMs: r.wallMs,
          promptN: r.timings?.prompt_n,
          cacheN: r.timings?.cache_n,
          predictedN: r.timings?.predicted_n,
        });
      }
    }
  }
  return out;
}

export interface OpPick {
  key: string | null;
  scores: Record<string, number>;
  /** Sum of `wallMs` over the requests this method needs. */
  wallMs: number;
}

export interface PickOptions {
  aggregate: Aggregate;
  calibrated: boolean;
  /** Offsets to average over (subset of what was scored). */
  offsets: number[];
}

/** Derive one method's choice from a scored run. */
export function pickFromRequests(
  reqs: ScoredRequest[],
  keys: string[],
  opts: PickOptions,
): OpPick {
  const used = reqs.filter(
    (r) => opts.offsets.includes(r.offset) && (opts.calibrated || !r.contentFree),
  );
  const runs = opts.offsets.map((offset) => {
    const m = new Map<string, number>();
    for (const key of keys) {
      const find = (cf: boolean) =>
        used.find(
          (r) => r.offset === offset && r.key === key && r.contentFree === cf,
        );
      const s = find(false);
      if (!s) continue;
      let v = aggregate(s.logprobs, opts.aggregate);
      if (opts.calibrated) {
        const c = find(true);
        if (!c) continue;
        v -= aggregate(c.logprobs, opts.aggregate);
      }
      m.set(key, v);
    }
    return m;
  });
  const avg = averageByKey(runs);
  const scores = keys.map((k) => avg.get(k) ?? -Infinity);
  const best = argmax(scores);
  return {
    key: best >= 0 && Number.isFinite(scores[best]) ? keys[best] : null,
    scores: Object.fromEntries(keys.map((k, i) => [k, scores[i]])),
    wallMs: used.reduce((s, r) => s + r.wallMs, 0),
  };
}
