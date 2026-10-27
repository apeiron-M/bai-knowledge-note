#!/usr/bin/env node
/**
 * Fetch the embedding model into this package's models/ (committed). Run it
 * only to restore or replace the model: build.mjs copies models/ into dist/,
 * and the vault's embedder loads it from there — from disk where the package
 * is installed, from the registry CDN everywhere else — never from
 * huggingface.co at run time.
 *
 * Files for `Supabase/gte-small` (used by the embedder with `dtype: "q8"`):
 *   - config.json
 *   - tokenizer.json
 *   - tokenizer_config.json
 *   - special_tokens_map.json
 *   - onnx/model_quantized.onnx       (q8 quantized weights, ~30 MB)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HF_BASE = "https://huggingface.co/Supabase/gte-small/resolve/main";
// This package's models/ (scripts/ -> package root).
const MODEL_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../models/Supabase/gte-small",
);

const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

async function fetchOne(rel) {
  const target = path.join(MODEL_DIR, rel);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    return { rel, status: "cached", bytes: fs.statSync(target).size };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const res = await fetch(`${HF_BASE}/${rel}`, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`fetch ${rel} → ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  return { rel, status: "fetched", bytes: buf.length };
}

const results = await Promise.all(FILES.map(fetchOne));
for (const r of results) {
  console.log(
    `[fetch-model] ${r.status.padEnd(7)} ${r.rel.padEnd(35)} ${(
      r.bytes / 1024
    ).toFixed(1)} KiB`,
  );
}
