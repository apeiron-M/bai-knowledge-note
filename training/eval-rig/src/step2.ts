/**
 * Step 2 on the GOLD op (temperature 0) for every single-action item with step-2 labels,
 * under one args patch level, against a running llama-server at LLAMA_URL.
 *   base: tree = repo @ rev,           opts = V1_ARGS                              (X3 lora-run / X6 base)
 *   x6:   tree = + x6-args-ship.patch, opts = patched V1_ARGS                      (X6 ship-v1 = X9 "ship")
 *   x9:   tree = + x9-args2.patch,     opts = patched V1_ARGS + today + currentLists
 *         + STATE_CHOICES merged into refCandidates                                 (X9 "combo" = the patch)
 * today = the item's own `today` (set's conventions.today; teacher rows: REPLAY_NOW).
 * Teacher-val state = fixture replayed with training/gen/replay.ts (X9 data.ts).
 * Scoring (X9 run.ts score()): held-out rows -> harness scoreArgRow, STRICT ok = exact !== false &&
 * refExact !== false, NORMALISED okN = same after trim/collapse/strip-trailing-[.!?,;:] of string
 * leaves of predicted and gold `args`; teacher rows -> canonical exact match with the teacher args.
 *
 *   RIG_LEVEL=x9 RIG_TREE=<trees>/x9 LLAMA_URL=... tsx --tsconfig $RIG_TREE/tsconfig.json step2.ts <items.jsonl> <out.jsonl> [ids,...]
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const LEVEL = process.env.RIG_LEVEL as "base" | "x6" | "x9";
if (!["base", "x6", "x9"].includes(LEVEL)) throw new Error(`RIG_LEVEL must be base|x6|x9, got ${LEVEL}`);
const TREE = process.env.RIG_TREE!;
const REPO = process.env.RIG_REPO ?? new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const CORE = `${TREE}/editors/knowledge-vault/chat/core`;
const LIB = new URL("../lib/lib.ts", import.meta.url).pathname;
const { fillArgsStep } = await import(`${CORE}/args-step.ts`);
const { buildRuntimeCatalog } = await import(`${CORE}/catalog-models.ts`);
const { V1_ARGS } = await import(`${CORE}/v1-pipeline.ts`);
const RC = LEVEL === "x9" ? await import(`${CORE}/ref-candidates.ts`) : null;
const { scoreArgRow } = await import(`${REPO}/spike/llm-harness/r6.ts`);
const { completeJson, scoreText, RateLimited } = await import(LIB);

const [itemsPath, outPath, onlyArg] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const items = readFileSync(itemsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .filter((i) => i.hasStep2 && i.gold && i.gold !== "none" && (!only || only.has(i.id)));
const done = new Set<string>();
if (existsSync(outPath)) for (const l of readFileSync(outPath, "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(l).id);

const catalog = buildRuntimeCatalog();
const byKey = new Map<string, any>(catalog.map((e: any) => [e.key, e]));

let replay: ((docType: string, fixture: unknown[]) => Record<string, unknown> | null) | null = null;
if (LEVEL === "x9" && items.some((i) => i.fixture)) {
  const { replayers, replayFixture, IdSource } = await import(`${REPO}/training/gen/replay.ts`);
  const reps = replayers();
  replay = (docType, fixture) => {
    const r = replayFixture(byKey, reps, docType, fixture, new IdSource());
    if (r.error) return null;
    const g = (r.doc.state as any)?.global;
    return g && typeof g === "object" ? (g as Record<string, unknown>) : null;
  };
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === null || x === undefined) continue;
      o[k] = canon(x);
    }
    return o;
  }
  return v;
}
const valExact = (got: unknown, want: unknown) => JSON.stringify(canon(got ?? null)) === JSON.stringify(canon(want ?? {}));
const normS = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "").trimEnd();
const norm = (v: any): any =>
  typeof v === "string" ? normS(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v;
function score(it: any, entry: any, args: any) {
  if (it.teacherArgs !== undefined && it.teacherArgs !== null && it.group === "val")
    return { ok: valExact(args, it.teacherArgs), okN: valExact(args && norm(args), norm(it.teacherArgs)) };
  const s = scoreArgRow(it, entry, { args });
  const n = scoreArgRow({ ...it, args: it.args === undefined || it.args === null ? it.args : norm(it.args) }, entry, { args: args && typeof args === "object" ? norm(args) : args });
  return { ok: s.exact !== false && s.refExact !== false, okN: n.exact !== false && n.refExact !== false, exact: s.exact ?? null, refExact: s.refExact ?? null, mismatched: s.mismatched ?? null };
}
function fnv(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

const cache = new Map();
let n = 0;
try {
  for (const it0 of items) {
    n++;
    if (done.has(it0.id)) continue;
    // harness scorer expects expectedOp; undefined (not null) for absent optional label fields
    const it: any = { ...it0, expectedOp: it0.gold };
    for (const k of ["args", "ambiguousArgs", "refArgs", "argMatch", "requiredPresent"]) if (it[k] === null) delete it[k];
    const entry = byKey.get(it.gold);
    if (!entry) throw new Error(`no catalog entry ${it.gold}`);
    const state = it.state ?? (replay && it.fixture ? replay(it.docType, it.fixture) : null);
    let rc = { ...it.refCandidates };
    const opts: any = { ...V1_ARGS, completeJson, scoreText, cache, alwaysOffer: [] };
    if (LEVEL === "x9") {
      if (state) {
        const extra = RC!.refCandidatesFor(it.gold, state, it.ctx ?? []);
        for (const p of Object.keys(RC!.STATE_CHOICES[it.gold] ?? {})) if (extra[p] && !(p in rc)) rc[p] = extra[p];
        opts.currentLists = RC!.currentListsFor(it.gold, state);
      }
      if (!it.today) throw new Error(`x9 needs a per-item today (conventions.today) for ${it.id}`);
      opts.today = it.today;
    }
    const t0 = performance.now();
    const s2 = await fillArgsStep(it.utterance, entry, rc, opts);
    const wallMs = Math.round(performance.now() - t0);
    const sc = score(it, entry, s2.args);
    const row = {
      id: it.id, set: it.set, level: LEVEL, op: it.gold, today: LEVEL === "x9" ? it.today : null, args: s2.args, raw: s2.raw ?? null,
      error: s2.error ?? null, dateFixed: s2.dateFixed ?? null, listsCompleted: s2.listsCompleted ?? [],
      promptHash: fnv(s2.messages?.[1]?.content ?? ""), wallMs, genMs: Math.round(s2.genMs ?? 0), refMs: Math.round(s2.refMs ?? 0), ...sc,
    };
    appendFileSync(outPath, JSON.stringify(row) + "\n");
    if (n % 25 === 0 || n === items.length) console.error(`step2[${LEVEL}] ${n}/${items.length}`);
  }
} catch (e) {
  if (e instanceof RateLimited) { console.error("STOP: 429", (e as Error).message); process.exit(3); }
  throw e;
}
