/**
 * Node parity of configuration C's core modules against the committed dev
 * oracle (tests/fixtures/chat-c, held-out-3 + held-out-4 only), on native
 * llama-server at the wllama pin through server-backend.ts:
 *
 *   npm run chat:parity-c            # starts both servers on free ports
 *   LORA_URL=... KEV_URL=... npm run chat:parity-c   # or uses running ones
 *
 * Bars: step-1 pick identical; |d loraExact|, |d loraBranch| <= 1e-3 nat
 * (full run on fresh servers; 0.05 nat otherwise, see TRIE_TOL);
 * Kev |dp| <= 0.05 (reported, expected ~0 natively); gate decisions
 * identical in both trie modes, and decideOp (the shipped branch path)
 * identical to them; fillArgs on the gold op identical to args-x9 (args,
 * raw, dateFixed, listsCompleted); renderLfm2Legacy == /apply-template on
 * every item; string-prompt nextDist == token-id nextDist on 5 items; the
 * rig's evaluator on the new rows reproduces the stored dev-cv metrics.
 * Writes a summary + per-item diffs to $PARITY_OUT (default
 * $TMPDIR/parity-c), never into the repo. Exit 0 = PARITY OK, 1 = diffs,
 * 3 = a server returned 429.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { decideOp, fillArgs, scopedCandidates } from "../../editors/knowledge-vault/chat/core/c-pipeline.js";
import { fuseAndGate, kevScores, logT1 } from "../../editors/knowledge-vault/chat/core/fusion.js";
import { kevOptionProbs, kevRequest } from "../../editors/knowledge-vault/chat/core/kev-request.js";
import { renderLfm2Legacy } from "../../editors/knowledge-vault/chat/core/lfm2-template.js";
import { answersFor, trieScore } from "../../editors/knowledge-vault/chat/core/lora-trie.js";
import { C_ARTIFACTS } from "../../editors/knowledge-vault/chat/core/model-manifest.js";
import { NONE_KEY } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import {
  currentListsFor,
  refCandidatesFor,
  STATE_CHOICES,
  type RefContextItem,
} from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import { RateLimited, serverKev, serverLora, serverPost } from "../../editors/knowledge-vault/chat/core/server-backend.js";
import { runStep1, step1Messages, v1Catalog, type RefCandidates } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const FX = `${REPO}/tests/fixtures/chat-c`;
const OUT = process.env.PARITY_OUT ?? `${tmpdir()}/parity-c`;
const BIN = process.env.LLAMA_SERVER ?? `${process.env.HOME}/.cache/bai-training/llama.cpp/build/bin/llama-server`;
const ONLY = process.env.PARITY_ONLY ? new Set(process.env.PARITY_ONLY.split(",")) : null;
// The rig's values depend on llama-server's prompt-cache history (cache_prompt
// re-evaluates a different suffix batch): a fresh server replaying the rig's
// item order matches to ~1e-5 nat, any other history to ~0.015 nat (seen on
// moc3-08). The tight bar applies only to the full fresh-server run.
const FRESH_FULL = !ONLY && !process.env.LORA_URL;
const TRIE_TOL = Number(process.env.PARITY_TRIE_TOL ?? (FRESH_FULL ? 1e-3 : 0.05));
const KEV_TOL = 0.05;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const jsonl = (f: string): Rec[] =>
  readFileSync(f, "utf8").split("\n").filter(Boolean).map((l): unknown => JSON.parse(l)).filter(isRecord);
const numRec = (v: unknown): Record<string, number> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) : {};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isRecord(v)) {
    const o: Rec = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== null && v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/* ------------------------------ servers ------------------------------ */

const children: ChildProcess[] = [];
process.on("exit", () => children.forEach((c) => c.kill()));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function startServer(gguf: string, args: string[]): Promise<string> {
  const port = await freePort();
  mkdirSync(OUT, { recursive: true });
  const log = `${OUT}/${gguf.slice(gguf.lastIndexOf("/") + 1)}.log`;
  const fd = (await import("node:fs")).openSync(log, "w");
  const c = spawn(BIN, ["-m", gguf, "--port", String(port), "--host", "127.0.0.1", ...args], { stdio: ["ignore", fd, fd] });
  children.push(c);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    if (c.exitCode !== null) throw new Error(`llama-server exited, see ${log}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`llama-server did not come up, see ${log}`);
}

const loraUrl = process.env.LORA_URL ?? (await startServer(`${REPO}/training/artifacts/x5-350m/gguf/${C_ARTIFACTS.lora.fileName}`, ["-c", "4096", "-np", "1", "--no-jinja", "--no-webui"]));
const kevUrl = process.env.KEV_URL ?? (await startServer(`${REPO}/training/artifacts/kev-ft/gguf/${C_ARTIFACTS.kev.fileName}`, ["-c", "8192"]));
const lora = serverLora(loraUrl);
const kev = serverKev(kevUrl);

/* ------------------------------ fixtures ----------------------------- */

const items = jsonl(`${FX}/items.jsonl`).filter((i) => !ONLY || ONLY.has(String(i.id)));
const S1 = new Map(jsonl(`${FX}/step1.jsonl`).map((r) => [String(r.id), r]));
const KV = new Map(jsonl(`${FX}/kev.jsonl`).map((r) => [String(r.id), r]));
const A9 = new Map(jsonl(`${FX}/args-x9.jsonl`).map((r) => [String(r.id), r]));
const expected: unknown = JSON.parse(readFileSync(`${FX}/expected-decisions.json`, "utf8"));
function expectedGate(mode: "exact" | "branch"): Map<string, Rec> {
  const m = isRecord(expected) && isRecord(expected.modes) ? expected.modes[mode] : null;
  const ds = isRecord(m) && Array.isArray(m.decisions) ? m.decisions.filter(isRecord) : [];
  return new Map(ds.map((d) => [String(d.id), isRecord(d.gate) ? d.gate : {}]));
}
const EXP = { exact: expectedGate("exact"), branch: expectedGate("branch") };
const catalog = v1Catalog();
const byKey = new Map(catalog.map((e) => [e.key, e]));

/* ------------------------------- run --------------------------------- */

const diffs: Rec[] = [];
const newStep1: Rec[] = [];
const newKev: Rec[] = [];
const newArgs: Rec[] = [];
const stat = {
  items: 0, pickSame: 0, templateSame: 0, maxDExact: 0, maxDBranch: 0, maxDKevP: 0, maxDKevLogT1: 0,
  gate: { exact: [0, 0], branch: [0, 0], decideOp: [0, 0] }, args: [0, 0], argsAppRefs: [0, 0],
  forced: 0, floored: 0, dumpErrors: 0, stringVsIds: { items: 0, maxD: 0, missing: 0 },
};
const t0 = performance.now();
try {
  for (const it of items) {
    const id = String(it.id);
    const docType = String(it.docType);
    const utterance = String(it.utterance);
    const s1 = S1.get(id);
    const k1 = KV.get(id);
    if (!s1 || !k1) throw new Error(`fixture rows missing for ${id}`);
    stat.items++;
    const cands = scopedCandidates(catalog, docType);
    const keys = cands.map((c) => c.key);
    const messages = step1Messages(utterance, cands);
    const templated = renderLfm2Legacy(messages);
    const applied = await serverPost(loraUrl, "/apply-template", { messages });
    if (applied.prompt === templated) stat.templateSame++;
    else diffs.push({ id, what: "template" });

    // step 1
    const st = await runStep1(utterance, cands, lora.completeJson);
    const pick = st.pick === NONE_KEY ? "none" : st.pick;
    if (pick === s1.loraPick) stat.pickSame++;
    else diffs.push({ id, what: "loraPick", got: pick, want: s1.loraPick });

    // trie, both modes
    const answers = answersFor(keys);
    const ex = await trieScore(lora, templated, answers, "exact");
    const br = await trieScore(lora, templated, answers, "branch");
    for (const r of [ex, br]) {
      stat.forced += r.forced;
      stat.floored += r.floored;
      stat.dumpErrors += r.dumpErrors;
    }
    const wantEx = numRec(s1.loraExact);
    const wantBr = numRec(s1.loraBranch);
    for (const o of [...keys, "none"]) {
      const dE = Math.abs(ex.sums[o] - wantEx[o]);
      const dB = Math.abs(br.sums[o] - wantBr[o]);
      stat.maxDExact = Math.max(stat.maxDExact, Number.isFinite(dE) ? dE : Infinity);
      stat.maxDBranch = Math.max(stat.maxDBranch, Number.isFinite(dB) ? dB : Infinity);
      if (!(dE <= TRIE_TOL) || !(dB <= TRIE_TOL)) diffs.push({ id, what: "trie", o, dE, dB });
    }

    // Kev
    const req = kevRequest(utterance, cands);
    const probs = kevOptionProbs(req, await kev.systemOne(req.body));
    const k1one = isRecord(k1.oneStage) ? k1.oneStage : {};
    const wantP = Array.isArray(k1one.probs) ? k1one.probs.map(Number) : [];
    const wantL = Array.isArray(k1one.logprobsT1) ? k1one.logprobsT1.map(Number) : [];
    const lt = logT1(probs, C_ARTIFACTS.kev.servedT ?? 1);
    probs.forEach((p, i) => {
      stat.maxDKevP = Math.max(stat.maxDKevP, Math.abs(p - wantP[i]));
      stat.maxDKevLogT1 = Math.max(stat.maxDKevLogT1, Math.abs(lt[i] - wantL[i]));
    });
    if (probs.some((p, i) => !(Math.abs(p - wantP[i]) <= KEV_TOL))) diffs.push({ id, what: "kev" });

    newStep1.push({ id, set: it.set, candidates: keys, noneKey: NONE_KEY, loraPick: pick, loraExact: ex.sums, loraBranch: br.sums, floored: ex.floored + br.floored });
    newKev.push({ id, set: it.set, candidates: [...keys, "__none__"], servedT: C_ARTIFACTS.kev.servedT, oneStage: { probs, logprobsT1: lt } });

    // gate decisions (single rows only), both modes, plus the shipped decideOp
    if (it.gold !== null) {
      const kevLp = kevScores(keys, lt);
      for (const [mode, sums] of [["exact", ex.sums], ["branch", br.sums]] as const) {
        const want = EXP[mode].get(id);
        const got = pick === "none" ? { pick: "none", asked: false, offered: [] } : (() => {
          const d = fuseAndGate(keys, sums, kevLp);
          return { pick: d.pick, asked: d.asked, offered: d.offered };
        })();
        stat.gate[mode][1]++;
        if (same(got, want)) stat.gate[mode][0]++;
        else diffs.push({ id, what: `gate-${mode}`, got, want });
      }
      const d = await decideOp(utterance, docType, { catalog, lora, kev: () => Promise.resolve(kev) }, { trieMode: "branch" });
      const got = d.kind === "none" ? { pick: "none", asked: false, offered: [] } : { pick: d.pick.key, asked: d.asked, offered: d.offered.map((e) => e.key) };
      stat.gate.decideOp[1]++;
      if (same(got, EXP.branch.get(id)) && (d.kind === "none" || d.config === "C")) stat.gate.decideOp[0]++;
      else diffs.push({ id, what: "decideOp", got, want: EXP.branch.get(id) });
    }

    // step 2 on the gold op (rig step2.ts at x9)
    const gold = typeof it.gold === "string" ? it.gold : null;
    if (it.hasStep2 === true && gold && gold !== "none") {
      const entry = byKey.get(gold);
      if (!entry) throw new Error(`no catalog entry ${gold}`);
      const state = isRecord(it.state) ? it.state : {};
      const ctx: RefContextItem[] = Array.isArray(it.ctx)
        ? it.ctx.filter(isRecord).map((c) => ({ id: String(c.id), title: String(c.title), kind: String(c.kind) }))
        : [];
      const rc: RefCandidates = {};
      if (isRecord(it.refCandidates))
        for (const [p, cs] of Object.entries(it.refCandidates))
          rc[p] = (Array.isArray(cs) ? cs.filter(isRecord) : []).map((c) => ({
            id: String(c.id),
            label: typeof c.label === "string" ? c.label : null,
          }));
      const extra = refCandidatesFor(gold, state, ctx);
      for (const p of Object.keys(STATE_CHOICES[gold] ?? {})) if (p in extra && !(p in rc)) rc[p] = extra[p];
      const fctx = { today: String(it.today), currentLists: currentListsFor(gold, state), cache: new Map() };
      const s2 = await fillArgs(utterance, entry, lora, { ...fctx, refCandidates: rc });
      const want = A9.get(id);
      const row = { args: s2.args, raw: s2.raw ?? null, dateFixed: s2.dateFixed ?? null, listsCompleted: s2.listsCompleted ?? [] };
      newArgs.push({ id, ...row });
      stat.args[1]++;
      if (want && same(row.args, want.args) && row.raw === want.raw && row.dateFixed === (want.dateFixed ?? null) && same(row.listsCompleted, want.listsCompleted ?? []))
        stat.args[0]++;
      else diffs.push({ id, what: "args", got: row, want: want && { args: want.args, raw: want.raw, dateFixed: want.dateFixed, listsCompleted: want.listsCompleted } });
      // the tab's path: refCandidatesFor alone (descriptive, not a bar)
      const app = await fillArgs(utterance, entry, lora, { ...fctx, refCandidates: refCandidatesFor(gold, state, ctx) });
      stat.argsAppRefs[1]++;
      if (want && same(app.args, want.args)) stat.argsAppRefs[0]++;
    }
    if (stat.items % 25 === 0) console.error(`parity ${stat.items}/${items.length}`);
  }

  // string prompt vs token-id prompt (the rig's route) on 5 items
  for (const it of items.slice(0, 5)) {
    const cands = scopedCandidates(catalog, String(it.docType));
    const messages = step1Messages(String(it.utterance), cands);
    const templated = renderLfm2Legacy(messages);
    const tok = await serverPost(loraUrl, "/tokenize", { content: templated, add_special: false, parse_special: true });
    const ids = [1, ...strs(tok.tokens).map(Number)];
    const a = await lora.nextDist(templated, 64);
    const res = await serverPost(loraUrl, "/completion", { prompt: ids, n_predict: 1, temperature: 0, n_probs: 64, cache_prompt: true, return_tokens: false });
    const cp: unknown = Array.isArray(res.completion_probabilities) ? res.completion_probabilities[0] : null;
    const tops = isRecord(cp) && Array.isArray(cp.top_logprobs) ? cp.top_logprobs.filter(isRecord) : [];
    stat.stringVsIds.items++;
    for (const t of tops) {
      const v = a.lp.get(Number(t.id));
      if (v === undefined) stat.stringVsIds.missing++;
      else stat.stringVsIds.maxD = Math.max(stat.stringVsIds.maxD, Math.abs(v - Number(t.logprob)));
    }
  }
} catch (e) {
  if (e instanceof RateLimited) {
    console.error("STOP: 429", e.message);
    process.exit(3);
  }
  throw e;
}

/* --------------------- the rig's evaluator on new rows ---------------- */

mkdirSync(`${OUT}/run`, { recursive: true });
const w = (f: string, rows: Rec[]) => writeFileSync(`${OUT}/run/${f}`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(`${OUT}/run/items.jsonl`, readFileSync(`${FX}/items.jsonl`));
w("step1.jsonl", newStep1);
w("kev.jsonl", newKev);
// args ok/okN come from the rig's scorer; reuse the stored ones when the args are identical
w("args-x9.jsonl", newArgs.map((r) => {
  const want = A9.get(String(r.id));
  const ok = want && same(r.args, want.args);
  return { ...r, ok: ok ? want.ok : false, okN: ok ? want.okN : false };
}));
let metricsSame: boolean | null = null;
if (!ONLY) {
  const py = spawnSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(`${REPO}/training/eval-rig/src`)})
import evaluate as ev
rows, missing, levels = ev.assemble(${JSON.stringify(`${OUT}/run`)})
res = ev.evaluate(rows, 1.63, 4.0, levels)
print(json.dumps(res["configs"]["gate"]))
`], { encoding: "utf8" });
  if (py.status !== 0) throw new Error(py.stderr);
  const got: unknown = JSON.parse(py.stdout);
  const want = isRecord(expected) && isRecord(expected.modes) && isRecord(expected.modes.exact) ? expected.modes.exact.metrics : null;
  metricsSame = same(got, want);
  if (!metricsSame) diffs.push({ what: "metrics", got, want });
}

const ok =
  stat.pickSame === stat.items && stat.templateSame === stat.items && stat.maxDExact <= TRIE_TOL && stat.maxDBranch <= TRIE_TOL &&
  stat.maxDKevP <= KEV_TOL && stat.gate.exact[0] === stat.gate.exact[1] && stat.gate.branch[0] === stat.gate.branch[1] &&
  stat.gate.decideOp[0] === stat.gate.decideOp[1] && stat.args[0] === stat.args[1] && stat.floored === 0 &&
  stat.stringVsIds.missing === 0 && metricsSame !== false;
const summary = { ok, ms: Math.round(performance.now() - t0), loraUrl, kevUrl, tolerances: { trieNat: TRIE_TOL, kevP: KEV_TOL }, metricsSame, ...stat, diffs: diffs.length };
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
writeFileSync(`${OUT}/diffs.json`, JSON.stringify(diffs, null, 1));
console.log(JSON.stringify(summary));
console.log(ok ? "PARITY OK" : `PARITY FAILED: ${diffs.length} diffs in ${OUT}/diffs.json`);
process.exit(ok ? 0 : 1);
