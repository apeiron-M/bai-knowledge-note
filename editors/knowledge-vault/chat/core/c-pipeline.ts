/**
 * Configuration C: X5 LoRA step 1 + trie scores, fused with Kev-FT's
 * option probabilities, margin-gated (ask with the top 3), then X9 step 2
 * on the chosen op. Arm A (the LoRA's own pick, never asking) is the
 * fallback whenever Kev is off, unavailable or fails for the turn.
 */
import { fillArgsStep, type ArgsStepResult } from "./args-step.js";
import type { KevBackend, LoraBackend } from "./decision-backend.js";
import { fuseAndGate, kevScores, logT1, type OptionScores } from "./fusion.js";
import { kevOptionProbs, kevRequest } from "./kev-request.js";
import { renderLfm2Legacy } from "./lfm2-template.js";
import type { CurrentList } from "./list-completion.js";
import { answersFor, trieScore, type TrieMode } from "./lora-trie.js";
import { C_ARTIFACTS, C_FUSION, type FusionParams } from "./model-manifest.js";
import type { CatalogEntry } from "./op-catalog.js";
import { NONE_KEY, type ScoreCache } from "./op-scorer.js";
import {
  runStep1,
  step1Messages,
  V1_ARGS,
  type RefCandidates,
  type V1Step1Result,
} from "./v1-pipeline.js";

export type CConfig = "C" | "A";

/** Why a turn ran as arm A. */
export type KevFallback =
  | { reason: "off" }
  | { reason: "unavailable"; detail: string }
  | { reason: "failed"; detail: string }
  | { reason: "skipped" };

export interface CDeps {
  /** The runtime catalog (`v1Catalog()`). */
  catalog: CatalogEntry[];
  lora: LoraBackend;
  /**
   * Kev, loaded on first need; null when off. A rejection means Kev is
   * unavailable and the turn runs as arm A.
   */
  kev: (() => Promise<KevBackend>) | null;
  /** Why `kev` is null (default "off"). */
  kevOff?: KevFallback;
}

export interface DecideOptions {
  /** Default "branch" (the shipped deviation); "exact" as registered. */
  trieMode?: TrieMode;
  params?: FusionParams;
  /** Kev's served choice temperature (manifest default). */
  servedT?: number;
  /** Resolves when the user chooses not to wait for Kev this turn. */
  skipKev?: Promise<unknown>;
  onStage?: (stage: "choose" | "score" | "wait-kev") => void;
}

export interface DecideTimings {
  step1Ms: number;
  kevMs: number | null;
  trieMs: number | null;
  totalMs: number;
}

export interface TrieStats {
  requests: number;
  forced: number;
  floored: number;
  dumpErrors: number;
}

export type DecideResult =
  | {
      kind: "none";
      step1: V1Step1Result;
      timings: DecideTimings;
      /** Whether Kev's System One call was made (never: none skips it). */
      kevCalled: false;
    }
  | {
      kind: "op";
      config: CConfig;
      step1: V1Step1Result;
      /** The ops chosen among, in catalog order. */
      candidates: CatalogEntry[];
      pick: CatalogEntry;
      /** The LoRA's own step-1 pick (arm A's answer). */
      loraPick: CatalogEntry;
      asked: boolean;
      /** Fused top 3 when asked, best first. */
      offered: CatalogEntry[];
      /** Fused probability per option (C only). */
      p: OptionScores | null;
      margin: number | null;
      scores: {
        lora: OptionScores | null;
        kevProbs: number[] | null;
        kev: OptionScores | null;
      };
      fallback: KevFallback | null;
      trie: TrieStats | null;
      timings: DecideTimings;
    };

type KevOutcome =
  | { ok: true; probs: number[]; ms: number }
  | { ok: false; fallback: KevFallback };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The scoped candidates step 1 and Kev choose among (catalog order). */
export function scopedCandidates(
  catalog: CatalogEntry[],
  docType: string,
): CatalogEntry[] {
  return catalog.filter((e) => e.docType === docType && e.scope === "global");
}

/**
 * Choose the op for `utterance` on a `docType` document. Kev's load starts
 * at once (first need), but its call waits for step 1: a step-1
 * `{"ops": []}` decides no-action without Kev (rig `decide`), otherwise
 * the call runs in parallel with the trie.
 */
export async function decideOp(
  utterance: string,
  docType: string,
  deps: CDeps,
  opts: DecideOptions = {},
): Promise<DecideResult> {
  const t0 = performance.now();
  const cands = scopedCandidates(deps.catalog, docType);
  if (cands.length === 0) throw new Error(`no operations for ${docType}`);
  const keys = cands.map((c) => c.key);
  const servedT = opts.servedT ?? C_ARTIFACTS.kev.servedT ?? 1;

  type Loaded = { ok: true; backend: KevBackend } | { ok: false; fallback: KevFallback };
  const kevLoad: Promise<Loaded> | null = deps.kev
    ? deps.kev().then(
        (backend): Loaded => ({ ok: true, backend }),
        (err: unknown): Loaded => ({
          ok: false,
          fallback: { reason: "unavailable", detail: errText(err) },
        }),
      )
    : null;

  opts.onStage?.("choose");
  const step1 = await runStep1(utterance, cands, deps.lora.completeJson);
  if (step1.pick === NONE_KEY)
    return {
      kind: "none",
      step1,
      kevCalled: false,
      timings: { step1Ms: step1.ms, kevMs: null, trieMs: null, totalMs: performance.now() - t0 },
    };
  const kevP: Promise<KevOutcome> | null = kevLoad
    ? (async (): Promise<KevOutcome> => {
        const loaded = await kevLoad;
        if (!loaded.ok) return loaded;
        const req = kevRequest(utterance, cands);
        try {
          const tk = performance.now();
          const res = await loaded.backend.systemOne(req.body);
          return { ok: true, probs: kevOptionProbs(req, res), ms: performance.now() - tk };
        } catch (err) {
          return { ok: false, fallback: { reason: "failed", detail: errText(err) } };
        }
      })()
    : null;
  const loraPick = cands.find((c) => c.key === step1.pick);
  if (!loraPick) throw new Error(`unknown step-1 pick ${step1.pick}`);

  const armA = (
    fallback: KevFallback,
    extra: { lora?: OptionScores | null; trie?: TrieStats | null; trieMs?: number | null } = {},
  ): DecideResult => ({
    kind: "op",
    config: "A",
    step1,
    candidates: cands,
    pick: loraPick,
    loraPick,
    asked: false,
    offered: [],
    p: null,
    margin: null,
    scores: { lora: extra.lora ?? null, kevProbs: null, kev: null },
    fallback,
    trie: extra.trie ?? null,
    timings: {
      step1Ms: step1.ms,
      kevMs: null,
      trieMs: extra.trieMs ?? null,
      totalMs: performance.now() - t0,
    },
  });
  if (!kevP) return armA(deps.kevOff ?? { reason: "off" });

  opts.onStage?.("score");
  const tt = performance.now();
  const trie = await trieScore(
    deps.lora,
    renderLfm2Legacy(step1Messages(utterance, cands)),
    answersFor(keys),
    opts.trieMode ?? "branch",
  );
  const trieMs = performance.now() - tt;
  const stats: TrieStats = {
    requests: trie.requests,
    forced: trie.forced,
    floored: trie.floored,
    dumpErrors: trie.dumpErrors,
  };

  opts.onStage?.("wait-kev");
  const skip: Promise<KevOutcome> | null = opts.skipKev
    ? opts.skipKev.then((): KevOutcome => ({ ok: false, fallback: { reason: "skipped" } }))
    : null;
  const kev = await (skip ? Promise.race([kevP, skip]) : kevP);
  if (!kev.ok) return armA(kev.fallback, { lora: trie.sums, trie: stats, trieMs });

  const kevLp = kevScores(keys, logT1(kev.probs, servedT));
  const d = fuseAndGate(keys, trie.sums, kevLp, opts.params ?? C_FUSION);
  const byKey = new Map(cands.map((c) => [c.key, c]));
  const entry = (k: string) => {
    const e = byKey.get(k);
    if (!e) throw new Error(`unknown fused pick ${k}`);
    return e;
  };
  return {
    kind: "op",
    config: "C",
    step1,
    candidates: cands,
    pick: entry(d.pick),
    loraPick,
    asked: d.asked,
    offered: d.offered.map(entry),
    p: d.p,
    margin: d.margin,
    scores: { lora: trie.sums, kevProbs: kev.probs, kev: kevLp },
    fallback: null,
    trie: stats,
    timings: { step1Ms: step1.ms, kevMs: kev.ms, trieMs, totalMs: performance.now() - t0 },
  };
}

export interface FillArgsContext {
  /** The document's labeled ref candidates for `entry`, by dotted path. */
  refCandidates: RefCandidates;
  /** Today's local date, `YYYY-MM-DD` (X9 date fields). */
  today: string;
  /** The document's current lists for `entry` (X9 list completion). */
  currentLists: Record<string, CurrentList>;
  cache?: ScoreCache;
}

/** Step 2 (X6 + X9) on a chosen op: the rig's step2.ts call at level x9. */
export function fillArgs(
  utterance: string,
  entry: CatalogEntry,
  lora: Pick<LoraBackend, "completeJson" | "scoreText">,
  ctx: FillArgsContext,
): Promise<ArgsStepResult> {
  return fillArgsStep(utterance, entry, ctx.refCandidates, {
    ...V1_ARGS,
    completeJson: lora.completeJson,
    scoreText: lora.scoreText,
    cache: ctx.cache,
    alwaysOffer: [],
    today: ctx.today,
    currentLists: ctx.currentLists,
  });
}
