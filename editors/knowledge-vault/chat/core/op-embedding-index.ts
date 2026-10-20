/**
 * Precomputed gte-small vectors for every global op and every no-action
 * exemplar (round 7), so a session embeds only the utterance. The asset is
 * written by `scripts/gen-op-embeddings.ts`; its hash covers the model spec
 * and every input text, so a catalog or description change that was not
 * regenerated is detectable (`tests/unit/chat-op-embeddings.test.ts`).
 */
import { GTE_SPEC } from "./gte-embedder.js";
import { NO_ACTION_EXEMPLARS } from "./no-action-gate.js";
import type { CatalogEntry } from "./op-catalog.js";
import { OP_DESCRIPTIONS } from "./op-descriptions.js";
import { dot, opEmbeddingText, rankIndices } from "./op-embeddings.js";
import type { RetrievedOp } from "./op-retriever.js";

export interface OpEmbeddingInputs {
  spec: { model: string; dtype: string; pooling: string; normalize: boolean };
  ops: { key: string; text: string }[];
  exemplars: string[];
}

export interface OpEmbeddingAsset {
  format: number;
  spec: OpEmbeddingInputs["spec"];
  /** sha256 of `JSON.stringify(opEmbeddingInputs(catalog))`. */
  hash: string;
  dims: number;
  /** How the vectors were computed (runtime and backend). */
  generatedWith: string;
  ops: { keys: string[]; vectors: string };
  exemplars: { count: number; vectors: string };
}

/** The texts the op index embeds: global ops with `OP_DESCRIPTIONS`. */
export function opEmbeddingInputs(catalog: CatalogEntry[]): OpEmbeddingInputs {
  return {
    spec: { ...GTE_SPEC },
    ops: catalog
      .filter((e) => e.scope === "global")
      .map((e) => ({ key: e.key, text: opEmbeddingText(e, OP_DESCRIPTIONS) })),
    exemplars: [...NO_ACTION_EXEMPLARS],
  };
}

export async function opEmbeddingHash(
  inputs: OpEmbeddingInputs,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(inputs));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Concatenated little-endian float32, base64. */
export function encodeVectors(vectors: Float32Array[]): string {
  const dims = vectors[0]?.length ?? 0;
  const all = new Float32Array(vectors.length * dims);
  vectors.forEach((v, i) => all.set(v, i * dims));
  const bytes = new Uint8Array(all.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeVectors(b64: string, dims: number): Float32Array[] {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const all = new Float32Array(bytes.buffer);
  return Array.from({ length: all.length / dims }, (_, i) =>
    all.slice(i * dims, (i + 1) * dims),
  );
}

export interface OpEmbeddingIndex {
  hash: string;
  /** Global ops (of `docType`, when given) ranked by similarity to `q`. */
  rankOps(q: Float32Array, docType?: string): RetrievedOp[];
  /** Similarity of `q` to each no-action exemplar. */
  exemplarSims(q: Float32Array): number[];
}

/** Throws when the asset lacks a global op of the catalog (stale asset). */
export function createOpEmbeddingIndex(
  catalog: CatalogEntry[],
  asset: OpEmbeddingAsset,
): OpEmbeddingIndex {
  const vectors = decodeVectors(asset.ops.vectors, asset.dims);
  const byKey = new Map(asset.ops.keys.map((k, i) => [k, vectors[i]]));
  const ops = catalog.filter((e) => e.scope === "global");
  const missing = ops.filter((e) => !byKey.has(e.key)).map((e) => e.key);
  if (missing.length > 0)
    throw new Error(
      `op embeddings are stale (missing ${missing.join(", ")}); run scripts/gen-op-embeddings.ts`,
    );
  const exemplars = decodeVectors(asset.exemplars.vectors, asset.dims);
  return {
    hash: asset.hash,
    rankOps(q, docType) {
      const pool = ops
        .filter((e) => !docType || e.docType === docType)
        .map((entry) => ({ entry, score: dot(q, byKey.get(entry.key) ?? q) }));
      return rankIndices(pool.map((h) => h.score)).map((i) => pool[i]);
    },
    exemplarSims: (q) => exemplars.map((v) => dot(q, v)),
  };
}

/** The committed asset, as its own lazily loaded chunk. */
export async function loadOpEmbeddingAsset(): Promise<OpEmbeddingAsset> {
  const m = await import("./op-embeddings-asset.js");
  return m.default;
}
