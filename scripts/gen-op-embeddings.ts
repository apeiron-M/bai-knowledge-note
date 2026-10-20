/**
 * Writes the chat's precomputed op and no-action-exemplar vectors
 * (`editors/knowledge-vault/chat/core/op-embeddings.gte-small.json`) with
 * the committed gte-small model under node (onnxruntime-node, CPU).
 *
 *   npx --no-install tsx scripts/gen-op-embeddings.ts           # regenerate
 *   npx --no-install tsx scripts/gen-op-embeddings.ts --check   # exit 1 if stale
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRuntimeCatalog } from "../editors/knowledge-vault/chat/core/catalog-models.js";
import { loadGteEmbedder } from "../editors/knowledge-vault/chat/core/gte-embedder.js";
import {
  encodeVectors,
  opEmbeddingHash,
  opEmbeddingInputs,
  type OpEmbeddingAsset,
} from "../editors/knowledge-vault/chat/core/op-embedding-index.js";

const ASSET = fileURLToPath(
  new URL(
    "../editors/knowledge-vault/chat/core/op-embeddings.gte-small.json",
    import.meta.url,
  ),
);
const MODELS = fileURLToPath(new URL("../models/", import.meta.url));

function storedHash(): string | null {
  if (!existsSync(ASSET)) return null;
  const parsed: unknown = JSON.parse(readFileSync(ASSET, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("hash" in parsed))
    return null;
  return typeof parsed.hash === "string" ? parsed.hash : null;
}

async function main(): Promise<void> {
  const inputs = opEmbeddingInputs(buildRuntimeCatalog());
  const hash = await opEmbeddingHash(inputs);
  if (process.argv.includes("--check")) {
    const ok = storedHash() === hash;
    console.log(ok ? `op embeddings current (${hash})` : "op embeddings stale");
    process.exit(ok ? 0 : 1);
  }
  const t0 = performance.now();
  const emb = await loadGteEmbedder({ localModelPath: MODELS, device: "cpu" });
  // One text per call, as the runtime embeds the utterance alone.
  const one = async (t: string) => (await emb.embed([t]))[0];
  const ops: Float32Array[] = [];
  for (const o of inputs.ops) ops.push(await one(o.text));
  const exemplars: Float32Array[] = [];
  for (const t of inputs.exemplars) exemplars.push(await one(t));
  const asset: OpEmbeddingAsset = {
    format: 1,
    spec: inputs.spec,
    hash,
    dims: ops[0].length,
    generatedWith: `node ${process.version}, @huggingface/transformers + onnxruntime-node (cpu)`,
    ops: { keys: inputs.ops.map((o) => o.key), vectors: encodeVectors(ops) },
    exemplars: { count: exemplars.length, vectors: encodeVectors(exemplars) },
  };
  writeFileSync(ASSET, JSON.stringify(asset, null, 2) + "\n");
  console.log(
    `wrote ${ops.length} op + ${exemplars.length} exemplar vectors (${asset.dims} dims), load ${Math.round(emb.loadMs)} ms, total ${Math.round(performance.now() - t0)} ms, hash ${hash}`,
  );
}

await main();
