/**
 * Configuration C fusion and margin gate: a line-for-line port of the eval
 * rig's `evaluate.py` `lsm` / `decide` (training/eval-rig/src) and of
 * decide.mjs's `logT1` (training/kev/node). Pure; every sum runs in option
 * order (op keys in catalog order, then none) as Python's `sum` over the
 * rig's dicts did, so results match the rig to float round-off.
 */
import { C_FUSION, type FusionParams } from "./model-manifest.js";
import { NONE_KEY } from "./op-scorer.js";

/** Option -> score, over `[...keys, NONE_KEY]`. */
export type OptionScores = Record<string, number>;

/** Tempered log-softmax over `opts` (rig `lsm(d, T)`). */
export function lsm(
  d: OptionScores,
  opts: readonly string[],
  T: number,
): OptionScores {
  const v = opts.map((o) => d[o] / T);
  const m = Math.max(...v);
  let s = 0;
  for (const x of v) s += Math.exp(x - m);
  const z = Math.log(s) + m;
  const out: OptionScores = {};
  opts.forEach((o, i) => (out[o] = v[i] - z));
  return out;
}

/**
 * decide.mjs `logT1`: Kev serves softmax(z / servedT); this recovers
 * log softmax(z) with z = servedT * log p (+ const).
 */
export function logT1(probs: readonly number[], servedT: number): number[] {
  const z = probs.map((p) => servedT * Math.log(Math.max(p, 1e-300)));
  const m = Math.max(...z);
  const lse = m + Math.log(z.reduce((s, x) => s + Math.exp(x - m), 0));
  return z.map((x) => x - lse);
}

export interface GateDecision {
  /** The fused argmax over op keys (never none). */
  pick: string;
  asked: boolean;
  /** Fused top `kOffer` when asked, best first; else empty. */
  offered: string[];
  /** Fused probability of every option, including none. */
  p: OptionScores;
  /** Op keys by fused p, best first (ties: catalog order). */
  ranking: string[];
  /** p[ranking[0]] - p[ranking[1]] (1 with a single op). */
  margin: number;
  /** Kev alone: first max over op keys of its tempered log-softmax. */
  kevPick: string;
}

/**
 * Fuse the LoRA trie scores with Kev's T1 log-probabilities and apply the
 * margin gate (rig `decide`, configs lora_x_kev and gate). The caller has
 * already applied the no-action rule: the LoRA's step-1 pick is not none.
 */
export function fuseAndGate(
  keys: readonly string[],
  lora: OptionScores,
  kev: OptionScores,
  params: FusionParams = C_FUSION,
): GateDecision {
  if (keys.length === 0) throw new Error("fuseAndGate needs at least one op");
  const opts = [...keys, NONE_KEY];
  for (const o of opts) {
    if (typeof lora[o] !== "number") throw new Error(`no LoRA score for ${o}`);
    if (typeof kev[o] !== "number") throw new Error(`no Kev score for ${o}`);
  }
  const L = lsm(lora, opts, params.tLora);
  const K = lsm(kev, opts, params.tKev);
  let kevPick = keys[0];
  for (const k of keys) if (K[k] > K[kevPick]) kevPick = k;
  const s = opts.map((o) => params.wLora * L[o] + params.wKev * K[o]);
  const m = Math.max(...s);
  let Z = 0;
  for (const v of s) Z += Math.exp(v - m);
  const p: OptionScores = {};
  opts.forEach((o, i) => (p[o] = Math.exp(s[i] - m) / Z));
  const ranking = keys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => p[b.k] - p[a.k] || a.i - b.i)
    .map((x) => x.k);
  const margin = ranking.length > 1 ? p[ranking[0]] - p[ranking[1]] : 1;
  const asked = ranking.length > 1 && margin < params.tau;
  return {
    pick: ranking[0],
    asked,
    offered: asked ? ranking.slice(0, params.kOffer) : [],
    p,
    ranking,
    margin,
    kevPick,
  };
}

/** Kev's per-option T1 log-probabilities keyed by option (none last). */
export function kevScores(
  keys: readonly string[],
  logprobsT1: readonly number[],
): OptionScores {
  if (logprobsT1.length !== keys.length + 1)
    throw new Error(
      `Kev returned ${logprobsT1.length} options for ${keys.length} ops + none`,
    );
  const out: OptionScores = {};
  [...keys, NONE_KEY].forEach((o, i) => (out[o] = logprobsT1[i]));
  return out;
}
