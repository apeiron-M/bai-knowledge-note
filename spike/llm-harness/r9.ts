/**
 * Round 9 configs R0–R5 (definitions: results doc, "Round 9"
 * pre-registration). Round 8's C3 pipeline with the candidate list, the
 * no-action pre-gate and the step-2 gate made configurable. Step 1 always
 * runs, so the gated and ungated picks come from the same model calls;
 * `preGate` only decides which one is the config's pick (and its latency).
 */
import { fillArgsStep } from "../../editors/knowledge-vault/chat/core/args-step.js";
import type { LlmClient } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  combinedNoAction,
  embeddingGateScore,
  looksLikeQuestion,
} from "../../editors/knowledge-vault/chat/core/no-action-gate.js";
import {
  NONE_KEY,
  scoringMessages,
  toOptions,
  type ScoreCache,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { PROMPT_FORMAT_VERSION } from "../../editors/knowledge-vault/chat/core/prompt-format.js";
import {
  step1Candidates,
  step1CandidatesLabel,
  type Step1Candidates,
} from "../../editors/knowledge-vault/chat/core/step1-candidates.js";
import {
  loadV1Runtime,
  V1_ARGS,
} from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import { step1Grammar } from "./r8.js";
import { count, fullyRight, r9MissCause, r9Pick } from "./r9-metrics.js";
import {
  loadR6,
  scoreArgRow,
  splits,
  summarizeArgs,
  type R6Set,
} from "./r6.js";

type Json = Record<string, unknown>;

export interface R9Options {
  /** Config name for the results file, e.g. "R0". */
  name: string;
  sets: R6Set[];
  cands: Step1Candidates;
  /** The G3 no-action gate in front of step 1 (round 8: on). */
  preGate: boolean;
  /** Step-2 fields the safe gate never drops (fix 4). */
  alwaysOffer?: string[];
  /** Informational: which GGUF the caller loaded. */
  model: string;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]);
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((1000 * n) / d) / 10;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function status(text: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function opsPick(parsed: unknown, keys: string[]): string | null {
  if (!isRecord(parsed) || !Array.isArray(parsed.ops)) return null;
  const ops: unknown[] = parsed.ops;
  if (ops.length === 0) return NONE_KEY;
  const k = ops[0];
  return typeof k === "string" && keys.includes(k) ? k : null;
}

export async function r9Run(c: LlmClient, o: R9Options): Promise<Json> {
  const runtime = await loadV1Runtime();
  const cache: ScoreCache = new Map();
  const byKey = new Map(runtime.catalog.map((e) => [e.key, e]));
  const items = [];
  for (const s of o.sets) items.push(...(await loadR6(s)));
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r9 ${o.name} ${n + 1}/${items.length}`);
    const t0 = performance.now();
    const q = await runtime.embedQuery(it.utterance);
    const embedMs = performance.now() - t0;
    const scopedHits = runtime.index.rankOps(q, it.docType);
    const score = embeddingGateScore(
      runtime.index.exemplarSims(q),
      scopedHits.map((h) => h.score),
    );
    const gated =
      combinedNoAction(it.utterance, score) || scopedHits.length === 0;
    const cands = step1Candidates(o.cands, {
      scopedHits,
      unscopedHits: () => runtime.index.rankOps(q),
      catalog: runtime.catalog,
      docType: it.docType,
    });
    const keys = cands.map((x) => x.key);
    const t1 = performance.now();
    const r = await c.completeJson(
      scoringMessages(it.utterance, toOptions(cands, "key"), "ops"),
      { kind: "grammar", grammar: step1Grammar(cands) },
      { temperature: 0, maxTokens: 64 },
    );
    const loraPick = opsPick(r.parsed, keys);
    const opMs = performance.now() - t1;
    const gold = it.expectedOp;
    const row: Json = {
      id: it.id,
      set: it.set,
      style: it.style ?? null,
      difficulty: it.difficulty ?? null,
      utterance: it.utterance,
      expectedOp: gold,
      expectedOps: it.expectedOps ?? null,
      candidates: keys,
      goldRank: gold ? keys.indexOf(gold) + 1 || null : null,
      inList: gold ? keys.includes(gold) : null,
      gate: {
        score,
        question: looksLikeQuestion(it.utterance),
        noAction: gated,
      },
      step1Raw: r.text,
      loraPick,
    };
    let argsMs = 0;
    if (loraPick && loraPick !== NONE_KEY) {
      const entry = byKey.get(loraPick);
      if (!entry) throw new Error(`${it.id}: unknown pick ${loraPick}`);
      const s2 = await fillArgsStep(
        it.utterance,
        entry,
        it.refCandidates ?? {},
        {
          completeJson: c.completeJson,
          scoreText: c.scoreText,
          cache,
          ...V1_ARGS,
          alwaysOffer: o.alwaysOffer ?? [],
        },
      );
      argsMs = s2.refMs + s2.genMs;
      row.args = s2.args;
      row.raw = s2.raw;
      row.argsError = s2.error ?? null;
      row.argsOrder = Object.keys(
        isRecord(s2.schema.properties) ? s2.schema.properties : {},
      );
      if (loraPick === gold)
        Object.assign(row, scoreArgRow(it, entry, { args: s2.args }));
    }
    row.ms = {
      embed: Math.round(embedMs),
      op: Math.round(opMs),
      args: Math.round(argsMs),
      ungated: Math.round(embedMs + opMs + argsMs),
      gated: Math.round(embedMs + (gated ? 0 : opMs + argsMs)),
    };
    rows.push(row);
  }
  const out: Json = {
    summary: r9Summary(rows, o.preGate),
    rows,
    config: { ...o, candsLabel: step1CandidatesLabel(o.cands) },
    promptFormat: PROMPT_FORMAT_VERSION,
    model: c.info.model,
    backend: c.info.backend,
  };
  // R1 is R0 without the gate: same model calls, other pick.
  if (o.preGate) out.summaryUngated = r9Summary(rows, false);
  return out;
}

export function r9Summary(rows: Json[], preGate: boolean): Json {
  const pick = (r: Json) => r9Pick(r, preGate);
  const ms = (r: Json) =>
    (r.ms as Record<string, number>)[preGate ? "gated" : "ungated"];
  const group = (rs: Json[]): Json => {
    const action = rs.filter((r) => r.expectedOp);
    const na = rs.filter((r) => !r.expectedOp && !r.expectedOps);
    const multi = rs.filter((r) => Array.isArray(r.expectedOps));
    const right = action.filter((r) => pick(r) === r.expectedOp);
    const tp = na.filter((r) => pick(r) === NONE_KEY).length;
    const fp = action.filter((r) => pick(r) === NONE_KEY).length;
    const inList = action.filter((r) => r.inList);
    const misses = action
      .map((r) => r9MissCause(r, preGate))
      .filter((m): m is string => m !== null);
    const lat = rs.filter((r) => !r.expectedOps).map(ms);
    const argsMisses: string[] = [];
    for (const r of right) {
      if (r.exact !== false) continue;
      for (const f of (r.mismatched as string[] | undefined) ?? [])
        argsMisses.push(`${String(r.expectedOp)}.${f}`);
      for (const f of (r.extras as string[] | undefined) ?? [])
        argsMisses.push(`${String(r.expectedOp)}.${f} (extra)`);
    }
    return {
      n: rs.length,
      action: action.length,
      opAcc: `${right.length}/${action.length}`,
      opAccPct: pct(right.length, action.length),
      opByStyle: splits(action, (r) => pick(r) === r.expectedOp),
      recallList: `${inList.length}/${action.length}`,
      opAccGivenInList: `${inList.filter((r) => pick(r) === r.expectedOp).length}/${inList.length}`,
      listLen: {
        median: quantile(
          action.map((r) => (r.candidates as string[]).length),
          0.5,
        ),
      },
      args: summarizeArgs(right),
      fullyRight: `${action.filter((r) => fullyRight(r, preGate)).length}/${action.length}`,
      fullyRightPct: pct(
        action.filter((r) => fullyRight(r, preGate)).length,
        action.length,
      ),
      fullyRightByStyle: splits(action, (r) => fullyRight(r, preGate)),
      noAction: {
        tp,
        fn: na.length - tp,
        fp,
        precision: pct(tp, tp + fp),
        recall: pct(tp, na.length),
      },
      multiAction: {
        n: multi.length,
        firstInExpected: `${multi.filter((r) => (r.expectedOps as string[]).includes(String(pick(r)))).length}/${multi.length}`,
        firstIsExpectedFirst: `${multi.filter((r) => (r.expectedOps as string[])[0] === pick(r)).length}/${multi.length}`,
        none: multi.filter((r) => pick(r) === NONE_KEY).length,
      },
      latency: { median: quantile(lat, 0.5), p90: quantile(lat, 0.9) },
      misses: count(misses),
      confusions: count(
        action
          .filter((r) => r9MissCause(r, preGate) === "sibling in list")
          .map((r) => `${String(r.expectedOp)} -> ${String(pick(r))}`),
      ),
      argsMisses: count(argsMisses),
    };
  };
  const bySet: Json = {};
  const sets = [...new Set(rows.map((r) => String(r.set)))];
  for (const s of sets) bySet[s] = group(rows.filter((r) => r.set === s));
  const fold: Record<string, string[]> = {
    heldout3: ["h3", "h3na", "h3multi"],
    dev: ["dev", "devx", "devna"],
  };
  for (const [name, members] of Object.entries(fold))
    if (members.some((m) => sets.includes(m)))
      bySet[name] = group(rows.filter((r) => members.includes(String(r.set))));
  return { preGate, bySet };
}
