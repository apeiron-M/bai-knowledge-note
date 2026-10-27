/**
 * LoRA step 1 (X3 / X7 C1 producer), against a running llama-server at LLAMA_URL.
 * Per item: R2c generation (step1Grammar over the scoped op list, catalog order,
 * top_logprobs 20, temperature 0) -> loraPick via step1Pick; then trie scoring
 * (frozen X3 lib.ts trieScore) of every scoped op + {"ops": []}, exact and branch.
 * Step-1 code always comes from the BASE tree (registered commit), whatever --args is.
 *
 *   RIG_TREE=<trees>/base LLAMA_URL=... tsx --tsconfig $RIG_TREE/tsconfig.json step1.ts <items.jsonl> <out.jsonl> [ids,...]
 * Resumable: rows already in <out.jsonl> are skipped.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const TREE = process.env.RIG_TREE!;
const CORE = `${TREE}/editors/knowledge-vault/chat/core`;
const LIB = new URL("../lib/lib.ts", import.meta.url).pathname;
const { forcedOpsText, NONE_KEY, scoringMessages, toOptions } = await import(`${CORE}/op-scorer.ts`);
const { step1Grammar, step1Pick } = await import(`${CORE}/step1-candidates.ts`);
const { v1Catalog } = await import(`${CORE}/v1-pipeline.ts`);
const { answerIds, generateWithLogprobs, post, promptIds, trieScore, BOS, IM_END, RateLimited } = await import(LIB);

const [itemsPath, outPath, onlyArg] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const items = readFileSync(itemsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((i) => !only || only.has(i.id));
const done = new Set<string>();
if (existsSync(outPath)) for (const l of readFileSync(outPath, "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(l).id);

// lib.ts hard-codes the LFM2 special ids (BOS 1, <|im_end|> 7). Derive them from the served model and refuse on mismatch.
{
  const im = (await post("/tokenize", { content: "<|im_end|>", add_special: false, parse_special: true })).tokens;
  const withB = (await post("/tokenize", { content: "a", add_special: true, parse_special: false })).tokens;
  const noB = (await post("/tokenize", { content: "a", add_special: false, parse_special: false })).tokens;
  const bos = withB.length > noB.length ? withB[0] : null;
  if (im.length !== 1 || im[0] !== IM_END || bos !== BOS)
    throw new Error(`special tokens differ from lib.ts (im_end ${JSON.stringify(im)} vs ${IM_END}, bos ${bos} vs ${BOS}): this LoRA base needs a parametrised trie scorer`);
}

const catalog = v1Catalog();
let n = 0;
try {
  for (const it of items) {
    n++;
    if (done.has(it.id)) continue;
    const cands = catalog.filter((e: any) => e.docType === it.docType && e.scope === "global");
    const keys: string[] = cands.map((c: any) => c.key);
    const messages = scoringMessages(it.utterance, toOptions(cands, "key"), "ops");
    const gen = await generateWithLogprobs(messages, step1Grammar(cands), 20);
    let parsed: unknown;
    try { parsed = JSON.parse(gen.text); } catch { parsed = undefined; }
    const pick = step1Pick(parsed, keys);
    const prompt = await promptIds(messages);
    const answers: { key: string; ids: number[] }[] = [];
    for (const k of [...keys, NONE_KEY]) answers.push({ key: k, ...(await answerIds(forcedOpsText(k === NONE_KEY ? [] : [k]))) });
    const exact = await trieScore(prompt, answers, "exact");
    const branch = await trieScore(prompt, answers, "branch");
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const rename = (k: string) => (k === NONE_KEY ? "none" : k);
    const row = {
      id: it.id, set: it.set, candidates: keys, noneKey: NONE_KEY,
      loraPick: pick ? rename(pick) : "none", genText: gen.text, genMs: Math.round(gen.wallMs),
      loraExact: Object.fromEntries(answers.map((a) => [rename(a.key), sum(exact.logprobs[a.key])])),
      loraBranch: Object.fromEntries(answers.map((a) => [rename(a.key), sum(branch.logprobs[a.key])])),
      floored: exact.floored + branch.floored, exactMs: Math.round(exact.ms), exactRequests: exact.requests,
    };
    appendFileSync(outPath, JSON.stringify(row) + "\n");
    if (n % 25 === 0 || n === items.length) console.error(`step1 ${n}/${items.length}`);
  }
} catch (e) {
  if (e instanceof RateLimited) { console.error("STOP: 429", (e as Error).message); process.exit(3); }
  throw e;
}
