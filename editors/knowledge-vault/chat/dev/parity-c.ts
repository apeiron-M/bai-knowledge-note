/**
 * Dev-only in-browser parity of configuration C: runs the shipped core on
 * the wllama backends over 20 dev items (held-out-3/4) and compares with
 * the rig's stored native outputs. Bars (accepted for WebGPU vs Metal):
 * identical gate decisions and step-2 args, Kev |dp| <= 0.05, median trie
 * |d| <= 0.08 nat. Exposed as `window.__baiChatParityC()` behind the debug
 * flag; see `installParityC`.
 */
import { fillArgs, scopedCandidates } from "../core/c-pipeline.js";
import type { KevBackend, LoraBackend } from "../core/decision-backend.js";
import { fuseAndGate, kevScores, logT1 } from "../core/fusion.js";
import { kevOptionProbs, kevRequest } from "../core/kev-request.js";
import { renderLfm2Legacy } from "../core/lfm2-template.js";
import { answersFor, trieScore, type TrieMode } from "../core/lora-trie.js";
import { C_ARTIFACTS, C_FUSION } from "../core/model-manifest.js";
import { NONE_KEY } from "../core/op-scorer.js";
import {
  currentListsFor,
  refCandidatesFor,
  STATE_CHOICES,
} from "../core/ref-candidates.js";
import {
  runStep1,
  step1Messages,
  v1Catalog,
  type RefCandidates,
} from "../core/v1-pipeline.js";

export const PARITY_BARS = { kevDp: 0.05, loraMedianNat: 0.08, knifeEdge: 0.02 } as const;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);
const numRec = (v: unknown): Record<string, number> =>
  isRecord(v)
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))
    : {};

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isRecord(v)) {
    const o: Rec = {};
    for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b)))
      if (v[k] !== null && v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : Number.NaN;
};

export interface ParityDeps {
  lora: LoraBackend;
  kev: KevBackend;
}

export interface ParityItemResult {
  id: string;
  pickSame: boolean;
  /** null for no-action rows (decided by step 1). */
  gateSame: boolean | null;
  /** The stored fused margin is within 0.02 of tau. */
  knifeEdge: boolean;
  margin: { browser: number | null; stored: number | null };
  medianDLora: number;
  maxDLora: number;
  maxDKevP: number;
  argsSame: boolean | null;
  trie: { requests: number; forced: number; floored: number; dumpErrors: number };
  ms: { step1: number; trie: number; kev: number; args: number };
  error?: string;
}

export interface ParityReport {
  mode: TrieMode;
  items: ParityItemResult[];
  summary: {
    n: number;
    picksSame: number;
    gateSame: number;
    gateTotal: number;
    argsSame: number;
    argsTotal: number;
    medianDLora: number;
    maxDLora: number;
    maxDKevP: number;
    errors: number;
    pass: boolean;
  };
}

async function loadItems(): Promise<Rec[]> {
  const mod = await import("./parity-c-items-asset.js");
  const raw: unknown = mod.default;
  return isRecord(raw) && Array.isArray(raw.items) ? raw.items.filter(isRecord) : [];
}

async function runItem(
  it: Rec,
  deps: ParityDeps,
  mode: TrieMode,
): Promise<ParityItemResult> {
  const stored = isRecord(it.stored) ? it.stored : {};
  const id = String(it.id);
  const utterance = String(it.utterance);
  const catalog = v1Catalog();
  const cands = scopedCandidates(catalog, String(it.docType));
  const keys = cands.map((c) => c.key);
  const servedT = C_ARTIFACTS.kev.servedT ?? 1;

  const st = await runStep1(utterance, cands, deps.lora.completeJson);
  const pick = st.pick === NONE_KEY ? "none" : st.pick;

  const t1 = performance.now();
  const trie = await trieScore(
    deps.lora,
    renderLfm2Legacy(step1Messages(utterance, cands)),
    answersFor(keys),
    mode,
  );
  const trieMs = performance.now() - t1;
  const want = numRec(mode === "exact" ? stored.loraExact : stored.loraBranch);
  const dl = [...keys, "none"].map((o) => Math.abs(trie.sums[o] - want[o]));

  const t2 = performance.now();
  const req = kevRequest(utterance, cands);
  const probs = kevOptionProbs(req, await deps.kev.systemOne(req.body));
  const kevMs = performance.now() - t2;
  const wantP = nums(stored.kevProbs);
  const maxDKevP = Math.max(...probs.map((p, i) => Math.abs(p - wantP[i])));

  const gates = isRecord(stored.gate) ? stored.gate : {};
  const wantGate = gates[mode];
  let gateSame: boolean | null = null;
  let margin: ParityItemResult["margin"] = { browser: null, stored: null };
  if (it.gold !== null && isRecord(wantGate)) {
    if (pick === "none") gateSame = same({ pick: "none", asked: false, offered: [] }, wantGate);
    else {
      const d = fuseAndGate(keys, trie.sums, kevScores(keys, logT1(probs, servedT)));
      const ref = fuseAndGate(keys, want, kevScores(keys, logT1(wantP, servedT)));
      margin = { browser: d.margin, stored: ref.margin };
      gateSame = same({ pick: d.pick, asked: d.asked, offered: d.offered }, wantGate);
    }
  }

  let argsSame: boolean | null = null;
  const t3 = performance.now();
  const gold = typeof it.gold === "string" ? it.gold : null;
  const entry = gold ? catalog.find((e) => e.key === gold) : undefined;
  if (it.hasStep2 === true && entry && isRecord(stored.args)) {
    const state = isRecord(it.state) ? it.state : {};
    const rc: RefCandidates = {};
    if (isRecord(it.refCandidates))
      for (const [p, cs] of Object.entries(it.refCandidates))
        rc[p] = (Array.isArray(cs) ? cs.filter(isRecord) : []).map((c) => ({
          id: String(c.id),
          label: typeof c.label === "string" ? c.label : null,
        }));
    const extra = refCandidatesFor(entry.key, state, []);
    for (const p of Object.keys(STATE_CHOICES[entry.key] ?? {}))
      if (p in extra && !(p in rc)) rc[p] = extra[p];
    const s2 = await fillArgs(utterance, entry, deps.lora, {
      refCandidates: rc,
      today: String(it.today),
      currentLists: currentListsFor(entry.key, state),
      cache: new Map(),
    });
    const w = stored.args;
    argsSame =
      same(s2.args, w.args) &&
      (s2.raw ?? null) === w.raw &&
      (s2.dateFixed ?? null) === (w.dateFixed ?? null) &&
      same(s2.listsCompleted ?? [], w.listsCompleted ?? []);
  }
  return {
    id,
    pickSame: pick === stored.loraPick,
    gateSame,
    knifeEdge:
      margin.stored !== null && Math.abs(margin.stored - C_FUSION.tau) < PARITY_BARS.knifeEdge,
    margin,
    medianDLora: median(dl),
    maxDLora: Math.max(...dl),
    maxDKevP,
    argsSame,
    trie: {
      requests: trie.requests,
      forced: trie.forced,
      floored: trie.floored,
      dumpErrors: trie.dumpErrors,
    },
    ms: { step1: st.ms, trie: trieMs, kev: kevMs, args: performance.now() - t3 },
  };
}

/** Run the check; per-item failures are reported, not thrown. */
export async function runParityC(
  deps: ParityDeps,
  opts: { mode?: TrieMode; onProgress?: (done: number, total: number) => void } = {},
): Promise<ParityReport> {
  const mode = opts.mode ?? "branch";
  const items = await loadItems();
  const out: ParityItemResult[] = [];
  for (const it of items) {
    try {
      out.push(await runItem(it, deps, mode));
    } catch (err) {
      out.push({
        id: String(it.id),
        pickSame: false,
        gateSame: false,
        knifeEdge: false,
        margin: { browser: null, stored: null },
        medianDLora: Number.NaN,
        maxDLora: Number.NaN,
        maxDKevP: Number.NaN,
        argsSame: null,
        trie: { requests: 0, forced: 0, floored: 0, dumpErrors: 0 },
        ms: { step1: 0, trie: 0, kev: 0, args: 0 },
        error: err instanceof Error ? err.message : String(err),
      });
    }
    opts.onProgress?.(out.length, items.length);
  }
  const ok = out.filter((r) => !r.error);
  const gated = out.filter((r) => r.gateSame !== null);
  const withArgs = out.filter((r) => r.argsSame !== null);
  const summary = {
    n: out.length,
    picksSame: out.filter((r) => r.pickSame).length,
    gateSame: gated.filter((r) => r.gateSame).length,
    gateTotal: gated.length,
    argsSame: withArgs.filter((r) => r.argsSame).length,
    argsTotal: withArgs.length,
    medianDLora: median(ok.map((r) => r.medianDLora)),
    maxDLora: Math.max(...ok.map((r) => r.maxDLora)),
    maxDKevP: Math.max(...ok.map((r) => r.maxDKevP)),
    errors: out.length - ok.length,
  };
  return {
    mode,
    items: out,
    summary: {
      ...summary,
      pass:
        summary.errors === 0 &&
        summary.gateSame === summary.gateTotal &&
        summary.argsSame === summary.argsTotal &&
        summary.maxDKevP <= PARITY_BARS.kevDp &&
        summary.medianDLora <= PARITY_BARS.loraMedianNat,
    },
  };
}

declare global {
  interface Window {
    __baiChatParityC?: (mode?: TrieMode) => Promise<ParityReport>;
  }
}

/** Expose `window.__baiChatParityC()` (the debug flag gates the caller). */
export function installParityC(getDeps: () => Promise<ParityDeps>): void {
  if (typeof window === "undefined") return;
  window.__baiChatParityC = async (mode) =>
    runParityC(await getDeps(), {
      mode,
      onProgress: (d, n) => console.info(`[parity-c] ${d}/${n}`),
    });
}
