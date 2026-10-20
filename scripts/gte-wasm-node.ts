/**
 * gte-small under node with the browser's numerics: the same
 * onnxruntime-web bundle transformers' web build runs, on the vendored
 * asyncify wasm, with transformers' own tokenizer, mean pooling and
 * normalization. The node build's onnxruntime-node (CPU) differs from the
 * browser by up to ~0.01 per dimension, enough to flip scoped top-1 ops, so
 * build-time vectors (op embeddings, training candidates) come from here.
 */
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GTE_MODEL,
  ORT_WASM_PATHS,
} from "../editors/knowledge-vault/chat/core/gte-embedder.js";
import type { EmbedTexts } from "../editors/knowledge-vault/chat/core/op-embeddings.js";

const repo = fileURLToPath(new URL("../", import.meta.url));

interface OrtTensor {
  data: unknown;
  dims: readonly number[];
}

interface OrtSession {
  inputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

interface OrtWeb {
  env: { wasm: { wasmPaths?: unknown; numThreads?: number } };
  InferenceSession: {
    create(model: Uint8Array, opts: object): Promise<OrtSession>;
  };
  Tensor: new (
    type: string,
    data: unknown,
    dims: readonly number[],
  ) => OrtTensor;
}

function isOrtWeb(m: unknown): m is OrtWeb {
  return (
    typeof m === "object" &&
    m !== null &&
    "InferenceSession" in m &&
    "Tensor" in m &&
    "env" in m
  );
}

export interface NodeWasmEmbedder {
  embed: EmbedTexts;
  loadMs: number;
  /** e.g. `onnxruntime-web 1.26.0-dev… (wasm, asyncify)`. */
  backend: string;
}

export async function loadNodeWasmEmbedder(): Promise<NodeWasmEmbedder> {
  const t0 = performance.now();
  // transformers' web build imports `onnxruntime-web/webgpu`, i.e. this file.
  const ortDir = join(
    realpathSync(join(repo, "node_modules/@huggingface/transformers")),
    "../../onnxruntime-web",
  );
  const mod: unknown = await import(
    pathToFileURL(join(ortDir, "dist/ort.webgpu.bundle.min.mjs")).href
  );
  if (!isOrtWeb(mod)) throw new Error("unexpected onnxruntime-web module");
  mod.env.wasm.wasmPaths = ORT_WASM_PATHS;
  mod.env.wasm.numThreads = 1;
  const session = await mod.InferenceSession.create(
    readFileSync(
      join(repo, "models/Supabase/gte-small/onnx/model_quantized.onnx"),
    ),
    { executionProviders: ["wasm"] },
  );
  const tf = await import("@huggingface/transformers");
  tf.env.allowLocalModels = true;
  tf.env.allowRemoteModels = false;
  tf.env.localModelPath = join(repo, "models/");
  const tokenizer = await tf.AutoTokenizer.from_pretrained(GTE_MODEL);
  const version: unknown = JSON.parse(
    readFileSync(join(ortDir, "package.json"), "utf8"),
  );
  const v =
    typeof version === "object" && version !== null && "version" in version
      ? String(version.version)
      : "?";
  const embed: EmbedTexts = async (texts) => {
    // As transformers' feature-extraction pipeline does it.
    const enc = tokenizer(texts, { padding: true, truncation: true });
    const byName = new Map<string, unknown>(Object.entries(enc));
    const feeds: Record<string, OrtTensor> = {};
    for (const name of session.inputNames) {
      const t = byName.get(name);
      if (!(t instanceof tf.Tensor)) throw new Error(`no tokenizer ${name}`);
      feeds[name] = new mod.Tensor(t.type, t.data, t.dims);
    }
    const out = (await session.run(feeds)).last_hidden_state;
    if (!(out.data instanceof Float32Array))
      throw new Error("gte-small: expected float32 output");
    const pooled = tf
      .mean_pooling(
        new tf.Tensor("float32", out.data, [...out.dims]),
        enc.attention_mask,
      )
      .normalize(2, -1);
    const [n, d] = pooled.dims;
    const data = pooled.data;
    if (!(data instanceof Float32Array))
      throw new Error("gte-small: expected float32 pooling");
    return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d));
  };
  return {
    embed,
    loadMs: performance.now() - t0,
    backend: `onnxruntime-web ${v} (wasm, asyncify, 1 thread)`,
  };
}
