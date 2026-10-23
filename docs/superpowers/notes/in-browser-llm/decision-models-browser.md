# Decision networks for the in-browser command pipeline

**Status:** research only, 2026-10-23. Nothing was trained or run in a browser. No held-out utterances were read. Seen: field names, counts, and one held-out-4 item's `expected` op and args, which include a gold `title` value.

**Labels:**
- **[src]** checked in code, a binary, the HF/npm/GitHub API, or our own result files.
- **[web]** taken from a model card, paper or README, not reproduced.
- **[inf]** my inference or estimate.

**The question.** We want a model that makes a *decision* (a choice, a score, a yes/no) by reading option probabilities or a classifier head, not by generating text. It must be open-weight and run in the browser. Jev is only the reference for the idea.

**What fixes the frame (from our own docs):**
- The live decision is **scoped**: 4–19 ops per document model (median 16), plus "no action". It is not a flat 99-way problem.
- The LoRA gets the verb right on 91–96% of items and the target on 81–85%. Most misses are sibling confusions on paraphrases.
- Round 8 scored about 93% on teacher-distribution validation rows against 81–86% on blind sets, and Round 10 (more rows) did not help. **The gap is in wording distribution, not model class.** Any model trained on the same rows may hit the same ceiling. The honest upside of a decision network is calibration (a real "ask" threshold), latency and size. An accuracy gain is unproven.
- Decision models produce **no arguments**. LFM2.5-350M stays for step 2 (args, copy-span grammar), so any new model adds to the download.

---

## 0. In-repo facts that change the options

1. **Why our likelihood scoring was slow** [src: `op-scorer.ts`, `llm-client.ts`, results doc l.506, `results-r8-C2-k{3,5}.json`]:
   - `scoreOptions` sends **one `createChatCompletion` per option**, sequentially. Each one forces the whole answer `{"ops": ["model:KEY"]}` with a one-literal GBNF grammar and sums the token logprobs.
   - The prompt prefix *is* cached (`cache_n` 147, `prompt_n` 4). The cost is the forced answer tokens, decoded one per step: **123–160 ms for 17–18 forced tokens per option**.
   - Measured: C2 k=3 (4 answers) had a median op time of 831 ms, and k=5 (6 answers) 1,232 ms. That is about 200 ms per extra option. [inf] By extrapolation, scoring the full scoped list (16–19 options) would take about 3 s. The split-model note estimated 1.5–2.5 s; the difference is unresolved.
   - Every option re-decodes the shared prefix `{"ops": ["model:` before its distinct tokens.
2. **Token trie of the op keys** (LFM2.5 tokenizer, computed here) [src]:
   - After the common prefix, the keys differ by 6–10 tokens.
   - Each model's trie has only **2–8 branching points** (44 across all 12 models). project, the worst case, has 8.
   - The first diverging token separates 2–10 groups. It identifies the verb group, not the op.
3. **wllama 3.8.1 is still the newest npm release** (3.7.0 and 3.8.1, both 2 Oct 2026) [src: `npm view`]. d1 support therefore still needs a rebuild.
4. **What wllama 3.8.1 exposes** [src: vendored `wllama.js`]:
   - `createSystemOne`, `createRerank` (needs `embeddings: true, pooling_type: "rank"`, and loops one request per document), `createEmbedding`, and `lora_adapters` at load time.
   - It runs an embedded llama-server with `n_parallel` 4, `kv_unified` and `cont_batching`.
5. **llama.cpp classifier heads** [src: llama.cpp `46ca246`, the commit wllama pins]:
   - Core supports multi-class heads: `classifier.output_labels` → `n_cls_out`, rank pooling returns `n_cls_out` floats.
   - `conversion/bert.py` registers `BertForSequenceClassification`, `RobertaFor…`, `XLMRobertaFor…`, `DistilBertFor…`, `NeoBERTFor…` and `ModernBertForSequenceClassification`.
   - **But the server's `send_rerank` returns only `embd[0]`**, so `createRerank` gives one score. A 100-class head through wllama would need a wllama/server patch. A cross-encoder (one score per pair) works through `createRerank` today, but needs a second wllama instance, because it is a second model.
6. **The vendored onnxruntime-web is the WASM build only** (`ort-wasm-simd-threaded.asyncify`, 23.6 MB) [src]. Connect is not cross-origin isolated, so it runs single-threaded. Measured gte-small in that build: 28–40 ms median per query (p90 38–71 ms). Embedding the 99 op descriptions took 11.5–12 s once.
   - An ORT **WebGPU** path would mean vendoring the JSEP/WebGPU build as well [inf].
7. **Training data** [src]:
   - `training/artifacts/teacher-full/agreed-s1.jsonl` holds 3,286 rows: `{id, utterance, docType, op, args, meta}` with `op` set to `model:OP` or null (358 no-action rows). It covers 97 ops, with 4 to 41-plus rows per op (about 30 on average).
   - `training/artifacts/round10/final-in/rows.jsonl` has 4,610 rows. It is a **superset**: all 3,286 `agreed-s1` ids are in it, so use that one file and do not concatenate the two.
   - The Round 8 val split is `round8/split/val.jsonl` (168 rows, teacher distribution).
   - The held-out sets (`spike/llm-harness/eval/heldout{,2,3,4}-eval.json`) are `{items:[{id, utterance, context:{docType, model, state}, expected:{op, args}, style, difficulty, tags}], noAction, multiAction}`.
   - **This is directly a labelled classification dataset.**

---

## 1. Candidates

### 1a. Open "System One" decision models (Jev-likes)

All of the models below are verified on the HF API as **not gated, weights downloadable**.

| Model | Base / params | Licence | Browser artefact (size) | Runtime | Option limit | Published accuracy |
|---|---|---|---|---|---|---|
| **Julia-1** | mmBERT-small, 144M | Apache-2.0 | `ggml-org/Julia-1-GGUF` Q8 168 MB; `SupersonicLabs/Julia-1-ONNX` fp32 577 MB + its own WebGPU adapter | wllama 3.8.1 `createSystemOne` (laya type); ORT WebGPU 75 ms/request (Brave/Linux, batch 4) | 2–20 | Banking77 pilot (72 labels): 64% zero-shot vs Jev 87%; typed decisions 73% |
| **Laya** | ModernBERT-large, 421M | Apache-2.0 | `ggml-org/Laya-GGUF` Q8 449 MB | wllama 3.8.1; decision.js (Apache-2.0, not on npm) 39 ms on M5 Pro | head budget 192 tokens (≈9 tokens/option at 19 ops) | Banking77 42.5% zero-shot; typed decisions 0.362 → 0.766 after a domain fine-tune (Kaggle 2×T4 notebook) |
| **Kev-0.6B** | Qwen3-0.6B-Base + LoRA + pointer head | Apache-2.0 | `onnx-community/kev-0.6b-ONNX` q4f16 335 MB / q4 375 MB | **transformers.js 4.x** via `open-jev` (npm, MIT) on WebGPU | 1–255, all questions in one pass | ID 0.808 / OOD 0.642 on the locked test; "use 4B for accuracy" |
| **Kev-0.8B** | Qwen3.5-0.8B + LoRA | Apache-2.0 | `ggml-org/Kev-0.8B-GGUF` Q8 812 MB | wllama 3.8.1 (kev type) | 1–255 | the card warns about paraphrase |
| open-jev-deberta-v3-large | DeBERTa-v3-large | Apache-2.0 | `onnx-community/open-jev-deberta-v3-large-ONNX` q4 477 MB | `open-jev` | up to 255 | 0.916 on Banking77, but it was **trained on Banking77**, so that is in-domain |
| d1-omni-600M | LFM2.5-Encoder-350M | **LFM Open License v1.0** (commercial use only under $10M annual revenue) | `LiquidAI/d1-omni-600M-GGUF` Q8 407 MB; ONNX `decision_q4` 201 MB + `embed_tokens` | **not** wllama 3.8.1 (needs a rebuild); decision.js 34 ms; ORT WebGPU about 60 ms/question on M3 Pro (a voice-stack measurement) | 255 | – |
| d1-3B | LFM2.5-VL-3B | LFM v1.0 | Q4 1.67 GB | rebuild / decision.js 166 ms | 255 | – |
| lev / Kev-4B | Qwen3.5-4B LoRA | Apache-2.0 | Q4 3.0 GB | too big for this tab | | |
| OpenJev / Nimble-9B | 27B / 9B | **CC BY-NC 4.0** | 6–19 GB | no (licence and size) | | |
| Clef | 27B | Apache-2.0 | 19 GB | no (size) | | |

Notes on the table:
- Our base LFM2.5-350M is already under the LFM licence, so d1 adds no new licence term.
- Every Jev-like takes options as text descriptions, so the label space is defined at request time.
- **Fine-tuning:**
  - Kev has public tooling (`kev.train --init_from jaredpalmer/kev-0.6b|kev-0.8b --device mps`) and a JSONL format that maps one-to-one from our rows. ONNX or GGUF export of a *fine-tuned* checkpoint is **not documented** in the Kev README. llama.cpp's converter has a `KevModel` path; the onnx-community export script is unverified.
  - Laya has a Kaggle notebook.
  - Julia-1 has no public trainer, so it is zero-shot only.

Sources: [ggml-org blog](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp) · [Julia-1](https://huggingface.co/SupersonicLabs/Julia-1) · [Julia-1-ONNX benchmark](https://huggingface.co/SupersonicLabs/Julia-1-ONNX/blob/main/benchmark-webgpu.json) · [Laya](https://huggingface.co/convaiinnovations/laya) · [kev-0.6b-ONNX](https://huggingface.co/onnx-community/kev-0.6b-ONNX) · [kev repo](https://github.com/jaredpalmer/kev) · [open-jev](https://github.com/nico-martin/open-jev) · [decision.js](https://github.com/Jacqkues/decision.js) · [d1-omni ONNX](https://huggingface.co/onnx-community/d1-omni-600M-ONNX) · [LFM licence](https://huggingface.co/LiquidAI/d1-omni-600M/blob/main/LICENSE) · [open-jev-deberta](https://huggingface.co/com-kotobalabs/open-jev-deberta-v3-large)

### 1b. Small encoder classifiers (transformers.js / onnxruntime-web)

These are verified on the HF API. Sizes are int8/quantized ONNX.

| Model | Licence | Quantized ONNX | Kind |
|---|---|---|---|
| gte-small (**already shipped**) | MIT (Supabase) | 34 MB | embedder, so a **trained head on frozen embeddings** costs 0 extra download |
| all-MiniLM-L6-v2 | Apache-2.0 | 23 MB | embedder / fine-tune base |
| ModernBERT-base | Apache-2.0 | 151 MB (q4f16 140) | fine-tune base; llama.cpp can convert `ForSequenceClassification` |
| deberta-v3-small | MIT | no ONNX in the repo (export needed) | fine-tune base |
| ms-marco-MiniLM-L6-v2 cross-encoder | Apache-2.0 | 23 MB (Xenova) | reranker: score (utterance, op description) |
| jina-reranker-v1-tiny-en | Apache-2.0 | 33 MB | reranker; runs in llama.cpp rank pooling |
| mxbai-rerank-xsmall-v1 | Apache-2.0 | 87 MB | reranker |
| gte-reranker-modernbert-base | Apache-2.0 | 151 MB | reranker |
| bge-reranker-base / v2-m3 | MIT (`BAAI/bge-reranker-base` checked on the HF API) | 279 / 571 MB | reranker (too big for v2-m3) |
| MoritzLaurer deberta-v3-xsmall-zeroshot-v1.1 / Xenova nli-deberta-v3-xsmall | MIT | 87–90 MB | zero-shot NLI, one pass per option |
| MoritzLaurer ModernBERT-base-zeroshot-v2.0 | Apache-2.0 | 151 MB | zero-shot NLI |

**SetFit:**
- It is a Python training method: a contrastive fine-tune of a sentence-transformer, then a logistic-regression head. It ships as the ONNX body plus a weight matrix.
- No JS package is needed: the head is a dot product.
- A fine-tuned gte-small body would be a *second* 34 MB file, because the graph indexer must keep the stock gte-small.

**Expected accuracy, from the literature:**
- Casanueva et al. 2020, Table 3 ([arXiv 2003.04807](https://arxiv.org/abs/2003.04807)), at 10 / 30 / full examples per intent:

  | | BANKING77 | CLINC150 |
  |---|---|---|
  | Fine-tuned BERT | 83.4 / 90.0 / 93.7 | 91.9 / 95.5 / 96.9 |
  | Frozen encoders + a small MLP (USE+ConveRT) | 85.2 / 90.6 / 93.4 | 93.3 / 96.1 / 97.2 |
  | Frozen BERT | 67.6 / 80.1 / 87.2 | 80.2 / 88.0 / 91.8 |

- **Frozen sentence encoders with a trained head match fine-tuning in exactly our ~30-per-class regime.** This supports the zero-download gte-small head. The weak frozen-BERT row is a warning that the encoder matters.
- SetFit ([arXiv 2209.11055](https://arxiv.org/abs/2209.11055)) gains most at 8–64 examples per class. On Banking77 it is "comparable" by about 20 examples per class ([Loukas et al. 2023](https://arxiv.org/abs/2311.06102)).
- Zero-shot NLI is weak on fine-grained intent: deberta-v3-base-zeroshot-v2.0 scores **0.42 on Banking77** ([card](https://huggingface.co/MoritzLaurer/deberta-v3-base-zeroshot-v2.0)), and Laya zero-shot 0.43. So NLI or Jev-likes would need fine-tuning on our rows.

**Comparison with our 350M LoRA [inf]:**
- On in-distribution rows, a trained encoder head should land close to the LoRA's ~93% on teacher-distribution validation. Scoped 4–19-way classification is easier than 77/150-way.
- On blind paraphrases, the evidence points the other way. gte-small *zero-shot* (cosine to the op descriptions) reached 47% scoped on held-out-2, against the LoRA's 73.6% [src]. A trained head should close part of that gap, but **expect ≤ LoRA on paraphrases until measured**.
- The real gains are about 30–40 ms instead of about 150 ms, a 0 MB download for the gte-small head, and calibrated probabilities.

**Latency:**
- gte-small with a head: 28–40 ms [src, measured in Connect's single-threaded WASM].
- A MiniLM-L6 fine-tune: roughly half that [inf].
- ModernBERT-base: about 100–200 ms on single-threaded WASM [inf].
- A cross-encoder over 16 pairs: 16 sequences, so a few hundred ms on WASM [inf]. WebGPU through wllama `createRerank`, or a vendored ORT WebGPU build, would be faster. Unmeasured.

### 1c. GLiNER / GLiClass

- **GLiNER:**
  - `onnx-community/gliner_small-v2.1` is int8 183 MB and `gliner_multi-v2.1` int8 349 MB (Apache-2.0 upstream).
  - JS runtime: npm `gliner` 0.0.19 (MIT, onnxruntime-web, last published 2025-03).
  - It extracts spans for labels given at request time, which fits our **free-text arg spans** (span-boundary errors).
  - It does **not** fit ref selection. Our refs are a choice from a list of document-state candidates, already about 95% right given the right op [src: findings]. Low priority.
- **GLiClass:**
  - `knowledgator/gliclass-small-v1.0` has an ONNX file (int8 174 MB, Apache-2.0). The v3 edge/modern models have safetensors only.
  - No JS package was found. There is a C engine ([GLiClass.c](https://github.com/Knowledgator/GLiClass.c)). The browser path would mean writing the pre- and post-processing around ORT ourselves.
  - It is a label-conditioned multi-class model, similar in role to a Jev-like, with no advantage over Kev or a cross-encoder for us [inf].

### 1d. The LLM we already ship, as a decision model

The current approach costs N sequential forced generations (section 0.1). There are three ways to get there in one or a few passes:

1. **Free, no retrain: read the distribution already computed during the R2c pick.**
   - Request `logprobs`/`top_logprobs` on the step-1 generation. llama.cpp reports them before the grammar mask, which `op-scorer.ts` already relies on.
   - At each branching token on the greedy path (2–8 per model) you get the probability mass of the sibling branches.
   - That is an exact `{"ops": []}` vs action probability, and the verb-group margin, at **about 0 ms extra**.
   - It does not score options that branch off later in the sequence.
2. **Trie scoring: exact scores in ≤8 short requests instead of 16–19 long ones.**
   - Request once per branching node: prompt plus the forced prefix to that node, then 1 generated token with `top_logprobs` ≥ the branching factor. Tokens after the last branch point are near-deterministic, so they can be ignored or scored once.
   - Cost is bounded by the 44 branching nodes overall, at most 8 per model.
   - **Risk:** prefilling the forced prefix as text was tried and moved scores at the token boundary [src l.507]. Prefix tokens must be passed as **token ids**. llama-server tokenizes mixed text and token-id prompts (`tokenize_mixed` is in the pinned source) [src]. Whether wllama's `createCompletion` passes token arrays through is unverified.
   - Firing the requests concurrently (`n_parallel` 4, `cont_batching`) might give up to about 4× more [inf]. Concurrency on one instance hung once (two harness runs), so this is unproven.
3. **Truly one decode step: single-token option labels.**
   - Render options as `A: key: description …` and train the answer as the letter. One decode step with `top_logprobs` ≥ 19 then gives the full calibrated distribution. It can be the same call as the pick.
   - Needs a re-render (no teacher cost) and a retrain (about 52–80 min), with option-order shuffling against position bias.
   - It loses the key name's semantic prior in the answer tokens, which is a possible accuracy cost [inf].

---

## 2. Which decision each candidate fits

| Decision | Best fit | Why |
|---|---|---|
| No action vs action | 1d-1 (free), gte-small head (binary), Kev `noul` | Calibrated probability; today it is a hard grammar pick |
| Confirm vs clarify (ask threshold) | 1d-1 / 1d-2 margins; LoRA pick ≠ classifier pick as a trigger | Feeds the top-3 confirm experiment, which needs scores |
| Full op (scoped) | gte-small head with logits masked to the scoped ops; Kev-0.6B `choice` (fine-tuned) | Head: cheapest. Kev: description-conditioned, so it might generalize differently on paraphrases (untested) |
| Target entity/field (where the errors are) | Kev / cross-encoder over `(verb, target)` frame labels | Needs label text. A class-id head cannot use descriptions |
| Verb | anything; the LoRA is already at 91–96% | Low headroom |
| Document-type routing (unscoped, drive level) | gte-small head over 12 types + drive ops + question | Few classes, about 270 rows each; **needs a drive-level eval set**, because current rows are written for scoped use |
| Ref selection | keep the existing calibrated label scoring (about 95%) | Kev `choice` over candidate labels is possible; low headroom |
| Free-text arg spans | GLiNER (183 MB) | Possible, but large; not now |

---

## 3. Recommendation: top 3 and the cheapest test of each

**1. Trained head on frozen gte-small (zero new download, zero new runtime).**
- *Experiment (about 2 h, offline, no browser):*
  - Embed `utterance` (optionally prefixed with the docType) for `round10/final-in/rows.jsonl` (4,610 rows, a superset of `agreed-s1`) with the same gte-small q8 ONNX, using onnxruntime-node or sentence-transformers. `training/.venv` has torch, transformers and peft but **not** scikit-learn or sentence-transformers, so one `pip install` comes first.
  - Fit multinomial logistic regression over `model:OP` + none.
  - At test time, softmax over the scoped model's ops + none.
  - Report accuracy on `round8/split/val.jsonl` (sanity) and once on a blind set:
    - op top-1/top-3 and no-action precision/recall;
    - accuracy-vs-confidence;
    - **agreement with the LoRA pick**, and accuracy on items where they agree or disagree. This is the "ask" trigger.
- *Then, if promising:* fully fine-tune MiniLM-L6 or ModernBERT-base `ForSequenceClassification` on MPS (minutes) and export to int8 ONNX (23 / 151 MB).
- *Bar:* not "beat the LoRA". Either (a) disagreement flags most LoRA errors at an ask rate ≤ 30%, or (b) the head matches the LoRA's op accuracy at about 35 ms.

**2. Kev-0.6B as a description-conditioned decision model (Apache-2.0, transformers.js via `open-jev`, 335 MB).**
- *Zero-shot experiment (half a day):* in Python (`kev`) or Node (`open-jev` + transformers.js), one `choice` over the scoped ops with their descriptions, plus a none option and a `noul` "changes the document?". Run it on val, then on a blind set.
- *Fine-tune (if it is within about 10 points):* `kev.train --init_from jaredpalmer/kev-0.6b --device mps` on our rows mapped to its JSONL. Hard negatives come for free, since the options are the sibling ops.
- *Blocker to check first:* a path from a fine-tuned checkpoint to ONNX (the onnx-community export) or to GGUF (llama.cpp `KevModel`, which wllama 3.8.1 loads).
- Julia-1 (168 MB, wllama-native) is the cheaper zero-shot comparison to run alongside. It has no trainer, and scoped ops + none comes to 19–20 options, at or just under its 20-option limit.

**3. Make our LoRA's own scores one-pass (1d-1, then 1d-2).**
- *Experiment (hours):* turn on `logprobs` for the R2c step-1 call and log the per-branch probabilities. Implement trie scoring with token-id prefixes and check that it reproduces `scoreOptions` sums on dev rows to within about 1e-3.
- This turns the top-3-confirm experiment's estimated +1.5–2.5 s full-list scoring into ≤8 short requests (or 0 ms for the no-action and verb margins).
- Retrain with letter labels (1d-3) only if trie scoring is still too slow.

**Not recommended now:**
- d1: needs a wllama rebuild or a second runtime, and is under the LFM licence.
- Laya: 449 MB, and its 192-token head budget is tight at 19 ops.
- Zero-shot NLI: about 0.42 on Banking77-like tasks.
- GLiNER: 183 MB+, and it targets args, not op choice.
- Anything ≥ 4B.

**Held-out sets:**
- held-out-3 has had 7 runs.
- held-out-4 has had E8, E10 and the split-model read. Using it here would be another use of it, and the top-3 experiment also wants it.
- Prefer a fresh blind held-out-5 shared by all three experiments, with configs pre-registered. That is a user decision.

## 4. Unverified

- Browser latency for Kev-0.6B ONNX (no published number), cross-encoders, and ModernBERT on our single-threaded WASM ORT.
- Whether wllama `createCompletion` accepts token-id prompts.
- Whether concurrent requests on one wllama instance batch safely.
- Export of a fine-tuned Kev to ONNX or GGUF.
- Whether a multi-class `ForSequenceClassification` GGUF returns all classes through wllama: the source says only `score[0]` reaches `createRerank`.
- Every accuracy figure for *our* task. The literature numbers are for in-distribution test splits, not for a teacher-vs-human wording shift.
