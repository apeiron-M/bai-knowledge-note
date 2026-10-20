/**
 * Round 7: the v1 pipeline exactly as the Chat tab runs it (`runV1` from
 * the chat core), on the dev sets only, plus a parity check of the
 * precomputed op vectors (node, CPU) against the browser embedder (wasm).
 */
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import type { LlmClient } from "../../editors/knowledge-vault/chat/core/llm-client.js";
import {
  decodeVectors,
  loadOpEmbeddingAsset,
  opEmbeddingInputs,
} from "../../editors/knowledge-vault/chat/core/op-embedding-index.js";
import { dot } from "../../editors/knowledge-vault/chat/core/op-embeddings.js";
import type { ScoreCache } from "../../editors/knowledge-vault/chat/core/op-scorer.js";
import {
  loadV1Runtime,
  runV1,
} from "../../editors/knowledge-vault/chat/core/v1-pipeline.js";
import { scoreArgs } from "./r5.js";
import { loadR6, type R6Item } from "./r6.js";

type Json = Record<string, unknown>;
/** Dev sets only: this entry never loads a held-out set. */
type DevSet = "dev" | "devx" | "devna";

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]);
}

async function devItems(sets: DevSet[]): Promise<R6Item[]> {
  const out: R6Item[] = [];
  for (const s of sets) out.push(...(await loadR6(s)));
  return out;
}

export async function v1Pipeline(
  c: LlmClient,
  o: { sets: DevSet[] },
): Promise<Json> {
  const t0 = performance.now();
  const runtime = await loadV1Runtime();
  const runtimeMs = performance.now() - t0;
  const cache: ScoreCache = new Map();
  const rows: Json[] = [];
  for (const it of await devItems(o.sets)) {
    const t = performance.now();
    const r = await runV1(
      it.utterance,
      it.docType,
      () => it.refCandidates ?? {},
      {
        runtime,
        completeJson: c.completeJson,
        scoreText: c.scoreText,
        cache,
      },
    );
    const pick = r.kind === "action" ? r.entry.key : null;
    const row: Json = {
      id: it.id,
      set: it.set,
      utterance: it.utterance,
      expectedOp: it.expectedOp ?? null,
      pick,
      opCorrect: pick === (it.expectedOp ?? null),
      gateScore: Math.round(r.gate.score * 1000) / 1000,
      question: r.gate.question,
      ms: {
        embed: Math.round(r.embedMs),
        args:
          r.kind === "action" ? Math.round(r.step2.refMs + r.step2.genMs) : 0,
        total: Math.round(performance.now() - t),
      },
    };
    if (r.kind === "action") {
      row.args = r.step2.args;
      if (row.opCorrect)
        Object.assign(
          row,
          scoreArgs(it, r.step2.args, Object.keys(it.refCandidates ?? {})),
        );
    }
    rows.push(row);
  }
  const action = rows.filter((r) => r.expectedOp);
  const na = rows.filter((r) => !r.expectedOp);
  const cnt = (xs: Json[], k: string) => xs.filter((r) => r[k] === true).length;
  const scored = (k: string) =>
    action.filter((r) => r.opCorrect && r[k] !== null && r[k] !== undefined);
  const total = rows.map((r) => (r.ms as Record<string, number>).total);
  return {
    summary: {
      sets: o.sets,
      runtimeLoadMs: Math.round(runtimeMs),
      embedderLoadMs: Math.round(runtime.embedderLoadMs),
      opAcc: `${cnt(action, "opCorrect")}/${action.length}`,
      noActionRecall: `${na.filter((r) => r.pick === null).length}/${na.length}`,
      actionGatedOut: action.filter((r) => r.pick === null).length,
      argsExact: `${cnt(scored("exact"), "exact")}/${scored("exact").length}`,
      refExact: `${cnt(scored("refExact"), "refExact")}/${scored("refExact").length}`,
      totalMedianMs: quantile(total, 0.5),
      totalP90Ms: quantile(total, 0.9),
    },
    rows,
  };
}

/**
 * Browser (wasm) vs committed (node CPU) op vectors: max |Δ|, min cosine,
 * and whether any dev item's scoped top-1 op changes.
 */
export async function v1EmbedParity(): Promise<Json> {
  const runtime = await loadV1Runtime();
  const asset = await loadOpEmbeddingAsset();
  const committed = decodeVectors(asset.ops.vectors, asset.dims);
  const inputs = opEmbeddingInputs(buildRuntimeCatalog());
  const browser: Float32Array[] = [];
  for (const op of inputs.ops) browser.push(await runtime.embedQuery(op.text));
  let maxAbs = 0;
  let minCos = 1;
  browser.forEach((v, i) => {
    minCos = Math.min(minCos, dot(v, committed[i]));
    for (let d = 0; d < v.length; d++)
      maxAbs = Math.max(maxAbs, Math.abs(v[d] - committed[i][d]));
  });
  const keys = inputs.ops.map((op) => op.key);
  const docTypeOf = new Map(
    buildRuntimeCatalog().map((e) => [e.key, e.docType]),
  );
  const top = (vs: Float32Array[], q: Float32Array, docType: string) => {
    let best = -2;
    let key = "";
    keys.forEach((k, i) => {
      const s = dot(q, vs[i]);
      if (docTypeOf.get(k) === docType && s > best) [best, key] = [s, k];
    });
    return key;
  };
  const items = await devItems(["dev", "devx", "devna"]);
  const flips: string[] = [];
  for (const it of items) {
    const q = await runtime.embedQuery(it.utterance);
    if (top(browser, q, it.docType) !== top(committed, q, it.docType))
      flips.push(it.id);
  }
  return {
    ops: keys.length,
    maxAbsDiff: maxAbs,
    minCosine: minCos,
    devItems: items.length,
    scopedTop1Flips: flips,
  };
}
