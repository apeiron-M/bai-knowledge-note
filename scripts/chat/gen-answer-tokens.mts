/**
 * Configuration C: canonical LFM2 token ids of every step-1 answer, plus the
 * native goldens the browser trie depends on. Run against a native
 * llama-server at the wllama pin (46ca246) serving the X5 LoRA with
 * `-c 4096 -np 1 --no-jinja`:
 *
 *   LLAMA_URL=http://127.0.0.1:<port> X5_GGUF=<path> \
 *     tsx scripts/chat/gen-answer-tokens.mts
 *
 * Writes
 * - editors/knowledge-vault/chat/core/answer-tokens.lfm2.json: ids + pieces of
 *   `forcedOpsText([key])` for every global catalog key and `{"ops": []}`
 *   (`/tokenize`, add_special false, parse_special false), each followed by
 *   `<|im_end|>` (7), with a tokenizer header the runtime checks;
 * - tests/fixtures/chat-c/template-goldens.json: `/apply-template` of the
 *   step-1 messages of one dev item per model (the renderLfm2Legacy golden);
 * - tests/fixtures/chat-c/retok-check.json: wllama only takes string prompts,
 *   so the trie appends answer pieces to the templated string. For every
 *   answer of every model and every prefix, tokenize(templated + pieces) must
 *   equal tokenize(templated) ++ prefix ids (Phase 0: 1,685 / 1,685).
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { forcedOpsText, NONE_KEY, scoringMessages, toOptions } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import { v1Catalog } from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const BASE = process.env.LLAMA_URL ?? "http://127.0.0.1:18761";
const GGUF =
  process.env.X5_GGUF ??
  `${REPO}/training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf`;
const IM_END = 7;
const BOS = 1;

interface TokenPiece {
  id: number;
  piece: string;
}

async function post(route: string, body: unknown): Promise<unknown> {
  const res = await fetch(BASE + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  return res.json();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function tokenize(content: string, special: boolean): Promise<number[]> {
  const r = await post("/tokenize", { content, add_special: false, parse_special: special });
  if (!isRecord(r) || !Array.isArray(r.tokens)) throw new Error("tokenize: no tokens");
  return r.tokens.map(Number);
}

async function tokenizePieces(content: string): Promise<TokenPiece[]> {
  const r = await post("/tokenize", {
    content,
    add_special: false,
    parse_special: false,
    with_pieces: true,
  });
  if (!isRecord(r) || !Array.isArray(r.tokens)) throw new Error("tokenize: no tokens");
  return r.tokens.map((t: unknown) => {
    if (!isRecord(t) || typeof t.id !== "number" || typeof t.piece !== "string")
      throw new Error("tokenize: bad piece");
    return { id: t.id, piece: t.piece };
  });
}

async function applyTemplate(messages: unknown): Promise<string> {
  const r = await post("/apply-template", { messages });
  if (!isRecord(r) || typeof r.prompt !== "string") throw new Error("apply-template: no prompt");
  return r.prompt;
}

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Tokenizer identity from the GGUF header (stdlib reader in the eval rig). */
function tokenizerMeta(path: string): { pre: string; nVocab: number; tokenizerSha: string } {
  const py = `
import hashlib, json, sys
sys.path.insert(0, ${JSON.stringify(`${REPO}/training/eval-rig/src`)})
from gguf_meta import read
kv = read(sys.argv[1])
h = hashlib.sha256()
h.update(json.dumps(kv["tokenizer.ggml.tokens"], ensure_ascii=False).encode())
h.update(json.dumps(kv.get("tokenizer.ggml.merges", []), ensure_ascii=False).encode())
print(json.dumps({"pre": kv["tokenizer.ggml.pre"], "nVocab": len(kv["tokenizer.ggml.tokens"]), "tokenizerSha": h.hexdigest()}))
`;
  const r = spawnSync("python3", ["-c", py, path], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`gguf meta: ${r.stderr}`);
  const v: unknown = JSON.parse(r.stdout);
  if (!isRecord(v) || typeof v.pre !== "string" || typeof v.nVocab !== "number" || typeof v.tokenizerSha !== "string")
    throw new Error("gguf meta: bad output");
  return { pre: v.pre, nVocab: v.nVocab, tokenizerSha: v.tokenizerSha };
}

// Special ids the trie hard-codes, derived from the served model.
{
  const im = await tokenize("<|im_end|>", true);
  if (im.length !== 1 || im[0] !== IM_END) throw new Error(`<|im_end|> is ${JSON.stringify(im)}, not ${IM_END}`);
  const r = await post("/tokenize", { content: "a", add_special: true, parse_special: false });
  if (!isRecord(r) || !Array.isArray(r.tokens) || r.tokens[0] !== BOS) throw new Error("BOS is not 1");
}

const catalog = v1Catalog();
const global = catalog.filter((e) => e.scope === "global");
const answers: Record<string, { ids: number[]; pieces: string[] }> = {};
for (const key of [...global.map((e) => e.key), NONE_KEY]) {
  const text = forcedOpsText(key === NONE_KEY ? [] : [key]);
  const toks = await tokenizePieces(text);
  if (toks.map((t) => t.piece).join("") !== text) throw new Error(`pieces != text for ${key}`);
  answers[key] = {
    ids: [...toks.map((t) => t.id), IM_END],
    pieces: [...toks.map((t) => t.piece), "<|im_end|>"],
  };
}

const meta = tokenizerMeta(GGUF);
const table = {
  description:
    "Canonical LFM2 token ids/pieces of every step-1 answer (forcedOpsText) + <|im_end|>; generated by scripts/chat/gen-answer-tokens.mts from native llama-server 46ca246 /tokenize.",
  tokenizer: {
    ggufFile: GGUF.slice(GGUF.lastIndexOf("/") + 1),
    ggufSha256: await fileSha256(GGUF),
    tokenizerSha: meta.tokenizerSha,
    pre: meta.pre,
    nVocab: meta.nVocab,
    bos: BOS,
    imEnd: IM_END,
  },
  answers,
};
writeFileSync(
  `${REPO}/editors/knowledge-vault/chat/core/answer-tokens.lfm2.json`,
  JSON.stringify(table, null, 1) + "\n",
);

// One dev item per model: template goldens and the string-prompt retokenisation check.
const items = readFileSync(`${REPO}/tests/fixtures/chat-c/items.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l): unknown => JSON.parse(l));
const firstPerType = new Map<string, { id: string; utterance: string }>();
for (const it of items) {
  if (!isRecord(it) || typeof it.docType !== "string" || typeof it.id !== "string" || typeof it.utterance !== "string")
    continue;
  if (!firstPerType.has(it.docType)) firstPerType.set(it.docType, { id: it.id, utterance: it.utterance });
}
const goldens: { id: string; docType: string; messages: unknown; prompt: string }[] = [];
let checks = 0;
const bad: unknown[] = [];
for (const [docType, it] of firstPerType) {
  const cands = catalog.filter((e) => e.docType === docType && e.scope === "global");
  const messages = scoringMessages(it.utterance, toOptions(cands, "key"), "ops");
  const prompt = await applyTemplate(messages);
  goldens.push({ id: it.id, docType, messages, prompt });
  const tIds = await tokenize(prompt, true);
  for (const key of [...cands.map((c) => c.key), NONE_KEY]) {
    const a = answers[key];
    for (let i = 0; i < a.ids.length; i++) {
      const got = await tokenize(prompt + a.pieces.slice(0, i).join(""), true);
      const want = [...tIds, ...a.ids.slice(0, i)];
      checks++;
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ docType, key, i });
    }
  }
}
writeFileSync(`${REPO}/tests/fixtures/chat-c/template-goldens.json`, JSON.stringify(goldens, null, 1) + "\n");
writeFileSync(
  `${REPO}/tests/fixtures/chat-c/retok-check.json`,
  JSON.stringify({ models: firstPerType.size, answers: Object.keys(answers).length, checks, bad }, null, 1) + "\n",
);
console.log(`answers ${Object.keys(answers).length}, models ${firstPerType.size}, retok checks ${checks}, bad ${bad.length}`);
if (bad.length) process.exit(1);
