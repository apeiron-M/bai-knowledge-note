# Plan: server-side embeddings — processor-computed, bundled model, durable store

Status: proposed · 2026-08-14
Owner: liberuum
Prereqs landed: pooled GraphQL client, `dist/vector.tar.gz` shipping fix,
`knowledgeGraphSemanticSearch` resolver (server-side query embedding),
browser fully model-free.

## Goal

Semantic search that works on a hosted Switchboard with **no browser
involvement and no network trips at inference time**:

1. Embeddings are computed **in the graph-indexer processor** when content
   changes — no Connect, no manual backfill.
2. The model ships **inside the package dist**, loaded from local files.
3. Vectors live in the **reactor's relational DB**, surviving restarts.

## Model choice

Measured baseline (current model, Node, q8): 500ms cold load, 12ms/note warm,
543 notes ≈ 6s. Speed is not the constraint; size-on-disk and retrieval
quality are.

| Model | Params | Dim | MTEB Retrieval | q8 ONNX | Notes |
|---|---|---|---|---|---|
| Supabase/gte-small (current) | 33M | 384 | ~49.5 | ~34MB | no query prefix |
| **Snowflake/snowflake-arctic-embed-xs** | 22M | 384 | **50.15** | ~23MB | needs query prefix |
| Xenova/bge-small-en-v1.5 | 33M | 384 | ~51.7 | ~34MB | needs query prefix |
| Xenova/all-MiniLM-L6-v2 | 22M | 384 | 41.95 | ~23MB | weak retrieval |
| minishlab/potion-retrieval-32M (static) | 32M | 256 | 35.06 | ~8MB | 82% of MiniLM; too lossy |

**Recommendation: `Snowflake/snowflake-arctic-embed-xs`.** Better retrieval
than the current model at two-thirds the size, same 384 dims (no schema
change), ONNX + transformers.js support confirmed. Documents embed with no
prefix; queries embed with `"Represent this sentence for searching relevant
passages: "` prepended — asymmetric by design, improves retrieval.

Static models (potion/model2vec) are rejected: 500× faster inference solves a
problem we don't have and costs ~15 MTEB retrieval points. `bge-small-en-v1.5`
is the fallback if we'd rather maximize quality at the current size.

Switching models invalidates existing vectors. Re-embedding is ~6s for the
whole vault, done automatically by the processor backfill below.

## 1. Bundle the model in dist

Extend `scripts/copy-pglite-assets.mjs` (rename `copy-runtime-assets.mjs`):

- Download-once into the repo: `models/snowflake-arctic-embed-xs/` holding
  `onnx/model_quantized.onnx`, `tokenizer.json`, `tokenizer_config.json`,
  `config.json` (~23MB total). Committed, so builds are hermetic — no
  network at build time either.
- Copy to `dist/models/...` after every build (`build` + `prepublishOnly`).
- Package grows ~11.5MB → ~35MB. Acceptable; still below the 51.7MB unpacked
  we already ship.

Server code loads it with:

```ts
env.localModelPath = new URL("../models/", import.meta.url).pathname;
env.allowRemoteModels = false;   // hard guarantee: no wire trips, ever
```

`allowRemoteModels = false` turns "silently fetch from HF" into a loud error
if the assets are missing — same fail-loudly principle as the pglite copy
script.

## 2. Durable vector store in relationalDb

Replace the separate `memory://` PGlite (`embedding-store.ts`) with a table in
the processor's existing namespaced relationalDb, created in
`migrations.ts` alongside `graph_nodes`:

```
note_embeddings(document_id varchar PK, embedding_json text, content_hash varchar, updated_at varchar)
```

- **No pgvector dependency**: store 384 floats as JSON, compute cosine in JS.
  At 521 notes that is ~200k multiply-adds per query — sub-millisecond, and
  benchmarked faster than the HNSW round-trip at this scale. Revisit a real
  vector index at ~50k notes.
- This *removes* the need for `dist/vector.tar.gz` and the separate PGlite
  instance entirely (keep the shipping fix until this lands).
- `content_hash` = sha256 of the embedded text (`title + " " + description`),
  so unchanged notes are never re-embedded (the Cookbook's semantic-search
  recipe pattern).
- Survives restarts because relationalDb is the reactor's persistent store —
  the same one `graph_nodes` provably persists in.

## 3. Processor-computed embeddings

In `processors/graph-indexer/index.ts` `onOperations`, which already handles
`SET_TITLE` / `SET_DESCRIPTION` / `SET_CONTENT`:

- After updating `graph_nodes` for a doc, recompute `title + " " + description`,
  hash it, and if the hash differs from `note_embeddings.content_hash`, embed
  and upsert. Batch per `onOperations` call (dedupe by document, embed once).
- `DELETE_NODE` / document deletion → delete the embedding row.
- **Backfill on catch-up for free**: `startFrom: "beginning"` means a fresh
  deployment replays all history through `onOperations`, embedding everything
  with no extra code path. The content-hash check makes replay idempotent.
- Embedding failures must not error the processor (a poisoned doc would freeze
  the cursor): catch per-document, log, continue. Missing embeddings surface
  via `knowledgeGraphMissingEmbeddings`, which becomes a health check rather
  than a to-do list.
- Model load is lazy (first embed), ~500ms once. Inference is synchronous CPU
  work (~12ms/doc): fine inline; if it ever matters, chunk with setImmediate.

## 4. Query path (already landed)

`knowledgeGraphSemanticSearch(driveId, query, mode, limit)` embeds the query
server-side and falls back to keyword fullSearch when the embedder or vectors
are unavailable. With arctic-embed-xs, `embedQuery` prepends the query prefix;
document embedding (processor) uses none.

## 5. Deletions / cleanup

- Remove `embedding-store.ts` (PGlite version) once the relationalDb store
  lands; drop `@electric-sql/pglite` back to devDependencies and delete the
  vector.tar.gz copy step.
- `scripts/drive-sync/embed-backfill.mjs`: keep as an ops tool but point it at
  `knowledgeGraphSemanticSearch`-era APIs; it becomes optional (processor
  backfill covers its job).
- Fix stale docstring claims: reindex does NOT recompute embeddings today
  (that claim justified `memory://`); after this plan, reindex genuinely
  doesn't need to — the processor does.
- Plugin docs: update AGENT.md search guidance to lead with
  `knowledgeGraphSemanticSearch` (it now degrades safely on every deployment).

## Upstream reports (powerhouse monorepo)

1. `nodeBuildConfig` lacks `inputOptions.experimental.resolveNewUrlToAsset` —
   browser build emits `new URL(...)` assets, node build silently doesn't.
2. `@electric-sql/pglite/vector` subpath escapes `nodeNeverBundle`'s exact
   string match, inlining a shim whose relative asset path breaks in dist.
3. HYBRID mode flattens similarity scores to ~0.016 (RRF scores leak through
   the `similarity` field unnormalized) — fine for ranking, wrong for
   thresholding.

## Order of work

1. Commit model files + asset copying (build-time, no behavior change).
2. relationalDb migration + JS-cosine store, dual-write behind it.
3. Processor embed-on-change + hash skip; verify by watching
   `knowledgeGraphMissingEmbeddings` drain on a fresh drive.
4. Switch `embedQuery` + processor to arctic-embed-xs (prefix on query side),
   re-embed via replay.
5. Delete the PGlite embedding store + vector.tar.gz shipping; demote pglite.
6. Publish; verify on the remote: upload → embeddings appear with no client
   involvement → `knowledgeGraphSemanticSearch` answers from a cold start.

## Acceptance

- Fresh hosted deployment + drive upload → semantic search works with zero
  browser/agent embedding involvement and zero outbound network from the
  Switchboard.
- Restart the Switchboard → embeddings still present (no re-backfill).
- Editor bundle contains no model reference (verified: editors/ chunks are
  clean today; keep it that way).
