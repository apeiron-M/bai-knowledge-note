// X4: zero-shot System One deciders over the R2c scoped op list (+ none).
// Usage:
//   node decide.mjs --runtime kev06 --variant desc --wording W1 --items a.json,b.json --out x.jsonl
//   node decide.mjs --runtime server --port 18731 --decider julia1 --variant name ...
// Per item, two calls (timed separately):
//   A  one-stage: choice over scoped ops + none
//   B  two-stage: noul "changes the document?" + choice over scoped ops only (one request)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, xs) => {
    if (a.startsWith("--")) acc.push([a.slice(2), xs[i + 1]]);
    return acc;
  }, []),
);
const runtime = args.runtime; // kev06 | server
const variant = args.variant; // name | desc
const wording = args.wording ?? "W1";
const decider = args.decider ?? (runtime === "kev06" ? "kev06" : "server");
const descField = args.descField ?? "override"; // override | spec
const items = args.items.split(",").flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
const limit = args.limit ? Number(args.limit) : Infinity;
const catalog = JSON.parse(readFileSync(path.join(root, "data/catalog.json"), "utf8"));
const byKey = new Map(catalog.map((c) => [c.key, c]));

const NONE = "__none__";
const human = (s) => s.toLowerCase().replace(/[_-]+/g, " ");

const WORDINGS = {
  W1: {
    state: (it) => `Request: ${it.utterance}`,
    instr: (it) => `Which operation should be applied to this ${human(it.model)} document to carry out the request?`,
    noneName: "none",
    noneDesc: "No operation: the request is a question or asks for no change to the document.",
    noul: (it) => `The request asks to change the ${human(it.model)} document (not just to answer a question about it).`,
  },
  W2: {
    state: (it) => `Document: a ${human(it.model)} document.\nUser request: ${it.utterance}`,
    instr: () => "Which document operation does the user's request ask for?",
    noneName: "answer a question",
    noneDesc: "The user asks a question or wants information; nothing in the document changes.",
    noul: () => "The user wants something in the document to be changed, added or removed.",
  },
  W3: {
    state: (it) => `Request: ${it.utterance}`,
    instr: (it) => `Which operation should be applied to this ${human(it.model)} document to carry out the request?`,
    noneName: "answer a question",
    noneDesc: "The user only asks a question about the document or wants information; no operation is applied.",
    noul: (it) => `The user wants something in the ${human(it.model)} document to be changed, added or removed.`,
  },
};
const W = WORDINGS[wording];

function optionsFor(it, withNone) {
  const opts = it.candidates.map((k) => {
    const c = byKey.get(k);
    const name = human(c.opName);
    const desc = descField === "spec" ? (c.specDescription || null) : c.override;
    // "short": the first sentence only (for Julia-1's 256-token head budget)
    const short = desc ? desc.split(/(?<=\.)\s/)[0].replace(/\.$/, "") : null;
    return { key: k, name, desc: variant === "desc" ? desc : variant === "short" ? short : null };
  });
  if (withNone) opts.push({ key: NONE, name: W.noneName, desc: variant === "desc" || variant === "short" ? W.noneDesc : null });
  return opts;
}

/* ----------------------------- runtimes ----------------------------- */

let decideChoice; // (state, [{instr, opts}], noulInstr|null) -> {choices:[probs[]], noul:p|null}
let servedT = 1;
if (runtime === "kev06") {
  const { env } = await import("@huggingface/transformers");
  const { OpenJev } = await import("open-jev");
  env.allowRemoteModels = false;
  env.localModelPath = path.join(root, "models") + "/";
  const t0 = performance.now();
  const jev = await OpenJev.load({ model: args.model ?? "kev06-onnx", dtype: args.dtype ?? "q4", device: args.device ?? "cpu" });
  console.error(`kev06 loaded in ${Math.round(performance.now() - t0)} ms`);
  decideChoice = async (state, qs, noulInstr) => {
    const questions = qs.map((q) => ({
      type: "choice",
      instructions: q.instr,
      options: q.opts.map((o) => o.name),
      descriptions: Object.fromEntries(q.opts.filter((o) => o.desc).map((o) => [o.name, o.desc])),
    }));
    if (noulInstr) questions.unshift({ type: "noul", instructions: noulInstr });
    const ans = await jev.decide(state, questions, { temperature: 1 });
    const noul = noulInstr ? ans.shift().probability : null;
    return { choices: ans.map((a, i) => qs[i].opts.map((o) => a.probabilities[o.name])), noul };
  };
} else {
  const url = `http://127.0.0.1:${args.port}/v1/systemone`;
  servedT = Number(args.servedT ?? 1);
  // Julia/laya renders the description *instead of* the key, so put the name into it.
  const textInDesc = args.textInDesc === "1";
  decideChoice = async (state, qs, noulInstr) => {
    const questions = {};
    if (noulInstr) questions.chg = { type: "noul", instructions: noulInstr };
    qs.forEach((q, i) => {
      questions[`q${i}`] = {
        type: "choice",
        instructions: q.instr,
        criteria: Object.fromEntries(
          q.opts.map((o) => [o.name, textInDesc ? (o.desc ? `${o.name}: ${o.desc}` : o.name) : o.desc]),
        ),
      };
    });
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, questions }) });
    if (res.status === 429) { console.error("HTTP 429, stopping"); process.exit(3); }
    const j = await res.json();
    if (!j.answers) throw new Error(JSON.stringify(j).slice(0, 400));
    return {
      choices: qs.map((q, i) => q.opts.map((o) => j.answers[`q${i}`].probabilities[o.name])),
      noul: noulInstr ? j.answers.chg.noul : null,
      inputTokens: j.usage?.input_tokens,
    };
  };
}

/* ------------------------------- run -------------------------------- */

const logT1 = (probs, T) => {
  // served probs = softmax(z / T)  ->  log softmax(z) with z = T log p (+const)
  const z = probs.map((p) => T * Math.log(Math.max(p, 1e-300)));
  const m = Math.max(...z);
  const lse = m + Math.log(z.reduce((s, x) => s + Math.exp(x - m), 0));
  return z.map((x) => x - lse);
};
const argmax = (xs) => xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);

if (existsSync(args.out)) writeFileSync(args.out, "");
// warm-up (not timed)
{
  const it = items[0];
  await decideChoice(W.state(it), [{ instr: W.instr(it), opts: optionsFor(it, true) }], null);
}
let n = 0;
for (const it of items) {
  if (n++ >= limit) break;
  const state = W.state(it);
  const optsA = optionsFor(it, true);
  const tA = performance.now();
  const A = await decideChoice(state, [{ instr: W.instr(it), opts: optsA }], null);
  const msA = performance.now() - tA;
  const optsB = optionsFor(it, false);
  const tB = performance.now();
  const B = await decideChoice(state, [{ instr: W.instr(it), opts: optsB }], W.noul(it));
  const msB = performance.now() - tB;
  const keysA = optsA.map((o) => o.key);
  const pA = A.choices[0];
  const pB = B.choices[0];
  const pChange = B.noul;
  // two-stage combined distribution over ops + none
  const p2 = [...pB.map((p) => p * pChange), 1 - pChange];
  const row = {
    id: it.id, set: it.set, fold: it.fold, style: it.style, difficulty: it.difficulty, tags: it.tags,
    decider, variant, wording, descField,
    expectedOp: it.expectedOp, expectedOps: it.expectedOps,
    candidates: keysA, // catalog order, NONE last
    servedT,
    oneStage: { probs: pA, logprobsT1: logT1(pA, servedT), pick: keysA[argmax(pA)], ms: Math.round(msA) },
    twoStage: {
      pChange, opProbs: pB, opLogprobsT1: logT1(pB, servedT),
      probs: p2, pick: pChange < 0.5 ? NONE : keysA[argmax(pB)], ms: Math.round(msB),
    },
  };
  appendFileSync(args.out, JSON.stringify(row) + "\n");
  if (n % 25 === 0) console.error(`${decider} ${variant} ${n}/${items.length}`);
}
console.error("done", n);
