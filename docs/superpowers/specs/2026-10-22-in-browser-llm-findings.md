# In-Browser LLM Chat: Findings

**Date:** 2026-10-22
**Branch:** `explore/in-browser-llm` (118 commits ahead of `main` at the time of writing, `6430d39d`; not merged)
**Question:** can a chat assistant run fully in the browser, answering vault questions and issuing reactor/vault commands with a small local LLM?
**Sources:** the exploration plan (`2026-10-20-in-browser-llm-exploration.md`), the spike results (`2026-10-20-in-browser-llm-spike-results.md`, Rounds 1–10), `training/README.md`, `training/results/*.json`, and git history. Every number below comes from one of these. Most were observed once, on one machine (Chrome, Apple `metal-3` WebGPU adapter). Estimates are marked as such.

## 1. Summary

- **We built** a Chat tab in the knowledge-vault editor. It runs LFM2.5-350M (a 350M-parameter model from Liquid AI) in the browser through wllama, a WebAssembly build of llama.cpp. It picks one document operation, fills its arguments under a grammar, shows a proposal card, and dispatches through the reactor only after the user clicks Confirm. The runtime, the embedder and the Connect integration all work, with no CDN dependency except the model file.
- **Best setup measured:** the Round 8 LoRA (a fine-tune, defined in section 3) with the "R2c" pipeline. On held-out-3 (92 requests) it chose the right operation 85.9% of the time and got the request fully right 72.8% of the time. On held-out-4 (104 requests, harder) the figures were 80.8% and 65.4%. Median latency per request is about 450 ms warm on WebGPU.
- **Natural vs paraphrased requests:** natural phrasing is at the bar (97.8% op on held-out-3); paraphrased requests are not (74.5%).
- **The pre-registered bars were never met.** The bars were op accuracy ≥ 90% and exact args ≥ 80%. A targeted retrain (Round 10) did not improve on Round 8.
- **Recommendation:** ship v1 as the Round 8 LoRA + R2c + Confirm before dispatch, with a document required (scoped requests only). Before investing more in teacher data, get real phrasing data. Unscoped requests ("do X somewhere in my vault") are not usable with this model.

## 2. What runs in the browser

| Piece | What | Where it loads from |
|---|---|---|
| LLM runtime | wllama 3.8.1, vendored unmodified in `vendor/wllama/3.8.1/` (JS 382,633 B, wasm 8,763,949 B) | package origin (`'self'`) |
| LLM | `LiquidAI/LFM2.5-350M-GGUF`, Q4_K_M quantization, 229,312,224 B. GGUF is llama.cpp's single-file model format. The fine-tuned GGUF is the same size. | Hugging Face today; cached in OPFS (the browser's origin-private file system) |
| Embeddings | gte-small (a 384-dimension sentence-embedding model, q8 ONNX, 34,014,426 B) through onnxruntime-web 1.26.0-dev, also vendored (wasm 23,567,050 B) | package origin |
| Op vectors | 99 op vectors + 16 no-action exemplars, precomputed (`op-embeddings.gte-small.json`, 239 KB), bit-identical to the browser's own output | package origin, lazy chunk |
| UI | `chat` tab in `DriveExplorer.tsx`, `ChatView.tsx`, `ChatProposalCard.tsx`, `hooks/use-chat-llm.ts` | — |

**Cold-load download (my arithmetic from the sizes above):** about 296 MB. That is 229 MB GGUF + 8.8 MB wllama wasm + 23.6 MB ort wasm + 34 MB gte-small + 0.24 MB vectors. Of this, about 67 MB ships inside the package's `dist/browser`.

**Measured load and speed:**

| | Value | Where |
|---|---|---|
| Cold load (OPFS empty) | 9.2–15.2 s; network-bound | Connect, Rounds 3 and 7 |
| Warm load (page reload) | 0.57–0.92 s | Connect, Rounds 3, 4, 7 |
| gte-small embedder load | 455–657 ms, in parallel with wllama | harness and Connect |
| Generation speed | 183–196 tok/s WebGPU; about 32 tok/s CPU | harness, Round 1 |
| Send → proposal, warm, second utterance on the page | 128 ms (base-model v1 pipeline) | Connect, Round 7 |
| Per request, Round 8 LoRA + R2c | median 443–459 ms, p90 842–938 ms | harness, Rounds 9–10 |

- The CPU figure is single-threaded, because Connect is not cross-origin isolated (no COOP/COEP headers).
- Connect's CSP (Content-Security-Policy) allows scripts only from `'self'`, inline scripts and one registry origin. That is why wllama and onnxruntime-web are vendored; section 7 has the details.
- In Round 7, a full Connect check passed. An action was proposed, confirmed and dispatched: `ADD_TOPIC`, revision history "No errors". A question was routed to a plain-text answer with no dispatch. There was no CSP violation and no request to jsdelivr. The only external host the chat itself used was Hugging Face, for the GGUF.
- **Gap:** the sources record that Connect run only with the *base-model* v1 pipeline. The LoRA + R2c numbers come from the standalone harness, which served the GGUF locally. As of `6430d39d`, `chat/core/v1-pipeline.ts` still runs the base-model pipeline (G3 gate + gte-small top-1).
- **Unverified:** the Q&A path answers in plain text. The sources do not show it retrieving vault notes as context yet. Ask mode began as a stub with a `useGraphSearch` TODO.

## 3. The pipeline (R2c, Round 8 LoRA)

Terms:

- **LoRA:** a small set of trainable low-rank weight matrices added to a frozen base model. Here that is 6.0M parameters (1.66% of the model), merged back into the weights and exported as GGUF.
- **Constrained decoding:** the sampler may only emit tokens that a grammar accepts. GBNF is llama.cpp's grammar format; JSON Schema is compiled to it.

Steps:

1. **The user selects a document.** Requests are always scoped to that document's model (knowledge-note, project, wbs, and so on).
2. **Embed the utterance** with gte-small: about 40 ms.
3. **Step 1, the op choice.**
   - The LoRA sees every global op of that model, in catalog order: 4–19 ops, median 16. Each line is `key: description (fields: …)`.
   - It generates `{"ops": ["<key>"]}` or `{"ops": []}` under a grammar that admits only those answers. `{"ops": []}` means no document change.
   - There is no separate no-action pre-gate; dropping it is part of R2c.
4. **No action → answer path.** The model answers in plain text, without constraints.
5. **Step 2, the arguments.**
   - The op's schema carries the app's canonical vocabularies as enums, for example note types and pipeline phases.
   - A "safe" gate drops optional fields the user did not mention.
   - Reference fields get a `Choices for <field>:` line with human labels: topic names, link targets, goal descriptions. The first required reference is picked by calibrated likelihood, then fixed.
   - The arguments are then generated under a **copy-span grammar**: free-text values must be a contiguous span of the user's words.
6. **The app builds the action.** It maps labels to ids, adds new ids, timestamps and the `{type, input, scope}` envelope, and validates with the generated zod creator. The model never invents ids or dates, which matches the reducer-purity rule.
7. **Proposal card → Confirm → `dispatchActions(action, docId)`.** Nothing reaches the reactor without a click.

The prompt bytes ("format r6.1") are pinned by `tests/unit/chat-prompt-format.test.ts`. The training renderer calls the same builders, so training and runtime prompts are byte-identical (`tests/unit/training-prompt-format.test.ts`). v1 emits at most one action per message; multi-action is deferred.

## 4. How we measured

- **A held-out set** is a set of test requests that nothing was tuned or trained on. Each set (1–4) was written separately from the implementer, by other agents (held-out-4 by the coordinating agent). Each holds 68–104 action requests plus 6–10 no-action requests, split into "natural" phrasing and "paraphrase" (no op-name words).
- **Blind:** before a run, the implementer printed only field names and counts. The disclosures in the results doc list two exceptions: two utterances seen while checking held-out-1's structure, and one held-out-3 no-action utterance seen after Round 10's training set was fixed.
- **Pre-registration:** configurations, metrics, bars and decision rules were written and committed before each held-out run. One example: "if gte-small top-1 ≥ the LLM-fused pick, drop the LLM step". The held-out file was committed unchanged before its first run.
- **Run once:** each pre-registered config ran once per set, with no reruns unless a run broke. When one broke (a concurrent-run hang in Round 6), both outcomes are reported. Picking the best of several configs on one set flatters the winner, and the doc says so each time.
- **Dev sets** were written by the implementer: a 30-item seed set, reused about 25 times, plus 29 "dev-extra" items. Dev numbers are reference only and optimistic.
- **Label corrections:** in Round 7, three expected values were changed to the canonical vocabularies, for example `taskType "extract"` → `"claim"`. No set was re-run after the change.

**Limits:**

- **Every test set is model-written.** So is the training data (teacher: `claude-sonnet-5`). None of it is real user traffic.
- **The sets differ in difficulty.**
  - Held-out-1 deliberately avoided op words, so BM25 recall@5 (BM25 is a keyword-ranking method) fell to 63%.
  - Held-out-3 was easier: the same code path scored 83.7% op there, against 57.4% and 73.6% on held-out-1 and -2.
  - **Numbers from different sets are not comparable.** Compare rows within one set.
- **Sets were reused.** Held-out-1 and -2 were run again in Round 8, and held-out-3 again in Round 10. Only each set's first use is clean.
- **Noise:** with n ≈ 100, differences of 1–3 items are within noise. Two label runs on the same rows agreed only 86.4% exact.

## 5. Results by round

"Op" = right operation over action items. "Fully right" = right op, exact args and refs where scored. Base = stock LFM2.5-350M.

| Round | Set (action n) | Change | Op | Fully right |
|---|---|---|---|---|
| 1 | seed (30) | base, BM25 top 5 + enum-constrained pick | 43.3% | – |
| 2 | seed (30) | written descriptions for all 100 ops; candidate order | 40–63% (BM25 top-1 alone: 73.3%) | – |
| 5 | held-out-1 (68) | calibrated likelihood scoring + BM25 fusion | 32.4% (constrained enum pick: 13.2%) | – |
| 6 | held-out-2 (91) | every scoped op + gte-small: top-1, no LLM (O2) / fused with base LLM (O5) | 47.3% / 44.0% | – / 27.5% |
| 8 | held-out-1 (68) | v1 base (C0) → LoRA step 1 + step 2 (C3 k=5) | 33.8% → 57.4% | 20.6% → 42.6% |
| 8 | held-out-2 (91) | same | 46.2% → 73.6% | 27.5% → 57.1% |
| 9 | held-out-3 (92) | Round 8 LoRA: top 5 + gate (R0) → no gate (R1) → all scoped ops, catalog order (R2c) | 83.7% → 85.9% → 85.9% | 68.5% → 69.6% → 72.8% |
| 9 | held-out-3 (92) | unscoped, top 10 / top 15 over all 99 ops | 37.0% / 39.1% | 31.5% / 32.6% |
| 10 | held-out-4 (104) | R2c: Round 8 LoRA (E8) vs Round 10 retrain (E10) | 80.8% vs 78.8% | 65.4% vs 61.5% |

Args exact, given the right op, for the best setups:

- R2c on held-out-3: 68.4%.
- E8 on held-out-4: 76.4%.
- Round 8 LoRA with the oracle op: 66.0% on held-out-1 and 66.2% on held-out-2.

**Lessons:**

- **Constraints fix form, not choice.** Grammars held (0/20 violations in each of three modes, adversarial prompt, temperature 1.2; args 100% zod-valid), yet the op was right 43% of the time. The copy-span grammar removed every hallucinated extra field (12 items → 0) but cannot pick the right span.
- **Descriptions didn't help.** With candidates held fixed, new op descriptions were net negative (13 → 12 of 30) and lowered BM25 recall@5 (90% → 86.7%). Candidate *order* mattered more (reversal: 13 → 17 of 30).
- **The base model added nothing over embeddings.** In Round 6, gte-small top-1 (43/91, 40 ms) matched the LLM-fused picks within noise (40–45/91, 1.6–4.6 s); its yes/no no-action gate had 8.2% precision. The base-model step-1 call was dropped.
- **The LoRA roughly doubled fully-correct answers** (20.6% → 42.6%, 27.5% → 57.1%), was the first change to move paraphrases (held-out-2: 12/45 → 25/45), raised refs to about 95% given the right op (base 59–66%), and added about 150 ms.
- **The gate and the full scoped list helped, modestly.** Dropping the no-action pre-gate: +2 op, no-action precision 7/13 → 7/8 at equal recall. Listing every scoped op (R1 → R2c) removed the retrieval ceiling but op was flat (6 gained, 6 lost to siblings); fully right +3 (64 → 67, within noise) for about 60 ms more, and step 1 no longer depends on retrieval.
- **A targeted retrain didn't help.** Round 10's 1,324 targeted rows gave op −2, args +1, fully right −4 vs Round 8 on held-out-4; both scored 53/73 on sibling-confusion items. Round 8 scored about 93% on teacher-distribution validation rows vs about 74–86% op on held-out sets, which reads as a gap between the teacher's wording and the held-out writers', not a volume problem (an inference).
- **Unscoped requests fail:** 26.4% op (base, held-out-2), 37–39% (LoRA, held-out-3), where 31–34 misses were another model's op.
- **Remaining errors** are mostly sibling confusions within one model on paraphrases (e.g. `UPDATE_ORIENTATION` → `UPDATE_DESCRIPTION`, project status → deliverable ops), plus args errors in span boundaries, lists, enum values, unnormalized dates, and meant-but-unnamed `owner`/`role`/`assignee` that the safe gate drops.

## 6. The training pipeline

**Teacher:** `claude-sonnet-5` through headless Claude Code (`claude -p` with no tools, MCP, settings or project context, an empty cwd and a replaced system prompt; no API key). `--json-schema` is a tool call, not constrained decoding, so every response is re-checked. Each item gets a wording spec (register, length, an invented name, a two-sided op-word quota of about 60% avoid). The 40 ops that reference existing items ("ref ops") get a document state built by replaying real creation actions, with the target at a random position among 2–6 items.

**Validation chain** (`training/py/teacher.py`, `training/gen/*.ts`): grounding (arg values must appear in the utterance) → wording spec, ref echo and account-context leak filter → dedup and eval leak (normalized match, trigram Jaccard ≥ 0.5, or containment) → canonical vocabularies, zod, reducer replay and ref post-conditions → a **blind second teacher pass** that labels each utterance without seeing the intended op (only agreeing rows kept) → the r6.1 grammar gate. Rows whose op agreed but whose step 2 is untrainable are kept as step-1-only. Rendering through llama-server b11364 (wllama's libllama) shows 0 template or token mismatches against the HF tokenizer.

**Batch size** (325 items per arm, same specs and states):

| | 1 per call | 10 per call | 25 per call |
|---|---|---|---|
| Yield | 84.3% | 77.8% | 72.0% |
| Cost per kept row | $0.0188 | $0.0108 | $0.0096 |

Recommendation: 10 items per generation call, 8 per label call. Batch 25 loses whole calls (one reading applied to all 25; 3 of 13 calls cost 64 items); the B1 vs B10 yield gap is within label-run noise, and B1 was the most repetitive arm (it reproduced a held-out phrase 4 times).

**Runs.** All costs below are the CLI-reported `total_cost_usd`. That is an API-list-price equivalent, not subscription usage.

| Run | Items → kept rows | Teacher time | Cost |
|---|---|---|---|
| Pilot 1 | 100 → 73 | ~206 s | $1.53 |
| Pilot 2 (ref ops) | 150 → 105 | ~284 s | $1.77 |
| Round 8 | 4,035 → 3,286 | 95 min generation + ~24 min labels | $38.30 ($0.0117/row) |
| Round 10 | 1,800 → 1,324 | ~51 min generation + ~8 min labels | $21.22 ($0.016/row) |

*Extrapolation, not measured:* 12,000 items at batch 10 would take about 5.2 h and cost about $100, for about 9.3k kept rows.

**Training:** TRL `SFTTrainer` + PEFT on Apple MPS, bf16, completion-only loss, r 16 / α 32; then merge, llama.cpp convert, the published chat template, Q4_K_M. Round 8: 3 epochs (741 steps, 81.5 min), val loss minimum 0.0143 at epoch 1.8, final 0.0161 (mild overfitting); merged logits within 4.1e-4 of base + adapter. Round 10: 2 epochs (450 steps, 52.3 min), val minimum = final (0.0126).

**Local vs second laptop, and the MPS memory issue:** the 36 GB Mac handled the smoke run (20 steps, 7.87 GB peak), but the first Round 8 attempt grew to about 44 GB (swap 30–34 GB) and was stopped at step 48 of 741. Both real runs moved to a second laptop (M4 Max, 64 GB, over SSH) at a 16 GiB peak. The cause is **not confirmed**; the working theory is that per-batch padding creates many tensor shapes and the MPS cache grows with them. Fix: empty the MPS cache every step and pad to a multiple of 64 (`train_lora.py`); Round 10 added a memory watchdog.

## 7. Problems hit and how they were handled

- **Stale monorepo build (Round 3).** Connect rendered blank (`Failed to resolve import "react-router-dom"`): the symlinked `../powerhouse` packages had `dist` builds from Oct 12–13, while their sources had moved to `@tanstack/react-router`. Rebuilding Connect and ph-cli in the monorepo (35 builds, 20.6 s) fixed it; no source changed.
- **CSP blocked the CDN imports (Rounds 3, 4, 7).** Connect's CSP is a `<meta>` from `builder-tools/connect-utils/vite-config.ts` (`script-src 'self' 'unsafe-inline' 'unsafe-eval' <registry>`; `connect-src` unset, which is why a plain `fetch` worked). The stopgap ran the fetched bundle as an inline module; the fix vendored wllama (Round 4) and onnxruntime-web with explicit `wasmPaths` (Round 7). **Still open:** wllama's compat build (browsers without JSPI or wasm memory64) would still come from jsdelivr; Chrome did not need it.
- **`generateMock` moved (from git history, not the docs).** `180fd3b0` ports upstream `223e1682`, which moved `generateMock` to `document-model/mock`; the barrel export now throws at runtime, so 21 generated test files changed. `2091c7b5` likewise re-sources `IProcessorHostModule` for the graph-indexer factory.
- **Spend limits.** The org's monthly spend limit (HTTP 429) interrupted teacher runs three times. The first 429 was not recognized and burned retries; any 429 now stops `run` with its journal kept. Round 8 resumed 198 lost label calls after the reset. In Round 10 a `--limit 1` probe deleted a journal and 18 finished results were re-run (fixed in `422460c1`).
- **Account details leaking through teacher context.** Headless Claude Code injects about 500 tokens of session context, including the logged-in account's email address, that no flag removes alongside a custom system prompt. The teacher put it into 2 of 100 pilot-1 utterances and 2 pilot-2 `author` fields. Fix: prompts say to invent every name, email and date, and `rows` drops any item containing the account email, its local part, `$USER` or the home path; raw results were redacted. 0 occurrences in Rounds 8 and 10. Lesson: treat a teacher's ambient context as leakable and filter outputs, not just prompts.
- **The dedup gap.** Trigram Jaccard missed rows that embedded a whole held-out utterance in a longer message (B1 did this 4 times). `dedup.py` now rejects containment (`aeef1d3c`), and `plan`/`label` refuse prompts that contain an eval utterance.
- **Smaller ones:** a 204-error pre-existing tsc baseline (so `npm run build` needs `--ignore-type-errors`), `copy-runtime-assets.mjs` not finding onnxruntime-web in the pnpm layout, no GGUF sha256 recorded in Round 8 (recovered by reproducing dev results exactly), and one harness hang from two runs sharing a wllama instance.

## 8. Recommendation and open questions

**Ship v1** as the Round 8 LoRA + R2c (step 1 over every op of the document's model in catalog order, no pre-gate; step 2 with the safe gate and calibrated ref scoring) + Confirm before dispatch, **with a document required**: unscoped requests get no command path. Expect, from model-written sets: right op about 81–86%, fully right about 65–73%, natural requests 92–98% op, paraphrases 69–75%. Confirm is what makes that acceptable.

**Not done yet, needed to ship:**

- Switch `v1-pipeline.ts` / the Chat tab to the LoRA + R2c, and re-run the Connect end-to-end check with the LoRA GGUF.
- Runtime ref candidates for the non-note models. Only knowledge-note topics and links have them today; the LoRA was trained on `ref-scenarios.ts` labels (goal description, member name, …), which the README says the runtime must adopt. `ADD_LINK` gets no candidates, so it cannot be confirmed.

**Open questions:**

1. **Where to host the GGUF.** The LoRA file is local and gitignored (`training/artifacts/round8/gguf/`, sha256 `6930e31e…`). Hugging Face or our own CDN (matters for COEP if multi-threaded CPU is ever enabled). The license for redistributing a derivative of LFM2.5 has not been checked.
2. **Real-user phrasing data.** The biggest lever left: two training sets (3.3k and 4.6k rows) gave the same blind-set accuracy. Paraphrases written by people, or consented chat logs, would test and train on the real distribution.
3. **LFM2.5-1.2B.** Proposed in the exploration plan and in Round 1, and **never run.** It is worth one eval on held-out-4 with the same pipeline, against a latency budget (E10's median was 411 ms).
4. **Op descriptions in step 1.** Round 10's verdict proposes adding a one-line description per candidate (a new format, r6.2). **Discrepancy:** the pinned r6.1 format already renders `key: <model's own description> (fields: …)` per line. Those descriptions are thin (about 38 characters average, and empty for project and wbs), so the proposal is better read as "use the richer `OP_DESCRIPTIONS` text". This needs a re-render, a retrain and a fresh blind set.
5. **The unscoped problem.** A vault-wide command needs either a model-routing step that works (routing by best embedding hit reached only 36/91 @1) or training rows over mixed-model lists. Neither was tried with a LoRA.
6. **`kysely-pglite-dialect`.** It is missing from `node_modules`, so tests that import it fail typecheck. It is part of the 204-error tsc baseline.
7. **oxlint is not installed.** Lint ran through `npx -p oxlint@1.70.0 -p oxlint-tsgolint@0.23.0`, so `npm run lint:fix` presumably cannot run as documented (not checked).
8. **The two remaining processor suites.** My inference from a grep: `tests/processor/graph-query.test.ts` and `tests/processor/graph-indexer.test.ts` are the suites that import `kysely-pglite-dialect` (via `tests/helpers/create-test-db.ts`). The sources do not say whether they fail for that reason alone.
9. **The Q&A check is small:** 15 prompts with pasted context, judged once by the implementer: Round 8 vs base 4 base-better / 9 same / 2 LoRA-better, a mild regression it cannot rule in or out.
10. **Format gaps:** the safe gate drops meant-but-unnamed `owner`/`role`/`assignee` (relaxing it at inference only invented values); `requireOneOf` clashes with an optional ref (`UPDATE_DELIVERABLE`); dates are not normalized.

## 9. Where things live

| What | Path |
|---|---|
| Plan and full results | `docs/superpowers/specs/2026-10-20-in-browser-llm-exploration.md`, `…-spike-results.md` |
| Chat core | `editors/knowledge-vault/chat/core/`: `v1-pipeline.ts`, `llm-client.ts`, `step1-candidates.ts`, `op-scorer.ts`, `args-step.ts`, `args-grammar.ts`, `no-action-gate.ts`, `vocabularies.ts`, `prompt-format.ts`, `gte-embedder.ts`, `op-embeddings.gte-small.json` |
| Chat UI | `editors/knowledge-vault/components/{DriveExplorer,ChatView,ChatProposalCard}.tsx`, `editors/knowledge-vault/hooks/use-chat-llm.ts` |
| Vendored runtimes | `vendor/wllama/3.8.1/`, `vendor/onnxruntime-web/1.26.0-dev.20260416-b7804b056c/` (each with a README of checksums) |
| Embedding asset tooling | `scripts/gen-op-embeddings.ts` (`--check` exits 1 when stale), `scripts/gte-wasm-node.ts` |
| Harness | `spike/llm-harness/` (`r5.ts`, `r6.ts`, `r8.ts`, `r9.ts`, `v1.ts`); per-item results and held-out sets in `spike/llm-harness/eval/` |
| Training | `training/` (README has every command); summaries in `training/results/`; kept rows in `training/data/`; GGUFs in `training/artifacts/` (gitignored) |
| Tests | `tests/unit/chat-*.test.ts`, `tests/unit/training-prompt-format.test.ts` |

**Reproduce:** start the harness with `npx vite --config spike/llm-harness/vite.config.mjs --port 5199` (Chrome, WebGPU), then `spike.run("load", "webgpu", false, "/lora/<file>-Q4_K_M.gguf")` and `spike.run("r9Run", "webgpu", {name, sets: ["h4","h4na","h4multi"], cands: {mode: "scoped-all", order: "catalog"}, preGate: false, model})`; tables via `training/py/r10_report.py`. Training: `training/scripts/setup.sh` once, then the teacher → `render.sh` → `split.py` → `train_lora.py` (about 16 GiB) → `merge.py` → `export-gguf.sh` chain, with exact command blocks for Rounds 8 and 10 in `training/README.md`.

**Scale (at `6430d39d`):** 118 commits on the branch. The total diff is 216 files and about 1.1M insertions, mostly per-item eval JSON. Excluding eval results, vendored files, models and training data, it is 118 files and about 24k insertions.
