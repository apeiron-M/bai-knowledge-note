# LoRA pipeline for LFM2.5-350M (local, Apple Silicon)

This directory builds training data for the chat's two steps (op choice, then arguments) and fine-tunes `LiquidAI/LFM2.5-350M` with LoRA. It then ships the result as a merged Q4_K_M GGUF that wllama 3.8.1 loads like today's file.

**Status (2026-10-20, round 7):**
- The pipeline is built and smoke-tested end to end on this Mac.
- Rows render in the runtime prompt format **r6.1**, through the chat core's own builders, so training and runtime prompts are byte-identical (`tests/unit/training-prompt-format.test.ts`). The render and token-parity step was re-run on the smoke rows in r6.1 (see "Re-render in r6.1" below). The model was not retrained.
- The teacher runs through headless Claude Code (`claude -p`), with no API key needed. The ~100-row pilot ran on 2026-10-21 and kept 73 rows (see "Teacher pilot" below). The full run waits on the user's review.

The plan is the scratchpad `lora-plan.md` from the spike session. Spike results are in `docs/superpowers/specs/2026-10-20-in-browser-llm-spike-results.md`.

## Stack

| Stage | Tool | Why |
|---|---|---|
| Prompt bytes | `gen/*.ts` via `npx --no-install tsx` | Calls the chat core's own `buildRuntimeCatalog` (canonical vocabularies as enums), `scoringMessages` + `forcedOpsText` (step 1) and `prepareArgsStep` + `preparedGrammar` (step 2, the same function `fillArgsStep` uses at run time). Nothing is reimplemented. |
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
| `gen/prompt-format.ts` | The one file that decides a row's shape: candidates, step-1/step-2 prompts from the core builders, target shapes. `PROMPT_FORMAT_VERSION` is re-exported from the core (`chat/core/prompt-format.ts`). |
| `gen/render-prompts.ts` | Turns source rows into step-1/step-2 messages, runtime grammars and canonical targets. Every target is checked against the grammar the runtime uses for that step. It also writes a manifest (format version, catalog and op-embedding sha256, git HEAD, dirty chat-core files). |
| `gen/validate-rows.ts` | Canonical-vocabulary check (`chat/core/vocabularies.ts`; zod does not see these `String` fields), zod check (`buildAction`, the generated `<Op>InputSchema()` creator), then reducer replay on a fresh document after optional `fixture` steps. |
| `gen/export-teacher-context.ts` | Per-op teacher context: description, SDL, semantic schema, reducer source, siblings, empty state. |
| `gen/gbnf-check.ts` | A copy of the round-5 test recognizer, plus support for `{m,n}` repetition. It checks every target against its step's grammar. |
| `../scripts/gte-wasm-node.ts` | gte-small under node on the browser's onnxruntime-web wasm, for unscoped (`scoped: false`) rows' gte-small top-5 candidates. Loaded only when such a row exists. |
| `tools/schema2gbnf.cpp` | Prints the GBNF that llama.cpp's `json_schema_to_grammar` builds. The r6.1 renderer no longer uses it: step 2 decodes under the chat core's copy-span grammar, not a JSON-schema grammar. |
| `py/dedup.py` | Leak and duplicate filter (details below). |
| `py/render_template.py` | Renders prompts through llama-server, with template and token parity checks against HF. |
| `py/train_lora.py`, `py/merge.py`, `py/smoke_infer.py` | Train, merge, and run grammar-constrained inference. |
| `py/teacher.py` | The teacher pipeline (`plan`, `run --teacher cli\|api`, `submit`, `collect`, `rows`, `label`, `agree`). |
| `scripts/render.sh` | **One command to re-render with the current format:** dedup, then validate (rows that fail zod or replay are dropped and listed in `validate.json`), render, and parity. |
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

Source row: `{"id", "utterance", "docType", "op": "<model>:<OP>" | null, "args"?, "refCandidates"?, "fixture"?: [{op, args}], "scoped"?}`. `refCandidates` maps a dotted path to ids or `{id, label}` objects, and `args` hold the ids; the renderer turns ids into labels in step-2 targets.

**What a row renders to (r6.1):**
- **Step 1.** The candidates are every global op of `docType`, in catalog order. With `scoped: false`, they are gte-small's top 5 over all ops, computed on the browser's wasm numerics. The prompt is `scoringMessages(utterance, toOptions(candidates, "key"), "ops")`. The target is `{"ops": ["<key>"]}`, or `{"ops": []}` for a no-action row, which now gets a target. The grammar is the alternation of those answers. The v1 runtime skips this call with the base model and takes gte-small's top-1 instead; a LoRA is trained on it.
- **Step 2.** The prompt is `prepareArgsStep(utterance, entry, refCandidates, "safe")`: labeled refs with a `Choices for` line, the safe optional-field gate, and the fixed key order. The target is compact JSON in that order, with refs as labels. The grammar is the copy-span grammar `fillArgsStep` decodes under (before a ref label is fixed).
- A target its grammar rejects stays in `rendered.jsonl` with `targetAccepted: false`. `render_template.py` lists it under `targetRejectedByGrammar` and does not train on it.

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
  - The *exported* smoke Q4_K_M, with the carried-over template, also renders and tokenizes all 86 prompts identically (`template-report-exported.json`).

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

A second `smoke.sh` run, after the render/validate reorder, reproduced the same GGUF sizes and probe scores, with stage times within 2 s (render 17.4 s, train 18.1 s, export 8.7 s). The table and `results/smoke-2026-10-20.json` are from the first run.

**Inference** ran on 4 utterances that were not trained on. Step 1 used a GBNF enum over the 5 candidate keys. Step 2 used the runtime json-schema grammar.
- The base Q4_K_M got 3/4 ops and 1/4 args exact. Its step-2 outputs carry the spike's newline and tab runs.
- The smoke Q4_K_M got 4/4 ops and 2/4 args exact. Its outputs are compact and stop on `<|im_end|>`.
- Misses: `"Ine"` for "Ines", and `"assignee": "null"`.
- This is 4 probes after 20 steps on 86 rows. It shows the pipeline works. **It is not an accuracy result.**
- Step 1 still decodes about 13–16 tokens, because llama.cpp emits each grammar-forced token.

**Extrapolation, not measured:** 160 sequences took 14.7 s, about 11 sequences/s. At that rate, about 16k rows × 3 epochs would take about 75 min on this machine.

### Re-render in r6.1 (observed, round 7)

`training/scripts/render.sh training/data/smoke-rows.jsonl training/artifacts/smoke-r61` (render and parity only, no training): 16.1 s wall.
- 50 rows went in. `dedup.py` rejected the same 1 row as before.
- Validation dropped smoke-17 at the new vocabulary stage: `noteType "question"` is not in the canonical note types. 48 rows passed.
- That gave 91 steps: 48 step-1 (4 of them no-action, now with `{"ops": []}` targets) and 43 step-2. None was skipped; scoped candidates always include the gold op.
- **3 step-2 targets are rejected by the runtime grammar:** smoke-24 and smoke-25 (`ADD_MEMBER` `role`) and smoke-38 (`CREATE_GOAL` `assignee`). The safe gate drops an optional field that the utterance means but does not name, beside a required one. Round 6 reports the same error on held-out-2 (prj2-07 `role`, prj2-01 `owner`). These rows are not trained on.
- **Parity:** the other 88 steps render identically through llama-server and HF (`templateMismatch` 0, `tokenMismatch` 0), with 0 prompt/target merges and exactly one BOS per row. Prompts are 65–531 tokens.
- Probe rows (`smoke-probe-rows.jsonl`, output `artifacts/smoke-probe-r61`): 8 steps, 7 trainable. probe-03's `ADD_MEMBER` `role` is rejected for the same reason. Parity also holds there.
- Unscoped rows were checked on 2 scratch rows: transformers.js and onnxruntime-web load gte-small under tsx. The gold ADD_TOPIC was rank 1 of 5, and the no-action row got `{"ops": []}`.

The 20-step smoke LoRA and its GGUFs above were trained on the r5 format. They were not retrained.

### Things found on the way

- **transformers 5 is required.** LFM2.5-350M ships a `TokenizersBackend` tokenizer that 4.57.6 cannot load. b11364's converter pins 4.57.6 but converted fine under 5.20.2.
- **Jinja defaults to on in b11364's `llama-server`,** so every script passes `--no-jinja` to match wllama.
- **The HF repo's `chat_template.jinja` (5,487 chars) is newer than the template in the published GGUF (2,553 chars).** The rendering matched for our message shapes. `export-gguf.sh` still writes the published GGUF's template into ours, so the shipped file renders exactly like today's, with jinja on or off.
- **The working tree moves under us** (round 6 is being edited in parallel). The render manifest records the git HEAD and any dirty chat-core files, so every dataset is traceable.

## Teacher: headless Claude Code (`claude -p`)

The teacher is `claude-sonnet-5`, called through **headless Claude Code** by default, so no API key is needed: it uses the logged-in Claude Code account. `py/teacher.py run --teacher cli|api` runs a request JSONL (from `plan` or `label`) and writes the result JSONL that `rows` and `agree` read. `--teacher api` still submits the same requests as one Message Batch and collects it (needs `ANTHROPIC_API_KEY` and `--yes-spend`).

**The exact command per request** (Claude Code 2.1.280), run from an empty directory (`--cli-cwd`, default `$TMPDIR/bai-teacher-cwd`; `run` refuses a non-empty one), with the user prompt on stdin:

```bash
claude -p --output-format json --tools "" \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources "" --safe-mode --disable-slash-commands --no-session-persistence \
  --model claude-sonnet-5 --effort <request effort: medium | low> --max-budget-usd 1.0 \
  --system-prompt "<the request's system prompt>" --json-schema '<the request's output schema>' \
  < <the request's user message>
```

- The child's environment drops the parent session's variables (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT`) and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`.
- `--tools ""` gives no tools. `--strict-mcp-config` with an empty config gives no MCP servers. `--setting-sources ""` reads no user, project or local settings. `--safe-mode` disables CLAUDE.md, installed plugins and their hooks, skills, the claude.ai connectors and auto-memory. `--no-session-persistence` keeps the runs out of `~/.claude/projects`.
- `--system-prompt` replaces Claude Code's system prompt with the teacher's (`SYSTEM`, `NO_ACTION_SYSTEM`, `LABEL_SYSTEM`, the same text the API path sends).
- Structured output comes from `--json-schema`. The CLI implements it as a tool call (`stop_reason: "tool_use"`, 2 turns), not constrained decoding, so `run` re-checks every `structured_output` against the schema. A response that fails the check, a timeout (`--timeout`, 300 s) or a CLI error is retried (`--retries 3`, backoff 5/15/45 s) and is never written as data.
- `run` first calls `claude auth status`. If the account is not logged in, or a call returns 401/403 or an auth message, it stops without writing results. Concurrency is `--concurrency` (default 3).
- **No `max_tokens` flag exists.** The request's `max_tokens` is ignored by the CLI backend. `--max-budget-usd` (per call, CLI-reported cost) is the closest runaway guard.
- `<out>.usage.json` records each call's wall time, tokens and `total_cost_usd`.

**Isolation gaps (observed in a debug log and a probe):**
- Claude Code still adds about 500 tokens of context that no flag removes with `--system-prompt`: the **account email**, the cwd, platform and OS, model identity, a token budget and the date. `--exclude-dynamic-system-prompt-sections` is ignored with `--system-prompt`. `--bare` would drop them but accepts only `ANTHROPIC_API_KEY` auth.
- **The email leaked into data.** The first pilot run (before the fix) put the account email in 2 of 100 utterances, as a CREATE_GOAL assignee. The fix has two parts. The teacher prompts now say to invent every name, email and date and to ignore account/machine context, and the second run had 0 leaks. `rows` also drops any item that contains the account email (from `claude auth status`), its local part, `$USER` or the home path (`--no-leak-check` turns this off).
- The built-in `agents-md` and `telemetry` plugins still load (agents-md reports "project memory is off"). Managed and remote policy settings still apply. `~/.claude.json` is rewritten on every call.
- There is a fixed per-call overhead of about 1.7–2.0k input tokens: the StructuredOutput tool and its schema, plus the injected context. Every call writes its whole prompt to the 1 h prompt cache, and no call read from it (`cacheRead` 0 over 117 calls).

**Other teacher-side changes:**
- `rows` adds replay fixtures from `FIXTURES`: SUBMIT_FOR_REVIEW before APPROVE_NOTE or REJECT_NOTE, and CREATE_TENSION before the tension ops.
- `agree --manifest rendered.manifest.json` also drops rows whose step-2 target the runtime grammar rejects.
- `agree` now reads `rows-valid.jsonl` (after zod and replay), not `rows-kept.jsonl`.
- The pilot uses `wbs:SET_OWNER` in place of `wbs:SET_GOAL_STATUS`.
- **Ref ops are not supported yet.** 40 of the 99 ops have an app-filled `(ref-id)` field naming an existing entity, such as SET_GOAL_STATUS's goal. They need a fixture with labeled entities plus `refCandidates`, and `validate-rows.ts` mints fixture ids from one counter for the whole file. Today such a row fails replay.

### Commands

```bash
P=training/.venv/bin/python; A=training/artifacts/teacher-pilot
npx --no-install tsx training/gen/export-teacher-context.ts $A/context.json
$P training/py/teacher.py plan --context $A/context.json --out $A/pilot-gen-requests.jsonl
$P training/py/teacher.py run $A/pilot-gen-requests.jsonl --out $A/pilot-gen-results.jsonl     # --teacher cli (default) | api
$P training/py/teacher.py rows $A/pilot-gen-results.jsonl --context $A/context.json --out $A/pilot-rows.jsonl
training/scripts/render.sh $A/pilot-rows.jsonl $A/pilot
$P training/py/teacher.py label $A/pilot/rendered.jsonl --context $A/context.json --out $A/pilot-label-requests.jsonl
$P training/py/teacher.py run $A/pilot-label-requests.jsonl --out $A/pilot-label-results.jsonl
$P training/py/teacher.py agree $A/pilot-label-results.jsonl --rows $A/pilot/rows-valid.jsonl \
    --manifest $A/pilot/rendered.manifest.json --out $A/pilot-agreed.jsonl
training/scripts/render.sh $A/pilot-agreed.jsonl $A/pilot-final                                 # -> train.jsonl
```

`run` refuses more than 200 requests unless `--max-requests` is raised.

### Teacher pilot (observed, 2026-10-21, `claude -p`, concurrency 3)

The pilot had 20 generation requests of 5 items each: 9 ops across 4 models (knowledge-note ADD_TOPIC, SET_TITLE, SUBMIT_FOR_REVIEW, REJECT_NOTE; project SET_PROJECT_STATUS, ADD_MEMBER; wbs CREATE_GOAL, SET_OWNER; tension RESOLVE_TENSION), plus 10 no-action items (knowledge-note, wbs). The numbers below are from the second run, after the leak fix. Kept rows are in `data/teacher-pilot-2026-10-21/pilot-agreed.jsonl`, and the summary is in `results/teacher-pilot-2026-10-21.json`. The raw artifacts are under `artifacts/teacher-pilot/` (gitignored).

| Stage | Dropped | Left | Notes |
|---|---|---|---|
| Generated | | 100 | 90 action items, 10 no-action |
| Grounding (`rows`) | 1 | 99 | ADD_MEMBER `kind` set with no evidence span. Context-leak filter: 0 (2 in the first run) |
| Dedup / eval leak | 2 | 97 | Both "Submit this for review." match held-out-2 `kn2-12` exactly |
| Vocabulary, zod, reducer replay | 0 | 97 | |
| r6.1 grammar gate (step-2 target rejected) | 11 | 86 | ADD_MEMBER `role` ×5, CREATE_GOAL `assignee` ×4, SET_OWNER ×2 (owner meant but unnamed, or a clear to `{}`). Their step-1 rows are still trainable |
| Blind label disagreement | 13 | **73** | 4 on the op: two SET_PROJECT_STATUS → none ("Kick it off now.", a question), SET_OWNER → ASSIGN_GOAL, RESOLVE → DISSOLVE. 9 on the args only: the labeler changed case, added a final period or reworded the span |

- **Final render** of the 73 kept rows gave 132 steps, all trainable. There were 0 template or token mismatches, 0 boundary merges and one BOS per row, through the chat core's builders. `tests/unit/training-prompt-format.test.ts` passes.
- **Agreement** is 73/86 (85%) exact. On the op alone it is 82/86 (95%).
- The arg check is exact string equality. A case- and final-punctuation-tolerant comparison would keep 5 of the 9 arg-only rows. The labeler, not the teacher, broke the verbatim rule in 8 of the 9.

**Quality (my read of all 100 items):**
- The utterances are varied in register and length: 3–74 words, median 14. Personas and the requested styles show through, and the no-action items are close to edits ("which goals have no owner?").
- They are realistic, with a tendency toward long, chatty, persona-flavoured messages (gardening and thesis asides).
- **Op words are common.** 27 of the 63 kept action rows contain the op's own noun or verb: CREATE_GOAL 5/5 "goal", SET_TITLE 7/10 "title", RESOLVE 4/7. The style axis "uses a synonym…" covers only part of each request. For the full run, `plan` should state the no-op-words rule per item, or set a quota.
- The teacher sometimes reports a style label of its own ("formal", "casual") instead of the requested axis.
- **Names repeat.** "Priya" appears 7 times in 99 rows, and Elena Vasquez, Okafor and "Bayesian Priors…" titles twice each. Some messages are formulaic ("Please mark this tension as resolved. The resolution is: …").
- **Grounding lets a degenerate span through:** "new goal, assign to mkim@university.edu" had `description: "new goal"`. That row was gated out anyway.

**Time and usage (observed):**

| | Calls | Wall | Per call median / p90 | Input tokens (incl. cache write) | Output (of which thinking) | CLI `total_cost_usd` |
|---|---|---|---|---|---|---|
| Generation (effort medium) | 20 | 64.0 s | 9.2 / 13.2 s | 61,223 | 16,461 (4,439) | $0.41 |
| Blind label (effort low) | 97 | 85.0 s | 2.4 / 3.2 s | 253,016 | 10,593 (345) | $1.12 |
| Local stages (rows, render ×2, label build, agree) | | 56.8 s | | | | |
| **Pilot total** | 117 | **~206 s** | | 314k | 27k | **$1.53** |

- 0 retries, 0 timeouts and 0 schema failures.
- `total_cost_usd` is the CLI's figure at API list prices (`costBasis: "list"`), including 1 h cache writes. **It is an API-equivalent number, not subscription usage**, which the CLI does not report.
- The first run, the one with the leak, used another 20 generation calls (63.4 s, $0.40).

**Extrapolation to the full run (not measured):**
- Generation would be 1,200 calls at 3.2 s each at concurrency 3: about **64 min**, 3.7M input and 1.0M output tokens.
- The label pass would be about 11.6k calls (97% of 12,000 items reach it) at 0.88 s each: about **2.8 h**, 30M input and 1.3M output tokens.
- That totals about **3.9 h** at concurrency 3, about 34M input and 2.3M output tokens, and about $160 in CLI-reported API-equivalent cost.
- Label input is the largest share: about 2.6k tokens per call. Only about 0.66k of that is the label prompt itself (chars/4); the rest is CLI overhead.
- At the pilot's 73% yield, 12,000 items would give about 8.8k kept rows. That assumes ref ops are supported; today they would fail replay.

## Next, waiting on the user

1. **Round 6 is done.** The format is r6.1, and the renderer uses it. Every change to the core's step-1/step-2 builders, the op descriptions or the vocabularies bumps `PROMPT_FORMAT_VERSION` (`chat/core/prompt-format.ts`). After a bump, re-run `render.sh`.
2. **Both blind held-out sets** are in `spike/llm-harness/eval/` (`heldout-eval.json`, `heldout2-eval.json`), so `dedup.py` filters against both.
3. **The user** reviews the pilot (above) and approves the full run. `run` refuses more than 200 requests unless `--max-requests` is raised. Before the full run, support ref ops (40 of 99) in `rows` and `validate-rows.ts`. The teacher's output schemas come from `export-teacher-context.ts`, which now carries the canonical vocabularies as enums (for example `taskType: "claim" | "enrichment"`). `plan` was re-run as a dry run: 20 requests, 0 over the schema limits.
4. **The real training run** comes after that: 3 epochs, effective batch 32, then a dev-checkpoint pick, export, and the in-browser eval arms. Judge it against gte-small top-1 (round 6: O2 47.3% scoped, U1 26.4% unscoped).
5. **Open format question:** the safe gate drops meant-but-unnamed optional fields (see Re-render). Rows that hit it are not trainable as the format stands.

**Not done here:**
- The in-browser wllama parity check (`createCompletion(prompt, grammar)` against `createChatCompletion`), because Chrome was off-limits.
  - Offline evidence only: in `vendor/wllama/3.8.1/wllama.js`, both calls go through the same wasm `completion` action, and the wasm contains llama.cpp's `common_chat_templates_init`.
  - That is consistent with the server path used here, including BOS added by the tokenizer, but it is **[U]** until the 20-row in-browser check runs.
- `scripts/setup.sh` was put together from steps that were each run by hand here. It has not been re-run end to end from a clean state.
- Hosting.
- Checking the license for redistributing a derivative.
