import { describe, expect, it } from "vitest";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { NO_ACTION_EXEMPLARS } from "../../editors/knowledge-vault/chat/core/no-action-gate.js";
import {
  createOpEmbeddingIndex,
  decodeVectors,
  encodeVectors,
  loadOpEmbeddingAsset,
  opEmbeddingHash,
  opEmbeddingInputs,
} from "../../editors/knowledge-vault/chat/core/op-embedding-index.js";
import { dot } from "../../editors/knowledge-vault/chat/core/op-embeddings.js";

const catalog = buildRuntimeCatalog();

describe("precomputed op embeddings", () => {
  // Fails when an op, a description, an exemplar or the model spec changed
  // without `npx --no-install tsx scripts/gen-op-embeddings.ts`.
  it("matches the current catalog, descriptions and exemplars", async () => {
    const asset = await loadOpEmbeddingAsset();
    const inputs = opEmbeddingInputs(catalog);
    expect(asset.hash).toBe(await opEmbeddingHash(inputs));
    expect(asset.ops.keys).toEqual(inputs.ops.map((o) => o.key));
    expect(asset.exemplars.count).toBe(NO_ACTION_EXEMPLARS.length);
  });

  it("decodes unit vectors of the stated size", async () => {
    const asset = await loadOpEmbeddingAsset();
    const ops = decodeVectors(asset.ops.vectors, asset.dims);
    expect(asset.dims).toBe(384);
    expect(ops).toHaveLength(asset.ops.keys.length);
    for (const v of ops) expect(dot(v, v)).toBeCloseTo(1, 4);
  });

  it("round-trips vectors through base64", () => {
    const vs = [new Float32Array([0.25, -1, 3.5]), new Float32Array([0, 1, 2])];
    expect(decodeVectors(encodeVectors(vs), 3)).toEqual(vs);
  });

  it("ranks a scoped model's ops by similarity and rejects a stale asset", async () => {
    const asset = await loadOpEmbeddingAsset();
    const index = createOpEmbeddingIndex(catalog, asset);
    const i = asset.ops.keys.indexOf("tension:RESOLVE_TENSION");
    const q = decodeVectors(asset.ops.vectors, asset.dims)[i];
    const hits = index.rankOps(q, "bai/tension");
    expect(hits[0].entry.key).toBe("tension:RESOLVE_TENSION");
    expect(hits.every((h) => h.entry.docType === "bai/tension")).toBe(true);
    expect(index.exemplarSims(q)).toHaveLength(NO_ACTION_EXEMPLARS.length);
    const stale = {
      ...asset,
      ops: { ...asset.ops, keys: asset.ops.keys.slice(1) },
    };
    expect(() => createOpEmbeddingIndex(catalog, stale)).toThrow(/stale/);
  });
});
