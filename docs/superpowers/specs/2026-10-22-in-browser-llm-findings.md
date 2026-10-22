# In-Browser LLM Chat: Findings

**Date:** 2026-10-22
**Branch:** `explore/in-browser-llm` (118 commits ahead of `main`, last `6430d39d`; not merged)
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
| 6 | held-out-2 (91) | every scoped op + gte-small; gte-small top-1, no LLM | 47.3% | 27.5% (with LLM step) |
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

- **Constraints fix form, not choice.**
  - Grammar enforcement held: 0 violations in 20 runs in each of three modes, even on an adversarial prompt at temperature 1.2. Args were zod-valid 100% of the time.
  - The op was still right only 43% of the time. Under the adversarial prompt the pick was arbitrary.
  - The copy-span grammar later removed every hallucinated extra field (12 items → 0), but it cannot pick the right span.
- **Descriptions didn't help.**
  - With the candidate set held fixed, the new op descriptions were net negative (scoped 13 → 12 of 30). As retrieval text they lowered BM25 recall@5 from 90% to 86.7%.
  - The base model was strongly order-sensitive: reversing the list moved 13/30 to 17/30.
- **The base model added nothing over embeddings.**
  - In Round 6, gte-small's top-1 (43/91) matched or beat every LLM-fused pick at 40 ms, against 1.6 s for the LLM.
  - The base model's yes/no no-action gate had 8.2% precision.
  - So the base-model step-1 call was dropped.
- **The LoRA roughly doubled fully-correct answers:** 20.6% → 42.6% and 27.5% → 57.1%.
  - It was the first change that moved paraphrases (held-out-2: 12/45 → 25/45).
  - Refs went to about 95% given the right op (base: 59–66%).
  - It added about 150 ms per request.
- **The gate and the full scoped list helped, modestly.**
  - Dropping the no-action pre-gate is a clear win: +2 op, and no-action precision 7/13 → 7/8 at the same recall. The LoRA's own `{"ops": []}` is the better gate.
  - Listing every scoped op removed the retrieval ceiling, but op accuracy was flat: 6 items gained, 6 lost to new sibling confusions.
  - The full list gave +2 fully right (within noise) for about 60 ms more. It also makes step 1 independent of retrieval, which is the main reason to prefer R2c.
- **A targeted retrain didn't help.**
  - Round 10 added 1,324 rows aimed at Round 9's errors: contrastive sibling sets, plus list/enum/span stress.
  - On held-out-4 it scored op −2, args +1 and fully right −4 against Round 8. On the 73 items tagged as sibling confusions, both scored exactly 53/73.
  - Val loss was healthy (0.0126). The model scores about 93% on teacher-distribution validation rows but about 80% on held-out sets. That reads as a distribution gap between the teacher's wording and the held-out writers', not a data-volume problem (an inference).
- **Unscoped requests fail.**
  - Without a document, the best op accuracy was 26.4% (base, held-out-2) and 37–39% (LoRA, held-out-3).
  - 31–34 of the LoRA's misses were another model's op; it was never trained on mixed-model lists.
- **Remaining errors (R2c / E10)** are almost all sibling confusions within one model, mostly on paraphrases. Examples:
  - `UPDATE_ORIENTATION` → `UPDATE_DESCRIPTION`;
  - project status → deliverable ops;
  - the vault-config toggles among themselves.

  Args errors are span boundaries, lists, enum values, unnormalized dates, and "meant but unnamed" fields (`owner`, `role`, `assignee`) that the safe gate drops.

## 6. The training pipeline

**Teacher.**

- `claude-sonnet-5` via headless Claude Code, one isolated call per request: `claude -p` with no tools, no MCP, no settings, safe mode, an empty cwd and a replaced system prompt. It needs no API key.
- Structured output uses `--json-schema`, which the CLI implements as a tool call rather than constrained decoding, so every response is re-checked.
- Each item gets a spec: register, length band, an invented person name, and a two-sided quota on op words, so roughly 60% avoid the op's own words.
- The 40 ops that reference existing items ("ref ops") get a seeded document state. It is built by replaying real creation actions through the reducers, and the target sits at a random position among 2–6 items.

**Validation chain** (`training/py/teacher.py`, `training/gen/*.ts`), in order:

1. Grounding: arg values must appear in the utterance.
2. Wording-spec check, ref echo, and the account-context leak filter.
3. Dedup and eval leak: normalized match, trigram Jaccard ≥ 0.5, or containment of any eval utterance.
4. Canonical vocabularies, zod, and reducer replay with ref post-conditions.
5. A **blind second teacher pass** labels each utterance without seeing the intended op. Only agreeing rows are kept.
6. The r6.1 grammar gate: the runtime grammar must accept the target.
7. Rows whose op agreed but whose step 2 is untrainable are kept as step-1-only rows.

Rendering goes through llama-server b11364, the libllama inside wllama. It shows 0 template or token mismatches against the HF tokenizer.

**Batch size** (325 items per arm, same specs and states):

| | 1 per call | 10 per call | 25 per call |
|---|---|---|---|
| Yield | 84.3% | 77.8% | 72.0% |
| Cost per kept row | $0.0188 | $0.0108 | $0.0096 |

- **Recommendation:** 10 items per generation call and 8 per label call.
- Batch 25 loses whole calls: one reading is applied to all 25 items, and 3 of 13 calls cost 64 items.
- The B1 vs B10 yield gap is within label-run noise.
- B1 was the most repetitive arm and reproduced a held-out phrase 4 times.

**Runs.** All costs below are the CLI-reported `total_cost_usd`. That is an API-list-price equivalent, not subscription usage.

| Run | Items → kept rows | Teacher time | Cost |
|---|---|---|---|
| Pilot 1 | 100 → 73 | ~206 s | $1.53 |
| Pilot 2 (ref ops) | 150 → 105 | ~284 s | $1.77 |
| Round 8 | 4,035 → 3,286 | 95 min generation + ~24 min labels | $38.30 ($0.0117/row) |
| Round 10 | 1,800 → 1,324 | ~51 min generation + ~8 min labels | $21.22 ($0.016/row) |

*Extrapolation, not measured:* 12,000 items at batch 10 would take about 5.2 h and cost about $100, for about 9.3k kept rows.

**Training.**

- **Stack:** TRL `SFTTrainer` + PEFT on Apple MPS, bf16, completion-only loss, settings r 16 / α 32.
- **Export:** merge, llama.cpp convert, carry over the published template, Q4_K_M.
- **Round 8:** 3 epochs, 741 steps, 81.5 min.
  - Val loss bottomed at epoch 1.8 (0.0143) and ended at 0.0161, so there was mild overfitting.
  - Merged logits matched base + adapter within 4.1e-4.
- **Round 10:** 2 epochs, 450 steps, 52.3 min. Val minimum = final (0.0126).
- **Second laptop:** both rounds ran on a second laptop (M4 Max, 64 GB, over SSH), at a peak footprint of 16 GiB. The first Round 8 attempt on the 36 GB Mac grew to about 44 GB (swap 30–34 GB) and was stopped at step 48 of 741.
  - The cause is **not confirmed**. The working theory is that per-batch padding creates many tensor shapes and the MPS cache grows with them.
  - Fix: `train_lora.py` empties the MPS cache every step and pads to a multiple of 64. Round 10 also used a memory watchdog.
- **Smoke run:** on the 36 GB Mac, 20 steps on 86 rows peaked at 7.87 GB.

## 7. Problems hit and how they were handled

- **Stale monorepo build (Round 3).**
  - Symptom: Connect rendered blank, with `Failed to resolve import "react-router-dom"`.
  - Cause: the symlinked `../powerhouse` packages had `dist` builds from Oct 12–13, while their sources had moved to `@tanstack/react-router`.
  - Fix: rebuilding Connect and ph-cli in the monorepo (35 builds, 20.6 s). No source changed.
- **Connect's CSP blocked the wllama CDN import (Round 3).**
  - The CSP is a `<meta>` tag from `builder-tools/connect-utils/vite-config.ts`: `script-src 'self' 'unsafe-inline' 'unsafe-eval' <registry>`. `connect-src` is unset, which is why a plain `fetch` of the same URL succeeded.
  - Stopgap: fetch the bundle and run it as an inline module.
  - Real fix (Round 4): vendor wllama so it loads from `'self'`.
  - onnxruntime-web had the same problem, because transformers.js defaults its wasm path to jsdelivr. It was vendored in Round 7 with explicit `wasmPaths`.
  - **Still open:** wllama's compat build, used in browsers without JSPI or wasm memory64, would still be fetched from jsdelivr. Chrome did not need it.
- **`generateMock` moved (from git history, not the docs).** Commit `180fd3b0` ports an upstream change (`223e1682`) that moved `generateMock` to `document-model/mock`. The barrel export now throws at runtime, so 21 generated test files were updated. `2091c7b5` similarly re-sources `IProcessorHostModule` for `processors/graph-indexer/factory.ts`.
- **Spend limits.** The org's monthly spend limit (HTTP 429) interrupted teacher runs three times.
  - The first 429 was not recognized and burned retries. Any 429 now stops `run`, keeping its journal.
  - Round 8 lost 198 label calls to the limit and resumed them after the reset.
  - In Round 10, a `--limit 1` probe deleted a journal, and 18 finished results had to be re-run. Fixed in `422460c1`.
- **Account details leaking into teacher context.**
  - Headless Claude Code injects about 500 tokens of session context that no flag removes alongside a custom system prompt. That context includes the logged-in account's email address.
  - In pilot 1 the teacher used it as an assignee in 2 of 100 utterances. In pilot 2 it appeared as an `author` in 2 items.
  - Fix, in two layers: the prompts say to invent every name, email and date, and `rows` drops any item containing the account email, its local part, `$USER` or the home path. Raw results were redacted.
  - 0 occurrences in Rounds 8 and 10.
  - **Lesson:** treat the teacher's ambient context as data that can leak, and filter outputs, not just prompts.
- **The dedup gap.** The trigram-Jaccard filter missed rows that embedded a whole held-out utterance inside a longer message: B1 did this 4 times. `dedup.py` now also rejects containment (`aeef1d3c`), and `plan`/`label` refuse prompts that contain an eval utterance.
- **Smaller ones:**
  - `npm run tsc` has 204 pre-existing errors at HEAD, so "clean" meant no new errors, and `npm run build` stops on them (`ph-cli build --ignore-type-errors` works).
  - `copy-runtime-assets.mjs` cannot find onnxruntime-web in the pnpm layout.
  - Round 8 recorded no GGUF sha256; it was recovered by reproducing dev results exactly.
  - Two harness runs once shared one wllama instance and hung.

## 8. Recommendation and open questions

**Ship v1** as:

- the Round 8 LoRA;
- R2c: step 1 over every op of the document's model, in catalog order, with no pre-gate;
- step 2 with the safe gate and calibrated ref scoring;
- Confirm before dispatch;
- **a document is required**; unscoped requests get no command path.

What to expect, from held-out-3 and -4, all model-written:

- right op about 81–86% of the time;
- fully right about 65–73%;
- natural requests about 92–98% op;
- paraphrases about 69–75% op.

Confirm is what makes this level acceptable.

**Work this needs before shipping** (from the sources, not done):

- Switch `v1-pipeline.ts` / the Chat tab to the LoRA + R2c, and re-run the Connect end-to-end check with the LoRA GGUF.
- Add runtime ref-candidate extractors for the non-note models.
  - Today only knowledge-note topics and links get candidates.
  - The LoRA was trained on labels from `ref-scenarios.ts` (goal description, member name, and so on), and the README says the runtime must adopt the same labels.
  - `ADD_LINK` gets no candidates, so it cannot be confirmed.
- Run a larger judged Q&A check. The 15-prompt check showed a mild regression against the base: 4 base-better / 9 same / 2 LoRA-better for Round 8, judged once by the implementer.

**Open questions:**

1. **Where to host the GGUF.** The LoRA file is local and gitignored (`training/artifacts/round8/gguf/`, sha256 `6930e31e…`). The options are Hugging Face or our own CDN; that choice matters for COEP if multi-threaded CPU is ever enabled. The license check for redistributing a derivative of LFM2.5 has not been done.
2. **Real-user phrasing data.** This is the biggest lever left. Two training sets (3.3k and 4.6k rows) gave the same blind-set accuracy. Paraphrases written by people, or chat logs (with consent), would test and train on the real distribution.
3. **LFM2.5-1.2B.** Proposed in the exploration plan and in Round 1, and **never run.** It is worth one eval on held-out-4 with the same pipeline, against a latency budget (E10's median was 411 ms).
4. **Op descriptions in step 1.** Round 10's verdict proposes adding a one-line description per candidate (a new format, r6.2). **Discrepancy:** the pinned r6.1 format already renders `key: <model's own description> (fields: …)` per line. Those descriptions are thin (about 38 characters average, and empty for project and wbs), so the proposal is better read as "use the richer `OP_DESCRIPTIONS` text". This needs a re-render, a retrain and a fresh blind set.
5. **The unscoped problem.** A vault-wide command needs either a model-routing step that works (routing by best embedding hit reached only 36/91 @1) or training rows over mixed-model lists. Neither was tried with a LoRA.
6. **`kysely-pglite-dialect`.** It is missing from `node_modules`, so tests that import it fail typecheck. It is part of the 204-error tsc baseline.
7. **oxlint is not installed.** Lint ran through `npx -p oxlint@1.70.0 -p oxlint-tsgolint@0.23.0`, so `npm run lint:fix` presumably cannot run as documented (not checked).
8. **The two remaining processor suites.** My inference from a grep: `tests/processor/graph-query.test.ts` and `tests/processor/graph-indexer.test.ts` are the suites that import `kysely-pglite-dialect` (via `tests/helpers/create-test-db.ts`). The sources do not say whether they fail for that reason alone.
9. **The Q&A check is small:** 15 prompts, with pasted context, judged once by the implementer. It cannot rule out a regression in Ask mode.
10. **Format gaps:**
    - The safe gate drops meant-but-unnamed `owner`/`role`/`assignee`. Relaxing it at inference only invented values.
    - `requireOneOf` interacts badly with an optional ref (`UPDATE_DELIVERABLE`).
    - Dates are not normalized by the app.

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

**Reproduce an eval:**

1. Start the harness with `npx vite --config spike/llm-harness/vite.config.mjs --port 5199` and open it in Chrome with WebGPU.
2. Load the model: `spike.run("load", "webgpu", false, "/lora/<file>-Q4_K_M.gguf")`.
3. Run the eval: `spike.run("r9Run", "webgpu", {name, sets: ["h4","h4na","h4multi"], cands: {mode: "scoped-all", order: "catalog"}, preGate: false, model})`.
4. Build the tables with `training/py/r10_report.py`.

**Reproduce training:**

1. Run `training/scripts/setup.sh` once. It builds llama.cpp b11364 outside the repo.
2. Run the teacher: `teacher.py plan → run → rows`, then `render.sh`, then `label → run → agree --step1-only`.
3. Render again with `render.sh`, then split with `split.py`.
4. Train with `train_lora.py` (needs about 16 GiB).
5. Merge with `merge.py`, then export with `export-gguf.sh`.

The exact command lines for Rounds 8 and 10 are in `training/README.md`.

**Scale:** 118 commits on the branch. The total diff is 216 files and about 1.1M insertions, mostly per-item eval JSON. Excluding eval results, vendored files, models and training data, it is 118 files and about 24k insertions.
