# LoRA pipeline for LFM2.5-350M (local, Apple Silicon)

This directory builds training data for the chat's two steps (op choice, then arguments) and fine-tunes `LiquidAI/LFM2.5-350M` with LoRA. It then ships the result as a merged Q4_K_M GGUF that wllama 3.8.1 loads like today's file.

**Status (2026-10-20, round 7):**
- The pipeline is built and smoke-tested end to end on this Mac.
- Rows render in the runtime prompt format **r6.1**, through the chat core's own builders, so training and runtime prompts are byte-identical (`tests/unit/training-prompt-format.test.ts`). The render and token-parity step was re-run on the smoke rows in r6.1 (see "Re-render in r6.1" below). The model was not retrained.
- The teacher runs through headless Claude Code (`claude -p`), with no API key needed. The ~100-row pilot ran on 2026-10-21 and kept 73 rows (see "Teacher pilot" below).
- Pilot 2 (2026-10-21, 150 items) covers all 40 ref ops on seeded document states, per-item wording specs and batched blind labels. It kept 105 rows (see "Teacher pilot 2"). The full run waits on the user's review.

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
| `gen/validate-rows.ts` | Canonical-vocabulary check (`chat/core/vocabularies.ts`; zod does not see these `String` fields), zod check (`buildAction`, the generated `<Op>InputSchema()` creator), then reducer replay on a fresh document after optional `fixture` steps. A row from a ref scenario (it carries `refContext`) must also have `refCandidates` equal to the replayed state's, ref args among the candidate ids, and its recipe's post-condition after replay. |
| `gen/replay.ts` | The shared replay: fixture steps may name the ids of their `new-id` fields (`newIds`); other ids come from a per-row counter. |
| `gen/ref-scenarios.ts`, `gen/ref-pools.ts` | One recipe per ref op (40): builds a state by replaying real creation actions, lists `{id, label}` candidates per ref path, assigns each teacher item a target at a random position, and checks the effect. `--list` prints the ref ops and the people pool. The pools are invented, away from the eval sets' domains. |
| `gen/export-teacher-context.ts` | Per-op teacher context: description, SDL, semantic schema, reducer source, siblings, empty state. |
| `gen/gbnf-check.ts` | A copy of the round-5 test recognizer, plus support for `{m,n}` repetition. It checks every target against its step's grammar. |
| `../scripts/gte-wasm-node.ts` | gte-small under node on the browser's onnxruntime-web wasm, for unscoped (`scoped: false`) rows' gte-small top-5 candidates. Loaded only when such a row exists. |
| `tools/schema2gbnf.cpp` | Prints the GBNF that llama.cpp's `json_schema_to_grammar` builds. The r6.1 renderer no longer uses it: step 2 decodes under the chat core's copy-span grammar, not a JSON-schema grammar. |
| `py/dedup.py` | Leak and duplicate filter (details below). |
| `py/render_template.py` | Renders prompts through llama-server, with template and token parity checks against HF. |
| `py/train_lora.py`, `py/merge.py`, `py/smoke_infer.py` | Train, merge, and run grammar-constrained inference. |
| `py/teacher.py` | The teacher pipeline (`plan`, `run --teacher cli\|api`, `submit`, `collect`, `rows`, `label`, `agree`, `labelcmp`, `mix`, `redact`). |
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
- `--tools ""` gives no tools. `--strict-mcp-config` with an empty config gives no MCP servers. `--setting-sources ""` reads no user, project or local settings. `--safe-mode` disables CLAUDE.md, installed plugins and their hooks, skills and the claude.ai connectors. Its debug log also reports "project memory is off". `--no-session-persistence` keeps the runs out of `~/.claude/projects`.
- `--system-prompt` replaces Claude Code's system prompt with the teacher's (`SYSTEM`, `NO_ACTION_SYSTEM`, `LABEL_SYSTEM`, the same text the API path sends).
- Structured output comes from `--json-schema`. The CLI implements it as a tool call (`stop_reason: "tool_use"`, 2 turns), not constrained decoding, so `run` re-checks every `structured_output` against the schema. A response that fails the check, a timeout (`--timeout`, 300 s) or a CLI error is retried (`--retries 3`, backoff 5/15/45 s) and is never written as data.
- `run` first calls `claude auth status`. If the account is not logged in, or a call returns 401/403 or an auth message, it stops without writing results. Concurrency is `--concurrency` (default 3).
- **No `max_tokens` flag exists.** The request's `max_tokens` is ignored by the CLI backend. `--max-budget-usd` (per call, CLI-reported cost) is the closest runaway guard.
- `<out>.usage.json` records each call's wall time, tokens and `total_cost_usd`.
- **Resume.** Each succeeded row is appended to `<out>.partial.jsonl` as it lands. A re-run with the same `--out` skips those `custom_id`s, and errored rows run again. The journal is deleted once every row has succeeded.
- **Usage limit.** If the subscription's usage limit is hit ("usage limit", "limit reached", "resets at"), `run` stops at once (exit 4) instead of burning its retries. It keeps the journal, so the same command resumes after the reset.

**Isolation gaps (observed in a debug log and a probe):**
- Claude Code still adds about 500 tokens of context that no flag removes with `--system-prompt`: the **account email**, the cwd, platform and OS, model identity, a token budget and the date. `--exclude-dynamic-system-prompt-sections` is ignored with `--system-prompt`. `--bare` would drop them but accepts only `ANTHROPIC_API_KEY` auth.
- **The email leaked into data.** The first pilot run (before the fix) put the account email in 2 of 100 utterances, as a CREATE_GOAL assignee. The fix has two parts. The teacher prompts now say to invent every name, email and date and to ignore account/machine context, and the second run had 0 leaks. `rows` also drops any item that contains the account email (from `claude auth status`), its local part, `$USER` or the home path (`--no-leak-check` turns this off).
- The built-in `agents-md` and `telemetry` plugins still load. Managed and remote policy settings still apply. `~/.claude.json` is rewritten on every call.
- There is a fixed per-call overhead of about 1.7–2.0k input tokens: the StructuredOutput tool and its schema, plus the injected context. Every call writes its whole prompt to the 1 h prompt cache, and no call read from it (`cacheRead` 0 over 117 calls).

**Other teacher-side changes:**
- `rows` adds replay fixtures from `FIXTURES`: SUBMIT_FOR_REVIEW before APPROVE_NOTE or REJECT_NOTE, and CREATE_TENSION before the tension ops.
- `agree --manifest rendered.manifest.json` also drops rows whose step-2 target the runtime grammar rejects.
- `agree` now reads `rows-valid.jsonl` (after zod and replay), not `rows-kept.jsonl`.
- The pilot uses `wbs:SET_OWNER` in place of `wbs:SET_GOAL_STATUS`.
- **Ref ops** (40 of the 99: an app-filled `(ref-id)` field naming an existing item, such as SET_GOAL_STATUS's goal) are supported since pilot 2. `plan` builds a seeded state per request (`gen/ref-scenarios.ts`) and shows it to the teacher with each item's target. `rows` checks the teacher's `refs` echo, puts the target ids in `args` and attaches `fixture`, `refCandidates` and `refContext`.
- **Label conventions are the training side's.** Only knowledge-note topics and links have a runtime extractor (`noteRefCandidates`). Goals, members, deliverables, tasks, core ideas and the rest are labeled by `ref-scenarios.ts` (goal description, member name, deliverable title, task target, the linked note's title). The runtime must adopt the same labels before a LoRA trained on them ships. `sessionId`, `batchId` and `topicDocumentId` are `String` fields classed as refs by the `/Id$/` rule. The runtime offers no candidates for them, so their rows are light coverage, not real ref ops.

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

Pilot 2 (ref ops, specs, batched labels):

```bash
P=training/.venv/bin/python; A=training/artifacts/teacher-pilot2
npx --no-install tsx training/gen/export-teacher-context.ts $A/context.json
$P training/py/teacher.py plan --context $A/context.json --ops pilot2 --seed 20261021 --out $A/gen-requests.jsonl
$P training/py/teacher.py run $A/gen-requests.jsonl --out $A/gen-results.jsonl
$P training/py/teacher.py rows $A/gen-results.jsonl --context $A/context.json --meta $A/gen-requests.jsonl.meta.json --out $A/rows.jsonl
training/scripts/render.sh $A/rows.jsonl $A/r1
$P training/py/teacher.py label $A/r1/rendered.jsonl --context $A/context.json --rows $A/r1/rows-valid.jsonl --batch 8 --out $A/label-requests.jsonl
$P training/py/teacher.py run $A/label-requests.jsonl --out $A/label-results.jsonl
$P training/py/teacher.py agree $A/label-results.jsonl --keys $A/label-requests.jsonl.keys.json --rows $A/r1/rows-valid.jsonl \
    --manifest $A/r1/rendered.manifest.json --context $A/context.json --out $A/agreed.jsonl
training/scripts/render.sh $A/agreed.jsonl $A/final
$P training/py/teacher.py mix $A/agreed.jsonl --context $A/context.json --ref-ops $A/ref-ops.json
```

`plan` writes `<out>.meta.json` (item specs and scenarios) and refuses (exit 5) if an eval utterance of 3+ words appears in any prompt; `label` runs the same check. `--ops pilot` now also uses the per-item specs, so a re-plan of pilot 1 differs from the requests it ran.

### Teacher pilot (observed, 2026-10-21, `claude -p`, concurrency 3)

The pilot had 20 generation requests of 5 items each: 9 ops across 4 models (knowledge-note ADD_TOPIC, SET_TITLE, SUBMIT_FOR_REVIEW, REJECT_NOTE; project SET_PROJECT_STATUS, ADD_MEMBER; wbs CREATE_GOAL, SET_OWNER; tension RESOLVE_TENSION), plus 10 no-action items (knowledge-note, wbs). The numbers below are from the second run, after the leak fix. Kept rows are in `data/teacher-pilot-2026-10-21/pilot-agreed.jsonl`, and the summary is in `results/teacher-pilot-2026-10-21.json`. The raw artifacts are under `artifacts/teacher-pilot/` (gitignored).

| Stage | Dropped | Left | Notes |
|---|---|---|---|
| Generated | | 100 | 90 action items, 10 no-action |
| Grounding (`rows`) | 1 | 99 | ADD_MEMBER `kind` set with no evidence span. Context-leak filter: 0 (2 in the first run) |
| Dedup / eval leak | 2 | 97 | Both "Submit this for review." match held-out-2 `kn2-12` exactly |
| Vocabulary, zod, reducer replay | 0 | 97 | |
| r6.1 grammar gate (step-2 target rejected) | 11 | 86 | ADD_MEMBER `role` ×5, CREATE_GOAL `assignee` ×4, SET_OWNER ×2 (owner meant but unnamed, or a clear to `{}`). `agree --manifest` drops the whole row, so their step-1 rows are not in `train.jsonl` either; a step-1-only keep is possible |
| Blind label disagreement | 13 | **73** | 4 on the op: two SET_PROJECT_STATUS → none ("Kick it off now.", a question), SET_OWNER → ASSIGN_GOAL, RESOLVE → DISSOLVE. 9 on the args only: the labeler changed case, added a final period or reworded the span |

- **Final render** of the 73 kept rows gave 132 steps, all trainable. There were 0 template or token mismatches, 0 boundary merges and one BOS per row, through the chat core's builders. `tests/unit/training-prompt-format.test.ts` passes.
- **Agreement** is 73/86 (85%) exact. On the op alone it is 82/86 (95%).
- The arg check is exact string equality. A case- and final-punctuation-tolerant comparison would keep 5 of the 9 arg-only rows. The labeler, not the teacher, broke the verbatim rule in 8 of the 9.

**Quality (my read of all 100 items):**
- The utterances are varied in register and length: 3–74 words, median 14. Personas and the requested styles show through, and the no-action items are close to edits ("which goals have no owner?").
- They are realistic, with a tendency toward long, chatty, persona-flavoured messages (gardening and thesis asides).
- **Op words are common.** 27 of the 63 kept action rows contain the op's own noun or verb: CREATE_GOAL 5/5 "goal", SET_TITLE 7/10 "title", RESOLVE 4/7. The style axis "uses a synonym…" covers only part of each request. For the full run, `plan` should state the no-op-words rule per item, or set a quota.
- **10 random kept rows** (`random.seed(20261021)`, `random.sample(rows, 10)` over `pilot-agreed.jsonl`):
  1. "This WBS is looking a lot cleaner than the spreadsheet we used to track sprint goals with — nice to finally have dependencies visible in one place." → none
  2. "Oh gosh, I almost forgot to log this properly! … can you set the owner on this garden journal to Marigold Pete? …" (74 words) → wbs:SET_OWNER `{"owner": "Marigold Pete"}`
  3. "add the tag victorian mourning rituals to this one, i keep losing track of it otherwise" → knowledge-note:ADD_TOPIC `{"name": "victorian mourning rituals"}`
  4. "add a goal: draft chapter 3 introduction on thermal conductivity models" → wbs:CREATE_GOAL `{"description": "draft chapter 3 introduction on thermal conductivity models"}`
  5. "set owner to Walt" → wbs:SET_OWNER `{"owner": "Walt"}`
  6. "Could you add Elena Vasquez to this project?" → project:ADD_MEMBER `{"name": "Elena Vasquez"}`
  7. "Kick it back to draft — the risk section is missing concrete mitigation steps." → knowledge-note:REJECT_NOTE `{"comment": "the risk section is missing concrete mitigation steps"}`
  8. "Please mark this tension as resolved. The resolution is: Engineering and Design reconciled the onboarding flow discrepancy after a joint review session on Tuesday, and both teams signed off on the final spec." → tension:RESOLVE_TENSION `{"resolution": "Engineering and Design reconciled … the final spec."}`
  9. "Quick question: which goals currently have no owner assigned? Trying to figure out where the gaps are before standup." → none
  10. "Can you check how many topics are currently tagged on this note? Feels like it's getting cluttered." → none
- The teacher sometimes reports a style label of its own ("formal", "casual") instead of the requested axis.
- **Names repeat.** "Priya" appears 7 times in 99 rows, and Elena Vasquez, Okafor and "Bayesian Priors…" titles twice each. Some messages are formulaic ("Please mark this tension as resolved. The resolution is: …").
- **Grounding lets a degenerate span through:** "new goal, assign to mkim@university.edu" had `description: "new goal"`. That row was gated out anyway.

**Time and usage (observed):**

| | Calls | Wall | Per call median / p90 | Input tokens (incl. cache write) | Output (of which thinking) | CLI `total_cost_usd` |
|---|---|---|---|---|---|---|
| Generation (effort medium) | 20 | 64.0 s | 9.2 / 13.2 s | 61,223 | 16,461 (4,439) | $0.41 |
| Blind label (effort low) | 97 | 85.0 s | 2.4 / 3.2 s | 253,016 | 10,593 (345) | $1.12 |
| Local stages (rows, render ×2, label build, agree) | | 56.8 s | | | | |
| **Pilot total** (sum of the stage wall times; no single start-to-end timing) | 117 | **~206 s** | | 314k | 27k | **$1.53** |

- 0 retries, 0 timeouts and 0 schema failures.
- `total_cost_usd` is the CLI's figure at API list prices (`costBasis: "list"`), including 1 h cache writes. **It is an API-equivalent number, not subscription usage**, which the CLI does not report.
- The first run, the one with the leak, used another 20 generation calls (63.4 s, $0.40).

**Extrapolation to the full run (not measured):**
- Generation would be 1,200 calls at 3.2 s each at concurrency 3: about **64 min**, 3.7M input and 1.0M output tokens.
- The label pass would be about 11.6k calls (97% of 12,000 items reach it) at 0.88 s each: about **2.8 h**, 30M input and 1.3M output tokens.
- That totals about **3.9 h** at concurrency 3, about 34M input and 2.3M output tokens, and about $160 in CLI-reported API-equivalent cost.
- Label input is the largest share: about 2.6k tokens per call. Only about 0.66k of that is the label prompt itself (chars/4); the rest is CLI overhead.
- At the pilot's 73% yield, 12,000 items would give about 8.8k kept rows. That assumes ref ops are supported; today they would fail replay.
- **Risk: about 34M tokens in about 4 h will very likely hit the subscription's usage window.** `run` stops and resumes (above), so the run can span several windows. Two other ways to cut the label pass's volume, which is 88% of the input: move it to the Batches API, or label 5–10 utterances of one docType per call. That stays blind, since no first-pass label is shown.

### Teacher pilot 2 (observed, 2026-10-21, `claude -p`, concurrency 3)

`plan --ops pilot2 --seed 20261021`: 55 requests, 150 items. They split into 90 ref-op items (all 40 ref ops, 2 or 3 each, on seeded states), 48 non-ref items (12 ops, 4 each) and 12 no-action items (project, moc, pipeline-queue). Every one of the 12 models has items. "About 150 rows" was read as 150 generated items. The summary is `results/teacher-pilot2-2026-10-21.json` and the kept rows are `data/teacher-pilot2-2026-10-21/agreed.jsonl`.

**What changed for it:**
- **Ref ops.** Each ref-op request gets a state built by replaying real creation actions (`gen/ref-scenarios.ts`), with 2–6 labeled items per ref path. The state is shown to the teacher, and each item is told which existing item to mean. The teacher echoes its label in `refs`, and `rows` checks the echo. `validate-rows.ts` re-derives the candidates from the replayed fixture and checks that each ref arg is a candidate id and that the recipe's post-condition holds (for example REORDER_CORE_IDEAS keeps every idea, and TOGGLE_EXTRACTION_CATEGORY flips the flag).
- **Wording specs.** Each item has a register, a length band, a pool name and, for at least half of an op's items, the op's non-trivial words to avoid (held-out-2's paraphrase rule: the op name minus set/add/update and small words). About one item in four is multi-clause with irrelevant context. `rows` drops an item that breaks its spec. `agree --context` then holds every op at 50% or more op-word-free rows and each pool name to 2 kept utterances.
- **Batched blind labels.** `label --batch 8` sends 8 shuffled messages of one docType per call, keyed `m1..m8`, since row ids name the generation op. Each message shows its document state, not the gold op's choice list, so the op stays blind. Choice labels are mapped back to ids before the comparison.

| Stage | Dropped | Left | Notes |
|---|---|---|---|
| Generated | | 150 | |
| `rows`: context leak | 2 | 148 | Both SET_PROVENANCE items used the account email as `author`. The raw results were redacted in place (`teacher.py redact`). The spec line now names the pool person for every person field. |
| `rows`: ref echo | 2 | 146 | REORDER_CORE_IDEAS ×2: `refs.ids` named only the moved item, not the full order. The spec line now asks for the whole list. |
| `rows`: grounding | 6 | 140 | CREATE_OBSERVATION `title` ×3, TOGGLE_FEATURE, BLOCK_TASK, ADVANCE_PHASE `handoff.filesModified` (grounding now recurses into nested args) |
| `rows`: wording spec | 0 | 140 | The first pass wrongly flagged 11 multi-clause items ("While I'm …, could you …"). The checker was fixed and `rows` re-run on the same output. |
| Dedup / eval leak | 0 | 140 | |
| Vocabulary, zod, replay, ref checks | 0 | 140 | 84 ref rows: candidates match the replayed state, and every post-condition holds |
| r6.1 grammar gate | 6 | 134 | ADD_LINK ×2 (teacher filled optional `targetTitle` with the ref label), CREATE_GOAL `assignee` ×2 (known), UPDATE_DELIVERABLE with only `goalRef` ×1 (`requireOneOf` demands a semantic field even when an optional ref is set: a format gap), CREATE_OBSERVATION casing ×1 |
| Blind label (batched) | 29 | **105** | 14 on the op: ADD_OPEN_QUESTION ×4 → none (the open question reads as a question), UPDATE_GOAL_DESCRIPTION ×3 ("mention X" → none or ADD_NOTE), and 7 singles (UPDATE_LINK_TYPE → ADD_LINK, SET_OUTCOME → ASSIGN_GOAL, others → none). 15 on args: casing, a final period, a corrected typo, a trimmed span, and 2 truly ambiguous refs ("set its order to 1", "sits under") |
| Wording quota / name cap | 0 | 105 | |

- **Kept by group:** ref 65/90, non-ref 28/48, no-action 12/12. 33 of the 40 ref ops kept at least one row.
  - Ref ops with none: ADD_LINK, SET_PROVENANCE, REORDER_CORE_IDEAS, ADVANCE_PHASE, BLOCK_TASK, SET_OUTCOME, UPDATE_GOAL_DESCRIPTION.
  - Non-ref ops with none: health-report ADD_CHECK, moc ADD_OPEN_QUESTION, observation CREATE_OBSERVATION. So health-report and observation have no kept row.
- **Final render** of the 105 rows: 198 steps, all trainable. 0 template or token mismatches, 0 boundary merges, one BOS, prompts of 69–560 tokens. `tests/unit/training-prompt-format.test.ts` passes.
- **Wording mix (kept, `teacher.py mix`):**
  - 84/93 action rows are op-word-free (pilot 1: 36/63). No op is below 50%.
  - Lengths: 18 very short, 25 short, 44 medium, 18 long. The median is 19 words (3–46).
  - 36 questions, 14 all-lowercase, 27 multi-clause specs. Assigned registers run from 7 to 17 rows each.
  - 68 rows use a pool name, 56 distinct; no name appears more than twice.
  - The new tic is openers: "Hey" starts 12 rows, "Could" 8.
  - **Op words are now rare (10%)**, while held-out-2 is about half "natural". The full run should set a two-sided quota.
- **Ref-position spread (kept):** the gold item is first in 17 of 68 refs (25%). Positions 1–5 got 17, 14, 16, 13 and 8, over lists of 2–5 items.
- **10 random kept ref-op rows** (`random.seed(20261021)`, `random.sample(ref_rows, 10)` over `agreed.jsonl`; args in label form; the position is the gold item's place among the candidates; the state is what the teacher saw):
  1. "ditch the deck oven instal one" → wbs:DELETE_GOAL `{"id": "Install the deck oven"}` (id 5/5). State: Goals:; - "Plan the opening-day tasting" [TODO]; - "Order the shop signage" [COMPLETED]; - "Get the food hygiene certificate" [TODO]; - "Agree terms with the flour mill" [TODO]; - "Install the deck oven" [TODO]
  2. "Hey, can you drop the link to "Lighthouse oil supply routes"? Lotte and I decided it's not relevant to the ration list exhibit anymore." → knowledge-note:REMOVE_LINK `{"id": "Lighthouse oil supply routes"}` (id 3/5). State: Title: "Ration lists on 1840s merchant ships"; Topics:; - "harbour pilots"; Links:; - "How sextants were calibrated" (CONTRADICTS); - "Salvage disputes in the harbour court" (RELATES_TO); - "Lighthouse oil supply routes" (CONTRADICTS); - "Logbook shorthand for weather" (RELATES_TO); - "The 1889 dock strike timeline" (RELATES_TO); Other notes in the drive:; - "How sextants were calibrated"; - "Salvage disputes in the harbour court"; - "Lighthouse oil supply routes"; - "Logbook shorthand for weather"; - "The 1889 dock strike timeline"
  3. "I'm mid-coffee here, but can you delete that bit about the diorama maker starting in March from the gallery floor plan goal?" → wbs:REMOVE_NOTE `{"goalId": "Draft the gallery floor plan", "noteId": "Diorama maker can start in March"}` (goalId 4/4, noteId 4/4). State: Goals:; - "Book the conservator for the sextant" [TODO; notes: "Three interviewees agreed so far"]; - "Record oral histories from dock workers" [TODO; notes: "Insurance value still to confirm"]; - "Commission the harbour diorama" [TODO; notes: "Translator flagged two illegible pages"]; - "Draft the gallery floor plan" [TODO; notes: "Diorama maker can start in March"]
  4. "Hey, can you hook this up to the neighbourhood bakery opening plan?" → project:LINK_WBS `{"wbsRef": "neighbourhood bakery opening plan"}` (wbsRef 3/4). State: Team:; - "Ewan MacLeod" (volunteer lead); - "Keiko Tanabe" (treasurer); Work-breakdown documents in the drive:; - "urban beekeeping co-op plan"; - "mobile banking app launch plan"; - "neighbourhood bakery opening plan"; - "maritime history exhibit plan"
  5. "Since Hamid Rahimi suggested cross-referencing related projects, could you please connect this document to the maritime history exhibit plan?" → project:LINK_WBS `{"wbsRef": "maritime history exhibit plan"}` (wbsRef 4/4). State: Team:; - "Ewan MacLeod" (volunteer lead); - "Keiko Tanabe" (treasurer); Work-breakdown documents in the drive:; - "urban beekeeping co-op plan"; - "mobile banking app launch plan"; - "neighbourhood bakery opening plan"; - "maritime history exhibit plan"
  6. "I'm in the middle of reconciling box office numbers with Yara right now, but the ticket pricing history entry keeps throwing errors because the source spreadsheet is corrupted—can you mark it as not completed, listing "corrupted source spreadsheet" as the reason?" → pipeline-queue:FAIL_TASK `{"taskId": "notes/ticket-pricing-history", "reason": "corrupted source spreadsheet"}` (taskId 4/5). State: Tasks:; - "sources/costume-hire-catalogue" [claim; IN_PROGRESS; phase create; assigned to Florin Popescu]; - "sources/relaxed-performance-guide" [claim; PENDING; phase create]; - "notes/lighting-hours" [enrichment; PENDING; phase enrich]; - "notes/ticket-pricing-history" [enrichment; PENDING; phase enrich]; - "notes/stage-weight-limits" [enrichment; PENDING; phase enrich]
  7. "Could you please attach the document on app store rejection reasons we've encountered?" → project:ADD_KNOWLEDGE_REF `{"ref": "Store review rejections we have seen"}` (ref 5/5). State: Team:; - "Chidi Okeke" (coordinator); - "Rohan Pillai" (treasurer); Linked knowledge:; - "Why users abandon identity checks"; Knowledge documents in the drive:; - "Why users abandon identity checks"; - "Refund timelines regulators expect"; - "Fraud rules that block real customers"; - "Retry policy for failed card payments"; - "Notification opt-in rates by country"; - "Store review rejections we have seen"
  8. "While I'm finalizing the onboarding flow for Dmitri Volkov's review, could you please unlink the piece on why users abandon identity checks from this document?" → project:REMOVE_KNOWLEDGE_REF `{"ref": "Why users abandon identity checks"}` (ref 5/5). State: Team:; - "Freya Hansen" (designer); Linked knowledge:; - "Fraud rules that block real customers"; - "Screen reader issues on the transfer screen"; - "Refund timelines regulators expect"; - "Store review rejections we have seen"; - "Why users abandon identity checks"; Knowledge documents in the drive:; - "Fraud rules that block real customers"; - "Screen reader issues on the transfer screen"; - "Refund timelines regulators expect"; - "Store review rejections we have seen"; - "Why users abandon identity checks"
  9. "Can we add sources/community-grant-guidelines to the spring sources batch?" → pipeline-queue:ADD_TASK `{"batchId": "batch-spring-sources", "target": "sources/community-grant-guidelines", "taskType": "claim"}` (batchId 1/2). State: Tasks:; - "notes/ticket-pricing-history" [enrichment; PENDING; phase enrich; batch batch-spring-sources]; - "notes/lighting-hours" [enrichment; IN_PROGRESS; phase enrich; assigned to Fatima Zahra Bennani; batch batch-weekly-review]; - "notes/stage-weight-limits" [enrichment; IN_PROGRESS; phase enrich; assigned to Mei-Ling Chou; batch batch-spring-sources]; - "sources/relaxed-performance-guide" [claim; PENDING; phase create; batch batch-weekly-review]
  10. "zainab musa reminded me juan pablo ruiz left the project ages ago, so he shoudl come off the team roster now" → project:REMOVE_MEMBER `{"id": "Juan Pablo Ruiz"}` (id 4/5). State: Team:; - "Rohan Pillai" (designer); - "Abebe Tesfaye" (treasurer); - "Matilda Svensson" (editor); - "Juan Pablo Ruiz" (treasurer); - "Aaliyah Brooks" (developer)

**Time and usage (observed):**

| | Calls | Wall | Per call median / p90 | Input tokens (incl. cache) | Output (of which thinking) | CLI `total_cost_usd` |
|---|---|---|---|---|---|---|
| Generation (effort medium) | 55 | 192.0 s | 8.8 / 16.8 s | 196,804 (cache read 3,785) | 56,334 (33,921) | $1.34 |
| Batched blind label (effort low, 8 per call) | 24 | 49.3 s | 5.6 / 8.5 s | 107,381 (cache read 38,534) | 14,854 (3,157) | $0.43 |
| Local stages (rows, render ×2, label build, agree) | | about 43 s | | | | |

Pilot 2 total, summed over stages: about 284 s, 79 CLI calls, 0 retries, $1.77.

**Batched vs single labels on pilot 1's 97 rows (observed):**
- Batched labels (15 calls) agree with pilot 1's single-call labels 79/97 exact (81.4%) and 93/97 on the op. Single calls agreed with generation 79/97 exact and 92/97 on the op, so the bar is met exactly.
- Batched labels agree with generation more often: 88/97 exact, 94/97 on the op.
- Tokens: single 253,016 in, 10,593 out, 85.0 s, $1.12. Batched 71,148 in, 8,515 out, 30.3 s, $0.32. That is about 730 input tokens per labeled row instead of about 2,600.

**Extrapolation to the full run (not measured; pilot-2 request shape, concurrency 3):**
- Per item: 1.28 s, 1.3k input, 376 output tokens and $0.0089 for generation. Per labeled row: 0.35 s, 770 input, 106 output tokens and $0.0031.
- 12,000 items: generation about 4.3 h, label pass about 1.1 h (93% reach it), so about **5.4 h**, 24M input, 5.7M output and about $140 API-equivalent. At 70% yield that is about 8.4k kept rows.
- About 16k kept rows would need about 23k items: about 10 h, 46M input, 11M output and about $270.
- The label pass is now about a fifth of the time. Generation dominates because pilot 2 sent 2–4 items per call with about 3.6k tokens of prompt each, and thinking is 60% of its output. Fewer, larger requests (one seeded state, 6–10 items) and effort low are the obvious savings. Both are unmeasured.

**Leak check:** no eval utterance of 3+ words appears in any pilot-1 or pilot-2 teacher prompt (normalized substring check over every rendered prompt; `plan` and `label` now run it and refuse on a hit). Pilot 1's two `kn2-12` copies were the shortest natural phrasing of SUBMIT_FOR_REVIEW ("Submit this for review."), produced from the op name plus the imperative and "refers to it/this" style axes. That is coincidence, not a leak. `dedup.py` stays.

**Fixed after pilot 2, for the next plan** (the stored pilot-2 states are as the teacher saw them): notes linked to themselves in 3 knowledge-note states, the "Other notes in the drive" list repeated linked notes, the person-field spec, and the list-ref spec.

## Next, waiting on the user

1. **Round 6 is done.** The format is r6.1, and the renderer uses it. Every change to the core's step-1/step-2 builders, the op descriptions or the vocabularies bumps `PROMPT_FORMAT_VERSION` (`chat/core/prompt-format.ts`). After a bump, re-run `render.sh`.
2. **Both blind held-out sets** are in `spike/llm-harness/eval/` (`heldout-eval.json`, `heldout2-eval.json`), so `dedup.py` filters against both.
3. **The user** reviews pilot 2 (above) and approves the full run. `run` refuses more than 200 requests unless `--max-requests` is raised. Ref ops are supported. The teacher's output schemas come from `export-teacher-context.ts`, which carries the canonical vocabularies as enums (for example `taskType: "claim" | "enrichment"`). Before the full run:
   - Set a two-sided op-word quota.
   - Reword the "a question" register for action ops.
   - Use larger requests per seeded state.
   - Decide the runtime's ref labels for non-note models.
   - Decide `requireOneOf` with an optional ref (UPDATE_DELIVERABLE).
4. **The real training run** comes after that: 3 epochs, effective batch 32, then a dev-checkpoint pick, export, and the in-browser eval arms. Judge it against gte-small top-1 (round 6: O2 47.3% scoped, U1 26.4% unscoped).
5. **Open format question:** the safe gate drops meant-but-unnamed optional fields (see Re-render). Rows that hit it are not trainable as the format stands.

**Not done here:**
- The in-browser wllama parity check (`createCompletion(prompt, grammar)` against `createChatCompletion`), because Chrome was off-limits.
  - Offline evidence only: in `vendor/wllama/3.8.1/wllama.js`, both calls go through the same wasm `completion` action, and the wasm contains llama.cpp's `common_chat_templates_init`.
  - That is consistent with the server path used here, including BOS added by the tokenizer, but it is **[U]** until the 20-row in-browser check runs.
- `scripts/setup.sh` was put together from steps that were each run by hand here. It has not been re-run end to end from a clean state.
- Hosting.
- Checking the license for redistributing a derivative.
