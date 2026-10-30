/**
 * Configuration C: expected gate decisions on the committed dev oracle.
 *
 *   npx tsx scripts/chat/c-expected.mts           # compare with the committed file
 *   npx tsx scripts/chat/c-expected.mts --write   # rewrite it
 *
 * Reads tests/fixtures/chat-c/{items,step1,kev,args-x9}.jsonl (rig outputs on
 * held-out-3 + held-out-4, dev only) and runs the rig's evaluator (nl-eval's
 * `assemble`, `decide` and `evaluate`) at the shipped temperatures (m2bv x
 * Kev-FT dev-cv fit; X5's were 1.63 / 4.0) T_L 1.887 / T_K 4.0, once on the
 * exact trie scores (loraExact, as registered) and once on the branch-only
 * trie scores (loraBranch substituted for loraExact, the shipped default).
 * Writes tests/fixtures/chat-c/expected-decisions.json: per
 * single-action/no-action row the LoRA pick, the fused pick, the gate (pick,
 * asked, offered in order) and the fused p over opts, plus the evaluator's
 * dev-cv metrics for both modes (the exact-mode block must equal the rig's
 * results.json dev-cv block).
 *
 * Until M5 this was c-expected.py over the old rig's evaluate.py, which wrote
 * the committed file. This port gives the same JSON on it (the comparison
 * mode checks it; p values within 1e-12).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assemble, decide, evaluate, lsm, X7_GATE, type EvalRow } from "nl-eval";

const FX = new URL("../../tests/fixtures/chat-c/", import.meta.url).pathname;
const OUT = `${FX}expected-decisions.json`;
const TL = 1.887;
const TK = 4.0;

function fusedP(r: EvalRow): Record<string, number> {
  const L = lsm(r.loraExact, TL);
  const K = lsm(r.kev ?? {}, TK);
  const s = Object.fromEntries(r.opts.map((o) => [o, X7_GATE.wLora * L[o] + X7_GATE.wKev * K[o]]));
  const m = Math.max(...Object.values(s));
  const Z = Object.values(s).reduce((a, v) => a + Math.exp(v - m), 0);
  return Object.fromEntries(r.opts.map((o) => [o, Math.exp(s[o] - m) / Z]));
}

const { rows, missing, levels } = assemble(FX);
if (missing.length) throw new Error(`missing rows: ${missing.join(", ")}`);
type Dec = {
  id: string;
  gold: string | null;
  loraPick: string;
  fusedPick: string;
  gate: { pick: string; asked: boolean; offered: string[] };
  p?: Record<string, number>;
};
const out: { temps: object; tau: number; kOffer: number; modes: Record<string, unknown>; exactVsBranchGateIdentical?: string } = {
  temps: { T_lora: TL, T_kev: TK },
  tau: X7_GATE.tau,
  kOffer: X7_GATE.k,
  modes: {},
};
const decisions: Record<string, Dec[]> = {};
for (const mode of ["exact", "branch"] as const) {
  const rs = rows.map((r) => ({ ...r, loraExact: mode === "exact" ? r.loraExact : r.loraBranch }));
  const dec: Dec[] = [];
  for (const r of rs.filter((x) => !x.multi)) {
    const d = decide(r, TL, TK);
    const [lora, fused, gate] = [d.lora, d.lora_x_kev, d.gate];
    if (!lora || !fused || !gate) throw new Error(`${r.id}: no Kev row`);
    const e: Dec = {
      id: r.id,
      gold: r.gold,
      loraPick: lora[0],
      fusedPick: fused[0],
      gate: { pick: gate[0], asked: gate[1], offered: gate[2] },
    };
    if (r.loraPick !== "none") e.p = fusedP(r);
    dec.push(e);
  }
  const res = evaluate(rs, TL, TK, levels);
  decisions[mode] = dec;
  out.modes[mode] = { decisions: dec, metrics: res.configs.gate, argsOnGold: res.argsOnGold };
}
const [ex, br] = [decisions.exact, decisions.branch];
const same = ex.filter((a, i) => JSON.stringify(a.gate) === JSON.stringify(br[i].gate)).length;
out.exactVsBranchGateIdentical = `${same}/${ex.length}`;

/** Deep equality; numbers within `tol` (the p values: Python's exp against V8's). */
function close(a: unknown, b: unknown, tol: number, path: string, diffs: string[]): void {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > tol) diffs.push(`${path}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}: length ${a.length} vs ${b.length}`);
    else a.forEach((x, i) => close(x, b[i], tol, `${path}[${i}]`, diffs));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) diffs.push(`${path}: keys ${ka.join(",")} vs ${kb.join(",")}`);
    else for (const k of ka) close((a as never)[k], (b as never)[k], tol, `${path}.${k}`, diffs);
  } else if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

const g = (out.modes.exact as { metrics: { all: { op: number; eff_x9_norm: number }; ask: number; wrongDispatch: number } }).metrics;
console.log(
  `rows ${ex.length}; exact gate op ${g.all.op} ask ${g.ask} wrong ${g.wrongDispatch} eff ${g.all.eff_x9_norm}; ` +
    `exact vs branch gate identical ${out.exactVsBranchGateIdentical}`,
);
if (process.argv.includes("--write")) {
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`wrote ${OUT}`);
} else {
  const diffs: string[] = [];
  close(JSON.parse(JSON.stringify(out)), JSON.parse(readFileSync(OUT, "utf8")), 1e-12, "$", diffs);
  console.log(diffs.length ? `DIFFERS from ${OUT}:\n${diffs.slice(0, 20).join("\n")}` : `equals ${OUT}`);
  process.exit(diffs.length ? 1 : 0);
}
