/**
 * Per-op LoRA scores for configuration C: a port of the rig's lib.ts
 * `trieScore`. Deviations forced by wllama (Phase 0): string prompts
 * (templated + answer pieces; natively retokenise identically at 1,685/1,685
 * nodes), and children outside the top-n (or under a failed node) are read
 * with a forced one-token completion instead of the n_probs 8192 retry.
 * `branch` (shipped) queries only nodes with >= 2 children; `exact` (as
 * registered) every internal node. Dev gate decisions agree on 216/216.
 */
import table from "./answer-tokens.lfm2.json" with { type: "json" };
import type { LoraBackend, NextDist } from "./decision-backend.js";
import { NONE_KEY } from "./op-scorer.js";

export type TrieMode = "exact" | "branch";

export interface TrieAnswer {
  key: string;
  /** Canonical token ids, ending in `<|im_end|>`. */
  ids: number[];
  /** One piece per id (the last is `<|im_end|>`, never sent). */
  pieces: string[];
}

export const ANSWER_TABLE_TOKENIZER = table.tokenizer;

const ANSWERS: Record<string, { ids: number[]; pieces: string[] } | undefined> =
  table.answers;

/** Trie answers for `keys` (catalog order) plus none, from the table. */
export function answersFor(keys: readonly string[]): TrieAnswer[] {
  return [...keys, NONE_KEY].map((key) => {
    const a = ANSWERS[key];
    if (!a) throw new Error(`no answer tokens for ${key}`);
    return { key, ids: a.ids, pieces: a.pieces };
  });
}

/**
 * Why the loaded LoRA's tokenizer differs from the table's (null if not).
 * `meta` is the GGUF metadata; `bos` / `eos` come from the loaded context.
 */
export function answerTableMismatch(loaded: {
  pre?: string;
  nVocab?: number;
  bos?: number;
  eos?: number;
}): string | null {
  const t = ANSWER_TABLE_TOKENIZER;
  if (loaded.pre !== undefined && loaded.pre !== t.pre)
    return `tokenizer ${loaded.pre}, answer table ${t.pre}`;
  if (loaded.nVocab !== undefined && loaded.nVocab !== t.nVocab)
    return `vocabulary ${loaded.nVocab}, answer table ${t.nVocab}`;
  if (loaded.bos !== undefined && loaded.bos !== t.bos)
    return `BOS ${loaded.bos}, answer table ${t.bos}`;
  if (loaded.eos !== undefined && loaded.eos !== t.imEnd)
    return `EOS ${loaded.eos}, answer table <|im_end|> ${t.imEnd}`;
  return null;
}

export interface TrieShape {
  /** Children of each prefix (keyed by joined ids), in insertion order. */
  kids: Map<string, Set<number>>;
  /** The text of each prefix (concatenated pieces). */
  text: Map<string, string>;
  /** The nodes to query, in DFS order (lib.ts `visit`). */
  order: number[][];
}

export function trieShape(
  answers: readonly TrieAnswer[],
  mode: TrieMode,
): TrieShape {
  const kids = new Map<string, Set<number>>();
  const text = new Map<string, string>();
  for (const a of answers)
    for (let i = 0; i < a.ids.length; i++) {
      const k = a.ids.slice(0, i).join(",");
      text.set(k, a.pieces.slice(0, i).join(""));
      let ch = kids.get(k);
      if (!ch) kids.set(k, (ch = new Set()));
      ch.add(a.ids[i]);
    }
  const order: number[][] = [];
  const visit = (path: number[]) => {
    const ch = kids.get(path.join(","));
    if (!ch) return;
    if (mode === "exact" || ch.size >= 2) order.push(path);
    for (const c of ch) visit([...path, c]);
  };
  visit([]);
  return { kids, text, order };
}

export interface TrieResult {
  /** Answer key -> summed logprob (`none` for `{"ops": []}`). */
  sums: Record<string, number>;
  /** Per-answer token logprobs that entered the sum. */
  logprobs: Record<string, number[]>;
  requests: number;
  /** Children read by a forced completion (outside top-n or failed node). */
  forced: number;
  /** Top-n requests that failed (wllama JSON dump errors). */
  dumpErrors: number;
  /** Children whose forced read also failed (floored at the node's min). */
  floored: number;
  ms: number;
}

/** Score every answer under `prompt` (the templated step-1 prompt). */
export async function trieScore(
  backend: Pick<LoraBackend, "nextDist" | "forcedLogprob">,
  prompt: string,
  answers: readonly TrieAnswer[],
  mode: TrieMode,
  nProbs = 64,
): Promise<TrieResult> {
  const t0 = performance.now();
  const { kids, text, order } = trieShape(answers, mode);
  const dist = new Map<string, NextDist>();
  let requests = 0;
  let forced = 0;
  let dumpErrors = 0;
  let floored = 0;
  for (const path of order) {
    const key = path.join(",");
    const need = kids.get(key) ?? new Set<number>();
    const ptext = prompt + (text.get(key) ?? "");
    let d: NextDist;
    try {
      d = await backend.nextDist(ptext, nProbs);
    } catch {
      dumpErrors++;
      d = { lp: new Map(), minLp: 0 };
    }
    requests++;
    for (const c of need) {
      if (d.lp.has(c)) continue;
      requests++;
      try {
        const v = await backend.forcedLogprob(ptext, c);
        d.lp.set(c, v);
        d.minLp = Math.min(d.minLp, v);
        forced++;
      } catch {
        // left absent: floored below, counted
      }
    }
    dist.set(key, d);
  }
  const sums: Record<string, number> = {};
  const logprobs: Record<string, number[]> = {};
  for (const a of answers) {
    const lps: number[] = [];
    for (let i = 0; i < a.ids.length; i++) {
      const d = dist.get(a.ids.slice(0, i).join(","));
      if (!d) continue; // branch mode, single-child node
      let v = d.lp.get(a.ids[i]);
      if (v === undefined) {
        floored++;
        v = d.minLp;
      }
      lps.push(v);
    }
    logprobs[a.key] = lps;
    sums[a.key] = lps.reduce((x, y) => x + y, 0);
  }
  return {
    sums,
    logprobs,
    requests,
    forced,
    dumpErrors,
    floored,
    ms: performance.now() - t0,
  };
}
