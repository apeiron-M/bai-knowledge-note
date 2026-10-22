/**
 * Round 8 configs C0–C3 and oracle-op args (definitions: results doc,
 * "Round 8" pre-registration). C2/C3 run step 1 on gated items too, so the
 * LoRA-only no-action variant comes from the same run; latency counts only
 * what the gated pipeline needs. Caches are per run: content-free scores
 * depend on the model, and the cache key does not name it.
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
  pickFromRequests,
  scoreOptions,
  scoringMessages,
  toOptions,
  type ScoreCache,
} from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { PROMPT_FORMAT_VERSION } from "../../editors/knowledge-vault/chat/core/prompt-format.js";
import { step1Grammar } from "../../editors/knowledge-vault/chat/core/step1-candidates.js";
import {
  loadV1Runtime,
  runV1,
  V1_ARGS,
} from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import qaPrompts from "./eval/r8-qa-prompts.json" with { type: "json" };
import {
  loadR6,
  scoreArgRow,
  splits,
  summarizeArgs,
  type R6Item,
  type R6Set,
} from "./r6.js";

type Json = Record<string, unknown>;

export type R8Config = "C0" | "C1" | "C2" | "C3" | "A";

export interface R8Options {
  config: R8Config;
  sets: R6Set[];
  /** C2/C3: candidates = gte-small's scoped top k. */
  k?: number;
  /** Informational: which GGUF the caller loaded ("base" | "lora"). */
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

function status(text: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Moved to the chat core (the v1 default runs it); re-exported for round 9.
export { step1Grammar };

/** The op key in a parsed `{"ops": [...]}` answer, NONE_KEY for `[]`. */
function opsPick(parsed: unknown, keys: string[]): string | null {
  if (!isRecord(parsed) || !Array.isArray(parsed.ops)) return null;
  const ops: unknown[] = parsed.ops;
  if (ops.length === 0) return NONE_KEY;
  const k = ops[0];
  return typeof k === "string" && keys.includes(k) ? k : null;
}

async function loadSets(sets: R6Set[]): Promise<R6Item[]> {
  const out: R6Item[] = [];
  for (const s of sets) out.push(...(await loadR6(s)));
  return out;
}

export async function r8Run(c: LlmClient, o: R8Options): Promise<Json> {
  const runtime = await loadV1Runtime();
  const cache: ScoreCache = new Map(); // args ref scoring, content-free
  const items = (await loadSets(o.sets)).filter((i) => !i.expectedOps);
  const byKey = new Map(runtime.catalog.map((e) => [e.key, e]));
  const k = o.k ?? 5;
  const rows: Json[] = [];
  for (const [n, it] of items.entries()) {
    status(`r8 ${o.config} ${n + 1}/${items.length}`);
    const row: Json = {
      id: it.id,
      set: it.set,
      style: it.style ?? null,
      difficulty: it.difficulty ?? null,
      utterance: it.utterance,
      expectedOp: it.expectedOp,
    };
    const refs = () => it.refCandidates ?? {};
    const t0 = performance.now();
    if (o.config === "C0" || o.config === "C1") {
      const r = await runV1(it.utterance, it.docType, refs, {
        runtime,
        completeJson: c.completeJson,
        scoreText: c.scoreText,
        cache,
      });
      const pick = r.kind === "action" ? r.entry.key : NONE_KEY;
      Object.assign(row, {
        candidates: r.hits.slice(0, 5).map((h) => h.entry.key),
        gate: r.gate,
        pick,
        ms: {
          embed: Math.round(r.embedMs),
          op: 0,
          args:
            r.kind === "action"
              ? Math.round(r.step2.refMs + r.step2.genMs)
              : 0,
          total: Math.round(performance.now() - t0),
        },
      });
      if (r.kind === "action") {
        row.args = r.step2.args;
        row.raw = r.step2.raw;
        row.argsError = r.step2.error ?? null;
        if (pick === it.expectedOp)
          Object.assign(row, scoreArgRow(it, r.entry, { args: r.step2.args }));
      }
      rows.push(row);
      continue;
    }
    if (o.config === "A") {
      if (!it.expectedOp) continue;
      const entry = byKey.get(it.expectedOp);
      if (!entry) throw new Error(`${it.id}: unknown op ${it.expectedOp}`);
      const s2 = await fillArgsStep(it.utterance, entry, refs(), {
        completeJson: c.completeJson,
        scoreText: c.scoreText,
        cache,
        ...V1_ARGS,
      });
      Object.assign(row, {
        pick: it.expectedOp,
        args: s2.args,
        raw: s2.raw,
        argsError: s2.error ?? null,
        genMs: Math.round(s2.genMs),
        refMs: Math.round(s2.refMs),
        ms: { total: Math.round(performance.now() - t0) },
        ...scoreArgRow(it, entry, { args: s2.args }),
      });
      rows.push(row);
      continue;
    }
    // C2 / C3
    const q = await runtime.embedQuery(it.utterance);
    const embedMs = performance.now() - t0;
    const hits = runtime.index.rankOps(q, it.docType);
    const score = embeddingGateScore(
      runtime.index.exemplarSims(q),
      hits.map((h) => h.score),
    );
    const gated = combinedNoAction(it.utterance, score) || hits.length === 0;
    const cands = hits.slice(0, k).map((h) => h.entry);
    const keys = cands.map((x) => x.key);
    const t1 = performance.now();
    let loraPick: string | null;
    const variants: Record<string, string | null> = {};
    if (o.config === "C2") {
      const reqs = await scoreOptions(it.utterance, cands, {
        scoreText: c.scoreText,
        style: "key",
        offsets: [0],
        contentFree: true,
        includeNone: true,
        format: "ops",
        // No cache: the list differs per utterance (as round 6's U-configs).
      });
      const all = [...keys, NONE_KEY];
      const s2 = pickFromRequests(reqs, all, {
        aggregate: "mean",
        calibrated: true,
        offsets: [0],
      });
      const s1 = pickFromRequests(reqs, all, {
        aggregate: "mean",
        calibrated: false,
        offsets: [0],
      });
      loraPick = s2.key;
      variants["S2-mean+none"] = s2.key;
      variants["S1-mean+none"] = s1.key;
      variants["S2-mean"] = pickFromRequests(reqs, keys, {
        aggregate: "mean",
        calibrated: true,
        offsets: [0],
      }).key;
      row.opScores = s2.scores;
      row.opScoresRaw = s1.scores;
    } else {
      const r = await c.completeJson(
        scoringMessages(it.utterance, toOptions(cands, "key"), "ops"),
        { kind: "grammar", grammar: step1Grammar(cands) },
        { temperature: 0, maxTokens: 64 },
      );
      loraPick = opsPick(r.parsed, keys);
      row.step1Raw = r.text;
      variants.gen = loraPick;
    }
    const opMs = performance.now() - t1;
    const pick = gated ? NONE_KEY : loraPick;
    Object.assign(row, {
      candidates: keys,
      inTopK: it.expectedOp ? keys.includes(it.expectedOp) : null,
      gate: { score, question: looksLikeQuestion(it.utterance), noAction: gated },
      loraPick,
      variants,
      pick,
    });
    let argsMs = 0;
    if (loraPick && loraPick !== NONE_KEY) {
      const entry = byKey.get(loraPick);
      if (!entry) throw new Error(`${it.id}: unknown pick ${loraPick}`);
      const s2 = await fillArgsStep(it.utterance, entry, refs(), {
        completeJson: c.completeJson,
        scoreText: c.scoreText,
        cache,
        ...V1_ARGS,
      });
      argsMs = s2.refMs + s2.genMs;
      row.args = s2.args;
      row.raw = s2.raw;
      row.argsError = s2.error ?? null;
      if (loraPick === it.expectedOp)
        Object.assign(row, scoreArgRow(it, entry, { args: s2.args }));
    }
    row.ms = {
      embed: Math.round(embedMs),
      op: gated ? 0 : Math.round(opMs),
      args: gated ? 0 : Math.round(argsMs),
      total: Math.round(embedMs + (gated ? 0 : opMs + argsMs)),
      opUngated: Math.round(opMs),
      argsUngated: Math.round(argsMs),
    };
    rows.push(row);
  }
  return { summary: summarize(o, c, rows), rows };
}

/** Fully right: right op, plus exact args and refs where scored. */
function fullyRight(r: Json, pickKey = "pick"): boolean {
  if (r[pickKey] !== r.expectedOp) return false;
  return r.exact !== false && r.refExact !== false;
}

function summarize(o: R8Options, c: LlmClient, rows: Json[]): Json {
  const bySet: Json = {};
  const sets = [...new Set(rows.map((r) => String(r.set)))];
  const group = (name: string, rs: Json[]): Json => {
    const action = rs.filter((r) => r.expectedOp);
    const na = rs.filter((r) => !r.expectedOp);
    const right = action.filter((r) => r.pick === r.expectedOp);
    const tp = na.filter((r) => r.pick === NONE_KEY).length;
    const fp = action.filter((r) => r.pick === NONE_KEY).length;
    const lat = rs.map((r) => (r.ms as Record<string, number>).total);
    const g: Json = {
      n: rs.length,
      action: action.length,
      opAcc: `${right.length}/${action.length}`,
      opAccPct: pct(right.length, action.length),
      args: summarizeArgs(right),
      fullyRight: `${action.filter((r) => fullyRight(r)).length}/${action.length}`,
      noAction: {
        tp,
        fn: na.length - tp,
        fp,
        precision: pct(tp, tp + fp),
        recall: pct(tp, na.length),
      },
      latency: { median: quantile(lat, 0.5), p90: quantile(lat, 0.9) },
      opByStyle: splits(action, (r) => r.pick === r.expectedOp),
      fullyRightByStyle: splits(action, (r) => fullyRight(r)),
    };
    if (o.config === "C2" || o.config === "C3") {
      const inK = action.filter((r) => r.inTopK);
      g.recallTopK = `${inK.length}/${action.length}`;
      g.opAccGivenInTopK = `${inK.filter((r) => r.pick === r.expectedOp).length}/${inK.length}`;
      const lora = (r: Json) => r.loraPick;
      const ltp = na.filter((r) => lora(r) === NONE_KEY).length;
      const lfp = action.filter((r) => lora(r) === NONE_KEY).length;
      g.loraOnly = {
        opAcc: `${action.filter((r) => lora(r) === r.expectedOp).length}/${action.length}`,
        fullyRight: `${action.filter((r) => fullyRight(r, "loraPick")).length}/${action.length}`,
        noAction: {
          tp: ltp,
          fp: lfp,
          precision: pct(ltp, ltp + lfp),
          recall: pct(ltp, na.length),
        },
      };
      const vnames = Object.keys((rs[0]?.variants as Json | undefined) ?? {});
      g.variants = Object.fromEntries(
        vnames.map((v) => [
          v,
          `${action.filter((r) => (r.variants as Json)[v] === r.expectedOp).length}/${action.length}`,
        ]),
      );
    }
    bySet[name] = g;
    return g;
  };
  for (const s of sets) group(s, rows.filter((r) => r.set === s));
  // Held-out sets with their no-action items folded in.
  const fold: Record<string, string[]> = {
    heldout1: ["h1", "h1na"],
    heldout2: ["h2", "h2na"],
    dev: ["dev", "devx", "devna"],
  };
  for (const [name, members] of Object.entries(fold))
    if (members.some((m) => sets.includes(m)))
      group(name, rows.filter((r) => members.includes(String(r.set))));
  return {
    config: o,
    promptFormat: PROMPT_FORMAT_VERSION,
    model: c.info.model,
    backend: c.info.backend,
    n: rows.length,
    bySet,
  };
}

/* ------------------------------------------------------------------ */
/* Q&A regression check                                                 */
/* ------------------------------------------------------------------ */

/** The Chat tab's answer-path system prompt (`use-chat-llm.ts`). */
const ASK_SYSTEM = "You are a concise assistant inside a personal knowledge vault.";

interface QaPrompt {
  id: string;
  context: string;
  question: string;
}

/**
 * 15 hand-written vault questions with a short retrieved context, under
 * the Chat tab's answer system prompt; temperature 0, 256 tokens, so base
 * and LoRA see identical settings.
 */
export async function r8Qa(c: LlmClient): Promise<Json> {
  const rows: Json[] = [];
  for (const p of qaPrompts as QaPrompt[]) {
    status(`r8 qa ${p.id}`);
    const r = await c.chatStream(
      [
        { role: "system", content: ASK_SYSTEM },
        {
          role: "user",
          content: `Context from the vault:\n${p.context}\n\nQuestion: ${p.question}`,
        },
      ],
      { maxTokens: 256, temperature: 0, seed: 42 },
    );
    rows.push({
      id: p.id,
      answer: r.text,
      finishReason: r.finishReason,
      wallMs: Math.round(r.wallMs),
      looksLikeJson: /^\s*[[{]/.test(r.text) || /\{"\w+":/.test(r.text),
    });
  }
  return { model: c.info.model, system: ASK_SYSTEM, rows };
}
