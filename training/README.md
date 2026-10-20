# LoRA pipeline for LFM2.5-350M (local, Apple Silicon)

This directory builds training data for the chat's two steps (op choice, then arguments) and fine-tunes `LiquidAI/LFM2.5-350M` with LoRA. It then ships the result as a merged Q4_K_M GGUF that wllama 3.8.1 loads like today's file.

**Status (2026-10-20):**
- The pipeline is built and smoke-tested end to end on this Mac.
- The teacher pilot exists only as a dry run, because no `ANTHROPIC_API_KEY` was set.
- Full data generation and the real training run are on hold until round 6 fixes the runtime prompt format.

The plan is the scratchpad `lora-plan.md` from the spike session. Spike results are in `docs/superpowers/specs/2026-10-20-in-browser-llm-spike-results.md`.

## Stack

| Stage | Tool | Why |
|---|---|---|
| Prompt bytes | `gen/*.ts` via `npx --no-install tsx` | Calls the chat core's own `buildVaultCatalog`, `createOpRetriever`, `selectOpMessages`, `fillArgsMessages` and `buildModelSchema`. Nothing is reimplemented. |
| Prompt string and token ids | native `llama-server` at **b11364** (`46ca246`, the libllama inside wllama 3.8.1), `--no-jinja`, `/apply-template` + `/tokenize` | This is the same template and tokenizer path the runtime uses. Each run is also checked against the HF tokenizer. |
| Training | **TRL 1.16 `SFTTrainer` + PEFT 0.21 on MPS**, bf16 | Rows are pre-tokenized `input_ids` + `completion_mask`, so prompts are never re-templated and loss covers only the target. PEFT `merge_and_unload` writes an HF checkpoint the converter accepts. |
| Export | llama.cpp b11364 `convert_hf_to_gguf.py` (bf16), then `gguf_new_metadata.py`, then `llama-quantize Q4_K_M` | LFM2 is registered in `conversion/lfm2.py` at that tag. |

**Why not the alternatives:**
- **mlx-lm 0.32.2**, read from source, not run:
  - It supports LFM2 (`models/lfm2.py`), and its default LoRA keys cover every `nn.Linear`, including the conv-block projections.
  - But its prompt/completion loader (`CompletionsDataset`) re-applies the chat template.
  - Its raw-text loader (`TextDataset`) refuses prompt masking ("Prompt masking not supported for text dataset").
  - So byte-parity plus completion-only loss would need custom loader code.
  - `mlx_lm.fuse` saves MLX-layout weights (`sanitize` transposes `conv.weight` on load), and its GGUF export has no LFM2 path. Round-tripping into `convert_hf_to_gguf.py` is **[U]**.
  - At 350M, TRL on MPS already runs at about 11 sequences/s, so MLX's speed would not change the outcome.
- **leap-finetune / Unsloth:** CUDA-focused (see the plan).

## Layout

| Path | What it does |
|---|---|
| `scripts/setup.sh` | Creates the venv and clones and builds llama.cpp b11364 plus `schema2gbnf` into `$BAI_TRAINING_TOOLS` (default `~/.cache/bai-training`, **outside the repo**: the root tsconfig includes `**/*`, and llama.cpp ships about 750 `.ts` files). Downloads the weights into `models/`. |
| `gen/prompt-format.ts` | **The only file round 6 should need to change.** It holds the catalog options, k, the step-1/step-2 builders, the target shapes and `PROMPT_FORMAT_VERSION`. |
| `gen/render-prompts.ts` | Turns source rows into step-1/step-2 messages, runtime JSON schemas, llama.cpp grammars and canonical targets. Every target is checked against the grammar llama.cpp derives from the runtime schema. It also writes a manifest (format version, catalog sha256, git HEAD, dirty chat-core files). |
| `gen/validate-rows.ts` | zod check (`buildAction`, the generated `<Op>InputSchema()` creator), then reducer replay on a fresh document after optional `fixture` steps. |
| `gen/export-teacher-context.ts` | Per-op teacher context: description, SDL, semantic schema, reducer source, siblings, empty state. |
| `gen/gbnf-check.ts` | A copy of the round-5 test recognizer, plus support for `{m,n}` repetition. |
| `tools/schema2gbnf.cpp` | Prints the GBNF that llama.cpp's `json_schema_to_grammar` builds, using the b11364 `common/` code. |
| `py/dedup.py` | Leak and duplicate filter (details below). |
| `py/render_template.py` | Renders prompts through llama-server, with template and token parity checks against HF. |
| `py/train_lora.py`, `py/merge.py`, `py/smoke_infer.py` | Train, merge, and run grammar-constrained inference. |
| `py/teacher.py` | The teacher pipeline (`plan`, `submit`, `collect`, `rows`, `label`, `agree`). |
| `scripts/render.sh` | **One command to re-render with the current format:** dedup, render, validate, then parity. |
| `scripts/export-gguf.sh`, `scripts/smoke.sh` | GGUF export, and the full smoke run. |
| `data/smoke-rows.jsonl`, `data/smoke-probe-rows.jsonl` | 50 + 4 hand-written rows. None come from an eval set. |
| `results/smoke-2026-10-20.json` | The observed smoke numbers. |

`.venv/`, `artifacts/`, `models/`, GGUFs and safetensors are gitignored.

**The leak and duplicate filter (`py/dedup.py`):**
- It walks every JSON file under `spike/llm-harness/eval/` for `utterance` keys. That covers held-out, `noAction`, dev-extra and seed today, and a second held-out set dropped there is covered automatically.
- It rejects a row on a normalized exact match, or a char- or word-trigram Jaccard of 0.5 or more against any eval utterance.
- It also rejects a near-duplicate of a row already kept for the same op (word trigrams, 0.5 or more).

## Commands

```bash
training/scripts/setup.sh                                    # once
training/scripts/render.sh <rows.jsonl> <out-dir>            # data -> train.jsonl
training/.venv/bin/python training/py/train_lora.py <out-dir>/train.jsonl --out <run> [--max-steps N]
training/.venv/bin/python training/py/merge.py <run>/adapter --out <run>/merged --check <out-dir>/train.jsonl
training/scripts/export-gguf.sh <run>/merged <prefix>        # -> <prefix>-BF16.gguf, <prefix>-Q4_K_M.gguf
training/.venv/bin/python training/py/smoke_infer.py <rendered.jsonl> --gguf <a.gguf> --gguf <b.gguf> --out r.json
training/scripts/smoke.sh 20                                 # everything above on the smoke rows
```

Source row: `{"id", "utterance", "docType", "op": "<model>:<OP>" | null, "args"?, "refCandidates"?, "fixture"?: [{op, args}], "scoped"?}`.

## Smoke test (observed, 2026-10-20, M4 Max 36 GB, macOS 26.6.2)

**Data:**
- 50 hand-written rows went in.
- `dedup.py` rejected 1: "summarize this for me" scored 0.778 against dev-extra `dn-06`, "summarize this map for me".
- 49 rows passed zod and reducer replay. The ARCHIVE_NOTE row needs a submit-then-approve fixture.
- That gave 94 rendered steps.
  - 8 have no target: 4 are no-action and 4 are gold-not-retrieved (ADD_MEMBER ×2, ADD_DELIVERABLE, SET_DESCRIPTION).
  - The other 86 are trainable.
- **Parity:**
  - 86/86 prompt strings equal HF `apply_chat_template`, apart from the BOS. The server's built-in template leaves `<|startoftext|>` out of the string, and its tokenizer adds BOS id 1.
  - 86/86 token-id sequences are identical.
  - Each row has exactly one BOS.
  - 0 prompt/target token merges.
  - 86/86 targets are accepted by the runtime grammar.

| Stage | Wall | Max RSS | Notes |
|---|---|---|---|
| llama.cpp build (server, quantize, cli, tokenize) | 33.5 s | – | 239 s CPU |
| Weights download (709 MB safetensors + 229 MB GGUF) | 57 s | – | network-bound |
| `render.sh` (dedup, tsx render, validate, llama-server parity) | 19.2 s | 412 MB | mostly tsx and the catalog build |
| Train, 20 steps × batch 8, bf16, MPS | 18.0 s (trainer 14.7 s) | 1.05 GB | **peak footprint 7.87 GB**; MPS driver 6.18 GB; loss 2.63 → 0.043; 5,996,544 trainable params (1.66%) |
| Merge (fp32, saved bf16) | 4.2 s | 2.52 GB | max logit diff against base+adapter 2.4e-4; argmax agrees on every position |
| Convert to bf16 GGUF | 4.5 s | 1.01 GB | 711,485,152 B |
| Carry over chat template | 1.6 s | 1.00 GB | |
| Quantize to Q4_K_M | 1.7 s | 0.56 GB | **229,312,224 B**, byte-for-byte the same size as Liquid's published Q4_K_M |
| Inference: 2 GGUFs × 8 prompts | 1.8 s | 0.45 GB | Metal, temperature 0 |

**Inference** ran on 4 utterances that were not trained on. Step 1 used a GBNF enum over the 5 candidate keys. Step 2 used the runtime json-schema grammar.
- The base Q4_K_M got 3/4 ops and 1/4 args exact. Its step-2 outputs carry the spike's newline and tab runs.
- The smoke Q4_K_M got 4/4 ops and 2/4 args exact. Its outputs are compact and stop on `<|im_end|>`.
- Misses: `"Ine"` for "Ines", and `"assignee": "null"`.
- This is 4 probes after 20 steps on 86 rows. It shows the pipeline works. **It is not an accuracy result.**
- Step 1 still decodes about 13–16 tokens, because llama.cpp emits each grammar-forced token.

**Extrapolation, not measured:** 160 sequences took 14.7 s, about 11 sequences/s. At that rate, about 16k rows × 3 epochs would take about 75 min on this machine.

### Things found on the way

- **transformers 5 is required.** LFM2.5-350M ships a `TokenizersBackend` tokenizer that 4.57.6 cannot load. b11364's converter pins 4.57.6 but converted fine under 5.20.2.
- **Jinja defaults to on in b11364's `llama-server`,** so every script passes `--no-jinja` to match wllama.
- **The HF repo's `chat_template.jinja` (5,487 chars) is newer than the template in the published GGUF (2,553 chars).** The rendering matched for our message shapes. `export-gguf.sh` still writes the published GGUF's template into ours, so the shipped file renders exactly like today's, with jinja on or off.
- **The working tree moves under us** (round 6 is being edited in parallel). The render manifest records the git HEAD and any dirty chat-core files, so every dataset is traceable.

## Teacher pilot: dry run only

No `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` was set, and the `ant` CLI is not installed. So nothing was sent, and **no tokens or cost were measured.**

The generator is `py/teacher.py`:
- It uses `claude-sonnet-5` through the Message Batches API.
- Requests use adaptive thinking and `output_config.format` JSON schemas. The args schema is the op's semantic schema, with the constraints structured outputs rejects stripped out.
- The **pilot** (`plan --ops pilot`) is 20 requests for 100 items, across 4 models:
  - knowledge-note: ADD_TOPIC, SET_TITLE, SUBMIT_FOR_REVIEW, REJECT_NOTE
  - project: SET_PROJECT_STATUS, ADD_MEMBER
  - wbs: CREATE_GOAL, SET_GOAL_STATUS
  - tension: RESOLVE_TENSION
  - plus 10 no-action items (knowledge-note, wbs).

**Validation chain.** It was exercised on the smoke rows and on hand-made fake teacher output, not on real teacher output:
1. `teacher.py rows` checks grounding. Free-text values must be utterance substrings, and an optional field needs an evidence span. Truncated (`max_tokens`) responses are dropped.
2. `render.sh` runs dedup and the leak filter, renders with the chat core, checks targets against the grammar, runs zod plus reducer replay, and checks template and token parity.
3. `teacher.py label` builds a blind second pass. It sees only the utterance and the real BM25 candidates plus `none`, at low effort.
4. `teacher.py agree` keeps a row only when the blind op and args match.

To run the pilot:

```bash
export ANTHROPIC_API_KEY=...
P=training/.venv/bin/python; A=training/artifacts/teacher
npx --no-install tsx training/gen/export-teacher-context.ts $A/context.json
$P training/py/teacher.py plan --context $A/context.json --out $A/pilot-gen-requests.jsonl
$P training/py/teacher.py submit $A/pilot-gen-requests.jsonl --yes-spend      # prints batchId
$P training/py/teacher.py collect <batchId> --out $A/pilot-gen-results.jsonl   # + .usage.json (actual cost)
$P training/py/teacher.py rows $A/pilot-gen-results.jsonl --context $A/context.json --out $A/pilot-rows.jsonl
training/scripts/render.sh $A/pilot-rows.jsonl $A/pilot
$P training/py/teacher.py label $A/pilot/rendered.jsonl --context $A/context.json --out $A/pilot-label-requests.jsonl
# submit + collect the label batch, then:
$P training/py/teacher.py agree <label-results.jsonl> --rows $A/pilot/rows-kept.jsonl --out $A/pilot-agreed.jsonl
```

**Cost: estimates only, not measured.** Input is counted as chars/4. Output is a guess of about 70 visible tokens per item plus 300–3,000 thinking tokens per request. Prices are Sonnet 5's $2 / $10 per MTok, with batches at 50%.

| Run | Requests | Input tokens (est.) | Output tokens (guess) | Batch cost |
|---|---|---|---|---|
| Pilot generation (100 items) | 20 | 26.9k | 13k–67k | $0.09–$0.36 |
| Full generation (`--ops all --requests-per-op 12 --items 10`: 12,000 items, 99 ops + 12 no-action) | 1,200 | 1.72M | 1.2M–4.4M | $7.7–$23.9 |
| Full blind label pass (about 275 input tokens per row, from the 49-row smoke label plan) | ~12,000 | ~3.3M | 0.4M–6M | ~$5–$33 |
| **Full total (extrapolation)** | | | | **~$13–$57** |

The ~16k-row target comes from the plan: about 12k generated utterances, filtered down to about 6k single-action rows, which give step-1 and step-2 rows, plus about 1.5k regularization rows. The regularization rows are self-distilled from the base model, so they cost nothing in API.

The first real pilot replaces this table with `collect`'s `.usage.json`.

## Waiting on round 6, then on the user

1. **Round 6: the final runtime prompt format.** Change only `gen/prompt-format.ts`:
   - How no-action is written (today such rows are skipped with `skip: "no-action"`, and so are gold-not-retrieved rows).
   - Ref-id labels (`refCandidates` become labels).
   - Enum vocabularies (`buildVaultCatalog` options).
   - Whether step 1 switches to the scorer layout.

   Then bump `PROMPT_FORMAT_VERSION` and re-run `render.sh` on the smoke rows to re-check parity.

   Commit `eed52510` already adds `args-step.ts` (ref choices by label), the yes/no change gate, and gte-small embedding retrieval with RRF fusion. `use-chat-llm.ts` does not use them yet.
   - If the shipped path adopts them, `prompt-format.ts` must call them too.
   - The embedding retriever then has to run under node in `render-prompts.ts`, so that training candidates are the ones the app really retrieves. Whether transformers.js loads gte-small under tsx is **[U]**.
2. **The second blind held-out set** goes into `spike/llm-harness/eval/`. `dedup.py` picks it up automatically.
3. **The user** supplies an API key and approves spend. Then run the pilot as above, read the measured cost and the agreement rate, and only then the full batch (`submit` refuses more than 200 requests unless `--max-requests` is raised).
4. **The real training run** comes after that: 3 epochs, effective batch 32, then a dev-checkpoint pick, export, and the in-browser eval arms.

**Not done here:**
- The in-browser wllama parity check (`createCompletion(prompt, grammar)` against `createChatCompletion`), because Chrome was off-limits.
- Hosting.
- Checking the license for redistributing a derivative.
