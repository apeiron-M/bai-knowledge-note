/**
 * Mean pairwise gte-small cosine within groups of utterances, on the
 * browser's wasm numerics (`scripts/gte-wasm-node.ts`). Used by
 * `training/py/batchcmp.py` as a diversity measure (lower = more diverse).
 *
 *   npx --no-install tsx training/gen/pairwise-similarity.ts <in.json> <out.json>
 *
 * in: {"<group>": ["utterance", ...], ...}
 * out: {"<group>": {"n": number, "meanCosine": number | null}, ...}
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadNodeWasmEmbedder } from "../../scripts/gte-wasm-node.js";

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a));
}

async function main(): Promise<void> {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) throw new Error("usage: pairwise-similarity.ts <in.json> <out.json>");
  const groups = JSON.parse(readFileSync(inFile, "utf8")) as Record<string, string[]>;
  const { embed } = await loadNodeWasmEmbedder();
  const out: Record<string, { n: number; meanCosine: number | null }> = {};
  for (const [name, texts] of Object.entries(groups)) {
    const vecs: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 32) vecs.push(...(await embed(texts.slice(i, i + 32))));
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < vecs.length; i++)
      for (let j = i + 1; j < vecs.length; j++) {
        sum += dot(vecs[i], vecs[j]) / (norm(vecs[i]) * norm(vecs[j]));
        pairs++;
      }
    out[name] = { n: texts.length, meanCosine: pairs ? sum / pairs : null };
  }
  writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ groups: Object.keys(out).length }));
}

await main();
