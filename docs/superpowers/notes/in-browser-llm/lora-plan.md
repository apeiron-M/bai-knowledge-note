# LoRA Fine-Tune Plan: LFM2.5-350M for Vault Command Generation

**Date:** 2026-10-20 · **Status:** plan only, nothing executed · **Branch context:** `explore/in-browser-llm`
**Baseline (spike):** scoped recall@5 90%, op accuracy given in-candidates 48.1%, args exact 33–44%, 0 constraint violations. Bar: 90–95% op accuracy.
Labels: **[E]** = estimate, **[U]** = unverified.

## 0. Gates before any data is generated

1. **Freeze the prompt inputs.** `selectOpMessages` puts each op's description into the step-1 prompt. When the description is empty (30 of 99 global ops), it falls back to the lowercased op name. The parallel descriptions round (now `descriptionOverrides` in `BuildCatalogOptions`) changes those bytes, so it must land first. After that, any edit to a description, the retriever, `k`, or the prompt text means regenerating the data and retraining. Stamp a `PROMPT_FORMAT_VERSION` plus a catalog hash into both the dataset manifest and the runtime.
2. **Phase 0 re-baseline (no training).** Rerun the harness with the new descriptions on (A) 350M base and (B) LFM2.5-1.2B-Instruct. If (A) already clears the bar, stop. If only (B) clears it, the user decides between a download about 3× larger **[E]** and fine-tuning.
3. **Runtime format changes (decision).** Today the runtime cannot express no-action, multi-action or resolvable ref-ids: `refCandidatesFor` passes bare ids with no labels. Training must match whatever is approved, so these changes ship first:
   - **Step 1:** the schema becomes `{"ops": [enum(candidate keys)]}` with `minItems 0, maxItems 3`. An empty list means "no action, answer instead". The system prompt gains one sentence saying so. If multi-action is deferred, keep `{"op"}` and add a `none` candidate line instead.
   - **Step 2, multi-action:** add a line `Step: i of n (<key1>, <key2>)` after `Operation:` so that repeated ops ("tag it A and B") are unambiguous.
   - **Labeled refs:** the ref-id enum is built over human labels (topic name, link target title), and the app maps label→id. Duplicate labels get a ` (2)` suffix. The model can then resolve "remove the ML topic".

## 1. Target behavior (byte-identical to runtime)

- **Prompt bytes come from the runtime code.** A `tsx` script calls the real `retrieve()`, `selectOpMessages()` and `fillArgsMessages()` from `editors/knowledge-vault/chat/core/`. Nothing is reimplemented in Python.
- **Rendering.** The `messages` are rendered to a string by native `llama-server` built at the same libllama tag as wllama 3.8.1 (`b11364`), with jinja off, via its `/apply-template` endpoint (`post_apply_template` in `server-context.cpp`). wllama 3.8.1 runs that same server chat path. Each row stores `prompt` (the rendered string) and `completion`.
- **Parity tests.** Two checks run before training.
  - **Tokens:** on about 200 rows, the token ids from `llama-server /tokenize` must equal the HF tokenizer's ids. This catches drift in `<|startoftext|>` and special-token handling.
  - **wllama itself:** on about 20 rows at temperature 0, `createCompletion({prompt: rendered, grammar})` must produce byte-identical output to `createChatCompletion(messages, response_format)`. wllama's `RawCompletionParams` accepts `grammar` through `SamplingParams`.
  - Before relying on either, confirm that the native server sources really are the `b11364` tag **[U]**.
- **Completions are compact canonical JSON followed by `<|im_end|>`.**
  - Step 1: `{"ops": ["knowledge-note:ADD_TOPIC"]}`
  - Step 2: `{"name": "distributed systems"}`
  - The spike's step-1 output ran 39 tokens with a run of tabs, for what is a one-token decision. Training the end token in fixes that.
  - Every target must also be accepted by the runtime constraint (checked by replaying it through the json_schema grammar).
- **Candidates are what BM25 really returns** for the synthetic utterance (scoped k=5, plus an unscoped variant). The order is preserved, as at inference.
  - Scoped recall@1 is only 73%. Rebalance so that at least 35% of rows have gold at ranks 2–5, so the model does not learn "pick line 1".
  - Rows where retrieval misses the gold op get target `[]`. The app can then retry with k=10 or fall back to Ask mode.
- **Multi-action labels.**
  - Ops are listed in the order they are mentioned in the utterance.
  - If retrieval returns only some of the gold ops, the target is the subset present, in the same order. The target is `[]` only when none are present.
  - Reducer replay applies the actions to the fixture in sequence.

| Slice | Share | Step-1 target | Step-2 rows |
|---|---|---|---|
| Single action | ~70% | `[key]` | yes, if the op has semantic fields (77 of 99 ops) |
| Confusable minimal pairs (lifecycle, BLOCK/UNBLOCK/FAIL, ADD/REMOVE, SET vs UPDATE_DESCRIPTION, field-name pull) | inside the 70% | `[key]` | yes |
| No action: questions, chit-chat, out-of-catalog requests, gold not retrieved | ~12% | `[]` | none |
| Multi-action (2–3 ops, including the same op repeated) | ~8% | `[k1,k2]` | one per op, with a `Step: i of n` line |
| Regularization: Ask-mode prompts answered by the **base** model itself (self-distillation, unconstrained), using `ChatView`'s Ask system prompt and pasted note context | ~10% | n/a | n/a |

## 2. Synthetic data generation

- **Teacher model:** `claude-opus-5` (the current default per the claude-api skill), called through the Message Batches API (50% cheaper) with `output_config.format` JSON schemas.
  - Batches do not accept the `fallbacks` parameter, so a refused request is simply re-queued.
  - Using Sonnet 5 to save cost is the user's call.
- **Teacher input per op:** op key and frozen description, the input SDL and `modelSchema`, the reducer source (`document-models/<m>/src/reducers/<module>.ts`), a sample document state, and the sibling ops in the same model, so the teacher knows what *not* to mean.
- **Teacher output per item:** `{utterance, ops, args, evidence}`, where `evidence` gives the utterance span for each filled field.
- **Diversity:**
  - **Style axes:** imperative, question-form, terse, verbose, pronoun reference ("it"), typos/lowercase, indirect intent ("I'm done drafting"), and synonyms that are not in the description (label/untag/describe were the spike's retrieval misses).
  - Each batch call asks for about 20 items across 2–3 assigned axes, with a varied persona/seed line.
- **Volume:**
  - Evidence: Liquid's home-assistant run on **LFM2-350M** (the previous generation) used 500 examples and went from 28 to 47 out of 100 ([Liquid docs](https://docs.liquid.ai/examples/customize-models/home-assistant)). Distil Labs reached 96–98% on LFM2.5-350M with about 5k examples ([Distil Labs](https://www.distillabs.ai/blog/fine-tuning-liquids-lfm25-accurate-tool-calling-at-350m-parameters/)).
  - Plan: **60 kept utterances per op on average** (40 minimum; 100 for confusable groups). That is about 6k single-action utterances, so about 8.5k step-1 rows and 6k step-2 rows with the other slices, plus about 1.5k regularization rows, **~16k rows in total [E]**. Over-generate 1.6× before filtering.
- **Validation (a row is dropped if it fails any check):**
  1. `buildAction(entry, args, dummyCtx)` succeeds, so the generated Zod creator accepts the args.
  2. The action is replayed through the model's reducer on a fixture state with no `operation.error`. For ref ops, the fixture contains the labeled entities.
  3. **Grounding:** every string value is a case-insensitive substring of the utterance or an enum or label value, and optional fields appear only when they have an evidence span. This targets the spike's paraphrased values and invented optional fields.
  4. A blind second label pass (same teacher at low effort, shown only the utterance and candidates) must agree; disagreements are dropped.
- **Dedup and leakage:**
  - Normalized exact-match dedup, plus trigram Jaccard < 0.5 within an op (the same filter Liquid used).
  - **Leakage:** drop any row with trigram similarity ≥ 0.5 to any test item. Test items never appear in teacher prompts.
- **Splits:**
  - **T1:** the 30-item `seed-utterances.json`, test-only and untouched.
  - **T2:** about 150 **human-written** items over all 12 models, including no-action and multi-action, written *before* generation. It catches teacher-style bias.
  - **Dev:** 10% of the synthetic set, split by teacher batch / paraphrase family rather than by random row, so dev does not overstate accuracy. Used only for checkpoint selection.
- **Format:** JSONL `{"prompt": str, "completion": str, "meta": {key, step, slice, gold_rank, batch_id}}`. Stored in a private HF dataset repo (or gitignored `training/data/`). Only manifests (counts, hashes, configs) are committed.
- **Teacher cost:** about 600 batch calls × (3k in + 2k out) plus the label pass comes to **$30–60 [E]**.

## 3. Training

**Tool: TRL `SFTTrainer` + PEFT.** Liquid documents this path ([TRL docs](https://docs.liquid.ai/lfm/fine-tuning/trl)). It takes pre-rendered prompt/completion pairs with completion-only loss, which is what guarantees byte identity. The same script runs on CUDA (Modal) and on Apple MPS.

| Tool | Why not chosen |
|---|---|
| leap-finetune (now [liquid-finetune](https://github.com/Liquid4All/leap-finetune)) | CUDA/ROCm only, though it has a Modal backend. Its SFT input is `messages` with its own templating, which makes byte parity harder. Its `liquid-export-gguf` and its Modal recipe are a good fallback. |
| [Unsloth](https://unsloth.ai/docs/models/tutorials/lfm2.5) | Its LFM2.5 guide covers 1.2B-Instruct; 350M is not listed **[U]**. It is CUDA-focused, and its speed advantage does not matter at 350M. |

**Checkpoint:** `LiquidAI/LFM2.5-350M`, the post-trained checkpoint, not `-Base`. The runtime depends on its chat template and Ask-mode behavior, and Distil Labs tuned this checkpoint.

**Hyperparameters:**

| Setting | Value |
|---|---|
| Rank / alpha / dropout | r 16, α 32, dropout 0.05 |
| Targets | all linear layers: `q_proj,k_proj,v_proj,out_proj,in_proj,w1,w2,w3` |
| Learning rate | 2e-4 cosine, warmup 3% |
| Epochs | 3 (sweep 2–4) |
| Effective batch | 32 |
| Max sequence | 1024 |
| Precision | bf16 |
| Ablation | full fine-tune |

- **Why all linear layers:** Liquid's TRL docs target only q/k/v/o, but only 6 of the 16 layers are attention ([model card](https://huggingface.co/LiquidAI/LFM2.5-350M-Base)). Unsloth targets all linear layers.
- **Why a full fine-tune is a cheap ablation:** runtime LoRA is unavailable (§4), so LoRA's only benefits are regularization and cost.

**Hardware [E]:** about 5M tokens per epoch.

| Option | Time per run | Cost |
|---|---|---|
| Modal H100 | ~10–20 min | ~$2–5 per run, ~$15–30 for a sweep. Liquid reports "a few minutes, ~$1.50" for 500 examples × 5 epochs. |
| Local Apple Silicon (MPS, bf16) | ~1–3 h **[E]**; bf16 support varies by chip and macOS | none; fine for one final run |
| `mlx-lm` / `mlx-tune` LoRA on LFM2 conv layers | n/a | **[U]** |

## 4. Export to the browser

- **Path:** merge the adapter, then `convert_hf_to_gguf.py` (LFM2 is registered in `conversion/lfm2.py`), then `llama-quantize`. Ship two artifacts:
  - **Q4_K_M** (~219 MB, like-for-like with today's runtime);
  - **Q8_0** (~379 MB).
  - Sizes are from the [GGUF card](https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF).
- **QAD:** Liquid's QAD build is a separate `QAD-Q4_0` file, and "other quantization formats may behave differently". The Q4_K_M we use today is plain post-training quantization, so nothing is lost by re-quantizing. Reproducing QAD on our fine-tune would need tooling we have not verified **[U]**.
- **Runtime LoRA in wllama 3.8.1: not usable.**
  - The `lora_adapters` load parameters are plumbed (`src/wllama.ts:570–572`, `cpp/wllama-context.h:534–550`).
  - But `prepareBlobs` (`src/utils.ts:171–201`) names every blob that is not an mmproj as a model shard, so there is no way to mount an adapter file. There is no per-request adapter switching, and the README TODO still lists "Add support for LoRA adapter".
  - A fork could mount the file. Even then, `convert_lora_to_gguf.py` mapping of `in_proj`/`w1–3` and LoRA on WebGPU are **[U]**.
  - **Consequence:** we ship a merged model, so there is no shared base. Keeping Ask mode on the base model means a second download and about 2× memory.
- **Hosting:** a HF model repo `<org>/LFM2.5-350M-vault-ops-GGUF`, loaded with the existing `loadModelFromHF` and pinned to a commit revision. Check whether the LFM Open License permits redistributing a derivative **[U]**.

## 5. Eval protocol and go/no-go

- **How it runs:** in-browser via `spike/llm-harness`, on the shipped GGUF, temperature 0, WebGPU plus a CPU spot-check.
- **Arms:**
  - A: 350M base + constraints
  - B: 1.2B-Instruct + constraints
  - C: fine-tuned Q4_K_M
  - D: fine-tuned Q8_0
  - E (only if C/D fail): fine-tuned 1.2B
- **Reporting:** results on T1 and T2. Dev is used only to select checkpoints.

| Metric | Go bar (proposed) |
|---|---|
| Scoped recall@5 / @10 (retriever; context only) | ≥ 90% (not a gate on the fine-tune) |
| **Op accuracy given in-candidates** (and per gold rank 1–5) | **≥ 90%, stretch 95%** |
| No-action precision / recall | ≥ 0.85 / 0.85 |
| Multi-action set exact match | ≥ 75% |
| Args exact / loose | ≥ 80% / ≥ 90% (user sets the tolerance) |
| Grounded args (no invented optionals) | ≥ 95% |
| Constraint validity, `buildAction` and reducer no-error | 100% / ≥ 98% |
| Q&A regression: 50 Ask-mode prompts with pasted note context, pairwise `claude-opus-5` judge vs base | base preferred in ≤ 15% of pairs |
| Step-1 latency | ≤ base (compact output should cut it) |

- **Go:** C or D meets the bar on both T1 and T2, and beats B or matches it at a third of the size.
- **No-go:** try one data iteration (add data for the failure clusters). Then try E, or ship B.

## 6. Steps, artifacts and commit points (all on `main`, no push)

| # | Work | Lives in | Effort **[E]** |
|---|---|---|---|
| 1 | Runtime format changes (§0.3), harness support for the new arms, T2 test set | `editors/knowledge-vault/chat/core/`, `spike/llm-harness/` | 1.5–2.5 d |
| 2 | Catalog export, teacher batches, validators, dataset builder, parity tests | `training/gen/*.ts`, `tests/unit/training-*.test.ts` | 2–3 d |
| 3 | SFT, Modal app, merge → GGUF → quantize | `training/train/` (`uv` project) | 1 d |
| 4 | Generate, train, publish, eval arms A–D, results doc | `docs/superpowers/specs/` | 2–3 d |

- Each row is one commit. Data is never committed.
- **Total:** about 7–10 days **[E]**, plus $50–100 in API and GPU costs **[E]**.

## 7. Risks (mitigations are in §1–§5)

- **Forgetting in Ask mode.** If the regularization slice does not hold the Q&A gate, keep the base model for Ask.
- **Teacher bias.** A large gap between T2 and dev is the signal.
- **Eval leakage.** T1 and T2 stay out of teacher prompts, and the trigram filter runs against them.
- **Prompt and retriever coupling.** Guarded by the version stamp and a one-command regeneration.
- **Label noise.** Handled by the reducer replay and the blind second pass.
- **Q4 loss on the fine-tuned weights.** Measured by arm C vs D.
- **Fixture states not matching real vaults.** Sample labels from real exported documents.

## 8. Decisions for the user

1. **Runtime format changes:** approve the `ops` array, the `Step: i of n` line and labeled ref enums. Decide whether multi-action is in v1, or deferred in favor of a `none` sentinel.
2. **Gate on the descriptions round:** freeze descriptions before generating data, and accept that later edits mean retraining.
3. **Training hardware:** Modal H100 or local Apple Silicon.
4. **Teacher model:** `claude-opus-5` or `claude-sonnet-5`.
5. **Download budget:** Q8_0 (~379 MB) or Q4_K_M (~219 MB).
6. **Ask mode:** served by the fine-tuned model, or kept on the base model (a second download and about 2× memory).
7. **Args-exact tolerance:** proposed at 80%.
8. **Hosting:** the HF org/repo, and the LFM license check for derivatives.
9. **T2 authorship:** who writes the ~150 human test items.
