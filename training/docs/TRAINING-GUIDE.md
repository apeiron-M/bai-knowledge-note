# Training guide: how the shipped chat models were built

This is the end-to-end process, as it actually ran between 2026-10-20 and 2026-10-27, that produced the configuration chosen on held-out-6. The detail for each round lives in `training/README.md`, in the experiment reports in `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/`, and in the handoff `docs/superpowers/specs/2026-10-23-in-browser-llm-handoff.md`. This guide puts the steps in order, gives the commands, and records what each step cost.

Tags: **[est]** is an estimate, **[inf]** is inferred from counts or logs and was not stated by the run itself, and **[gap]** marks a step that has no committed tool (see `NEW-DOCUMENT-MODEL.md`, "Tooling gaps").

Companion docs:
- `GENERIC-VS-SPECIFIC.md` lists every piece and says whether it is generic, derivable from a document-model spec, or hand-written per app.
- `NEW-DOCUMENT-MODEL.md` is the procedure for a new document model or app, plus the list of tools that are still missing.

## 0. What shipped, and what "shipped" means today

**Configuration C** won the pre-registered decision on held-out-6 (`PREREGISTRATION-3.md`, sha256 `e9733fe2…7486`; results in `heldout6-run1-RESULTS.md`). It has five parts:

| Part | What it is |
|---|---|
| Step-1 expert A | **X5**: an LFM2.5-350M LoRA trained on Round 10 rows plus the Round 11 human-style paraphrase rows. Merged and quantised to Q4_K_M (229 MB). |
| Step-1 expert B | **Kev-FT**: Kev-0.8B (a Qwen3.5-0.8B decision model) fine-tuned on the Round 10 rows. Q4_K_M, 530 MB. |
| Fusion | 0.5·log softmax(LoRA trie score / 1.63) + 0.5·log softmax(Kev logprobs / 4.0), then argmax over the non-none ops. If the LoRA says `{"ops": []}`, the result is no action (the "none rule"). |
| Margin gate | Ask the user when p₁ − p₂ < 0.50, and offer the fused top 3 plus "none of these". |
| Step 2 (arguments) | X5 decoding under the chat core's copy-span grammar, with the **X6 + X9** argument fixes applied: `x6-args-ship.patch` (sha256 `8d29e48a…877f`) and then `x9-args2.patch` (`11737382…529`). |

**Held-out-6 results** (200 action + 20 no-action items, run once):

| Metric | Result |
|---|---|
| Op one-shot | **93.5%** (Wilson 95% CI 89.2–96.2) |
| Fully correct one-shot | 83.5% |
| Gold op among the offered choices | 98.0% |
| Ask rate | 15.9% |
| Wrong dispatches | 2.7% |
| **Effective fully correct** | **87.5%** |

**C is not in the browser yet.** The Chat tab still runs the Round 8 LoRA with R2c (`docs/superpowers/notes/in-browser-llm/status-v1.md`):
- The repo's chat core has neither `date-resolve.ts` nor `list-completion.ts`. The X6/X9 fixes exist only as the two patches.
- The fusion and the gate exist only in the evaluation rig and in the X7 code (`exp/x7-fusion/code/fuse.py`, `gates.py`).
- Every C number above was measured by the native-llama.cpp rig (section 9), not by the browser.
- Porting C (two wllama instances, the patches, the gate UI) is the handoff's next step, and it has not started.

## 1. Machines and toolchain

| Machine | Role | Notes |
|---|---|---|
| This Mac (M4 Max, 36 GB) | Teacher calls, rendering, merge, GGUF export, every evaluation | Never trains (handoff rule). |
| **Constantine** (`ssh trainbox`; M4 Max with a 40-core GPU, 64 GiB, macOS 26.3) | All LoRA and Kev training | Reached with BatchMode SSH and rsync. Setup is in `docs/superpowers/notes/in-browser-llm/remote-training-plan.md`, and the session log is in `remote-run-log.md`. |

**One-time setup on the Mac:** `training/scripts/setup.sh`. It creates a uv venv with Python 3.13 and installs `requirements.txt`. It builds llama.cpp **b11364 (`46ca246`)**, which is the libllama inside wllama 3.8.1, into `$BAI_TRAINING_TOOLS` (default `~/.cache/bai-training`, outside the repo). It also downloads `LiquidAI/LFM2.5-350M` and Liquid's published Q4_K_M into `training/models/`. The script has never been re-run from a clean machine (README, "Not done here").

**Constantine setup** (`remote-run-log.md`):
- A venv in `~/bai-training/training/.venv`, installed from `requirements.lock --no-deps`.
- A mirror of `training/py/`, `training/scripts/` and the base weights, pushed with rsync and checked by sha256 on both sides.
- `~/bai-training/launch.sh <name> <train_lora.py args…>`. It starts `train_lora.py` in a detached `screen` session under `caffeinate -dimsu`, with `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5` and `PYTORCH_MPS_LOW_WATERMARK_RATIO=0.45`. It logs to `~/bai-training/<name>.log`, and it starts `training/scripts/watchdog.sh` with a 32 GiB limit and a 15 s interval if the watchdog is not already running. **This script exists only on Constantine [gap].**
- Kev uses `~/kev` (a clone of `jaredpalmer/kev` at `2074cc44`, set up with `uv sync`) and `~/x4/` (data, `launch-kev-ft.sh`, `watchdog-kev.sh`). These are also Constantine-only [gap].
- Constantine sleeps on AC unless `sudo pmset -c sleep 0` is set (handoff update 4). caffeinate holds it awake only while a job runs.

## 2. Inputs

Everything below is read from the repo. Nothing is read from an eval set.
- **The catalog:** `editors/knowledge-vault/chat/core/catalog-models.ts`, which lists the 12 vault document models. `buildCatalog` (`op-catalog.ts`) turns each model's spec, zod `<Op>InputSchema()` creators and field overrides into catalog entries: 99 global ops, of which 40 are ref ops.
- **Canonical vocabularies:** `chat/core/vocabularies.ts` has 13 closed `String` lists that become enums in the catalog.
- **Teacher context:** `npx --no-install tsx training/gen/export-teacher-context.ts <context.json>`. It writes each op's description, input SDL, semantic schema, reducer source, siblings and empty state.
- **Seeded states for ref ops:** `training/gen/ref-scenarios.ts` (one recipe per ref op: build, candidate paths, assign, check) and `training/gen/ref-pools.ts` (invented themes, people, batches and sessions, kept away from the eval domains).
- **Replay fixtures:** `FIXTURES` in `training/py/teacher.py`, for ops whose reducer needs a prior state (for example SUBMIT_FOR_REVIEW before APPROVE or REJECT).
- **The prompt format:** r6.1. `training/gen/prompt-format.ts` calls the chat core's own builders (`scoringMessages`, `forcedOpsText`, `prepareArgsStep`, `preparedGrammar`), and `PROMPT_FORMAT_VERSION` comes from `chat/core/prompt-format.ts`. `tests/unit/training-prompt-format.test.ts` pins byte parity between training and runtime prompts.

## 3. Teacher data

The teacher is `claude-sonnet-5`, run through headless Claude Code (`claude -p`). `teacher.py run` calls it with the isolation flags documented in the README ("Teacher: headless Claude Code"):
- an empty cwd, `--tools ""`, an empty strict MCP config, `--setting-sources ""`, `--safe-mode` and `--no-session-persistence`;
- the request's `--system-prompt` and `--json-schema`;
- a child environment with the parent session's variables removed.

`run` re-checks every structured output against the schema, and retries a failure 3 times with backoff. It journals succeeded rows to `<out>.partial.jsonl`, so a re-run resumes. It stops with exit 4 on any HTTP 429 or usage-limit message, and with exit 3 on lost auth. It refuses more than 200 requests unless `--max-requests` is raised.

**Isolation gap:** Claude Code still injects about 500 tokens of account and machine context, including the account email. Generated data has picked that email up before. Two defences are now in place:
- Every teacher prompt says to invent all names, emails and dates.
- `rows` drops any item that contains one of `context_leak_terms()`: the logged-in account's email (read from `claude auth status`), its local part, `$USER` or the home path.

Keep both. Re-scan the outputs if `claude auth status` ever returns nothing, because the filter then has no terms to match.

All commands below run from the repo root, with `P=training/.venv/bin/python`.

### 3a. Round 8: broad coverage (`--ops all`)

```bash
A=training/artifacts/teacher-full
npx --no-install tsx training/gen/export-teacher-context.ts $A/context.json
$P training/py/teacher.py plan --context $A/context.json --ops all --batch-size 10 --items-per-op 25 \
    --ref-items-per-op 55 --noaction-items 30 --seed 20261021 --out $A/gen-requests.jsonl
$P training/py/teacher.py run $A/gen-requests.jsonl --out $A/gen-results.jsonl --timeout 600 --max-requests 500 --cli-cwd <empty dir>
$P training/py/teacher.py rows $A/gen-results.jsonl --context $A/context.json --meta $A/gen-requests.jsonl.meta.json --out $A/rows.jsonl
training/scripts/render.sh $A/rows.jsonl $A/r1
$P training/py/teacher.py label $A/r1/rendered.jsonl --context $A/context.json --rows $A/r1/rows-valid.jsonl --batch 8 --out $A/label-requests.jsonl
$P training/py/teacher.py run $A/label-requests.jsonl --out $A/label-results.jsonl --timeout 600 --max-requests 500 --cli-cwd <empty dir>
$P training/py/teacher.py agree $A/label-results.jsonl --keys $A/label-requests.jsonl.keys.json --rows $A/r1/rows-valid.jsonl \
    --manifest $A/r1/rendered.manifest.json --context $A/context.json --max-free 0.7 --name-cap 0 --step1-only --out $A/agreed-s1.jsonl
```

**What `plan` does:**
- Each item gets a wording spec: a register, a length band, a pool name, a form (30% are questions that ask for the change), and an op-word rule. The two-sided quota is 60% "avoid the op's words" and 40% "use one of them".
- Each ref-op call gets its own seeded state (`ref-scenarios.ts`), with the target item at a random position in the candidate list.
- `plan` refuses to write (exit 5) if any eval utterance of 3 or more words appears in a prompt.
- Batch size 10 for generation and 8 for labels won the batch-size comparison (README, "Teacher batch-size comparison").

**Funnel:** 4,035 items from 453 calls → **3,286 kept** (2,570 full rows + 716 step-1-only rows).

**Cost:** generation 95 min and $28.12; labels about 24 min and $10.18. Costs throughout are CLI `total_cost_usd`, i.e. API list-price equivalent, not subscription usage.

### 3b. Round 10: contrastive and stress items

```bash
A=training/artifacts/round10
$P training/py/sibling_groups.py --context $A/context.json --out training/data/round10/sibling-groups.json
$P training/py/teacher.py plan --context $A/context.json --ops contrast --groups training/data/round10/sibling-groups.json \
    --rounds 2 --items-per-op 6 --avoid-share 0.65 --seed 20261022 --out $A/contrast/gen-requests.jsonl
$P training/py/teacher.py plan --context $A/context.json --ops stress --batch-size 10 --items-per-op 10 --span-items 6 \
    --seed 20261022 --out $A/stress/gen-requests.jsonl
# then run / rows / render.sh / label / run / agree --step1-only --max-free 0.7 --name-cap 0 per set, as in 3a
cat training/artifacts/teacher-full/agreed-s1.jsonl $A/cd/agreed-s1.jsonl $A/stress/agreed-s1.jsonl > $A/final-in/rows.jsonl
training/scripts/render.sh $A/final-in/rows.jsonl $A/final
$P training/py/split.py $A/final/train.jsonl --out-dir $A/split --share 0.05
```

**What each set does:**
- **Contrast:** each sibling group (ops that are easy to confuse, derived from the catalog and unioned with confusion pairs seen on dev) shares one seeded state per round. Each member's call names the other members as the set to avoid.
- **Stress:** each spec stresses one field: every enum value in turn, an exact 2–4 item list, or a span with capitals and internal punctuation. `rows` checks that the stressed field came out as asked.

**Funnel:** 1,800 items → 1,324 kept. Cost $21.22.

**Merged set:** `round10/final` has 4,609 rows → 7,564 sequences → 7,187 train / 377 val (`round10/split/`, val sha256 `1aa6b1c5…2e39`). That val file is reused unchanged by every later round.

### 3c. Round 11 (X5 data): human-style paraphrase rewrites

The teacher rewrites a kept Round 10 utterance in one of 10 styles: terse, lowercase, typos, abbrev, phone, non-native, question, indirect, synonyms or rambling. 35% of items also get a secondary style. The **args are not asked of the teacher**. They are derived from the source row's gold, and every free-text value must appear verbatim in the rewrite. The pipeline is `training/round11-para/para.py`, and the blind sets are read from `$BAI_BLIND_DIR` (counts and scores only).

```bash
A=training/artifacts/round11-para; C=training/artifacts/round10/context.json; X=training/round11-para/para.py
$P $X sources --rows training/artifacts/round10/final/rows-valid.jsonl --context $C --out $A/sources.jsonl   # blind prefilter, per-op budget
$P $X plan --sources $A/sources.jsonl --context $C --out $A/full/requests.jsonl                             # batch 10, prompt leak check
$P $X promptcheck $A/full/requests.jsonl
$P training/py/teacher.py run $A/full/requests.jsonl --out $A/full/gen-results.jsonl --timeout 600 --concurrency 5 --max-requests 1000 --cli-cwd <empty dir>
training/round11-para/chain.sh $A/full/gen-results.jsonl $A/full/requests.jsonl.meta.json $A/full/chain <empty label cwd>
training/round11-para/merge.sh $A/full/chain/agreed.jsonl      # keeps Round 10's split byte for byte (para.py mirror)
```

**Funnel:** 5,078 items → `rows` 4,838 → leak and near-duplicate filter 4,630 → blind label 4,566 → **3,615 kept** (80.2% exact agreement, 94.8% on the op).

**Merge:** after removing the rewrites of Round 10 val rows and 1 Round 10 row that hit held-out-5, the train split is **13,547 sequences / 7,808 rows** (`round11-para/merged/split/train-split.jsonl`, sha256 `1c4718d3…7f7d`).

**Cost:** $32.84 plus $1.95 of pilots. Teacher wall time about 55 min, at concurrency 5.

### 3d. Round 12 (X11 data): built, not shipped

`training/round12-para/para12.py` adds three kinds of item:
- more rewrites, weighted toward synonyms, indirect wording and partial titles;
- **contrast pairs**: two sibling-op rows rewritten side by side in the same messy style;
- **new no-action messages** in 5 categories: unactionable, a question about the document, undecided musing, a report, chit-chat.

Its `chain.sh` and `merge.sh` mirror Round 11 and require `BAI_BLIND_DIR` to be set.

**Funnel:** 4,727 items → 3,665 kept, of which 792 are no-action. Cost about $33.0.

**Result:** the 350M trained on it (X12, 19,916 sequences, 145 min) did not beat X5 on dev: op 174 vs 175, and fused 180 vs 183 (`rig-compare-f-dev-x9.md`, addendum). So it is not part of C.

## 4. The validation chain (every round)

The stages run in this order. Each stage drops rows; none repairs them.

1. **`teacher.py rows`** (or `para.py rows` / `para12.py rows`):
   - JSON-schema parse of each item;
   - **grounding**: every free-text arg must appear verbatim in the utterance, with an evidence span (nested args are checked too);
   - the ref echo must name the assigned target;
   - the wording spec must be met (op words avoided or used as the spec says);
   - the stressed field must be as asked;
   - the **account-context filter** (above);
   - for paraphrases, the value must be preserved and the rewrite must differ from its source.
2. **`para.py leak`** (paraphrase rounds only): eval leaks against held-out-1–4, dev-extra and seed, plus the blind sets 5/6 (counts only). It also drops near-duplicates per op, seeded with earlier rounds' rows (`--prior`).
3. **`render.sh`**:
   - **`py/dedup.py`** rejects a row if any of these holds against any `utterance` under `spike/llm-harness/eval/`: a normalised exact match, a char- or word-trigram Jaccard ≥ 0.5, or containment of a whole eval utterance of 3+ words. It also drops near-duplicates within an op (word-trigram Jaccard ≥ 0.5).
   - **`gen/validate-rows.ts`**: canonical-vocabulary check, zod (`buildAction` + `<Op>InputSchema()`), and reducer replay on a fresh document after the `fixture` steps. For ref rows, `refCandidates` must equal the replayed state's candidates, every ref arg must be a candidate id, and the recipe's post-condition must hold after replay.
   - **`gen/render-prompts.ts`** renders the step-1 and step-2 messages through the core builders and checks each target against the runtime grammar of its step (`targetAccepted`).
   - **`py/render_template.py`** checks template and token parity against llama-server's `/apply-template` + `/tokenize` and against the HF tokenizer. It writes `train.jsonl` (pre-tokenised `input_ids` + `completion_mask`) and leaves out grammar-rejected targets.
4. **Blind relabel**, `teacher.py label --batch 8`: a second teacher pass sees each message together with its document state and candidate ops, but not the gold label. Before sending, the label requests are leak-checked again.
5. **`agree`**:
   - keeps a row only when the label's op **and** args equal the gold exactly;
   - applies the grammar gate (`--manifest`);
   - applies the **op-word quota**: at least 50% and at most 70% (`--max-free 0.7`) of an op's rows are free of the op's own words;
   - applies an optional name cap;
   - with `--step1-only`, keeps for step 1 those rows whose op agreed but whose step 2 is not trainable.
6. **Final `render.sh`** over the agreed rows.

Agreement under the blind relabel is the main quality gate. Typical exact agreement is 80–86%, and on the op alone 91–95%. Two label runs on the same rows agree with each other only 86.4% exactly, so yield differences under about 5 points are noise.

## 5. Splits, leaks and duplicates

- **`py/split.py`** splits by source row (`meta.id`), so a row's step-1 and step-2 sequences land on the same side. It is stratified by op and uses seed 20261021 with share 0.05. Val is used only to monitor the loss.
- **Later rounds keep the base split.** `para.py mirror` keeps Round 10's train file byte for byte, drops rewrites whose source is a val row, and drops base rows that hit an eval set.
- **Blind sets are read by code only.**
  - `para.py` reports leak hits as set name and score, and records each set's sha256 checked against its sidecar.
  - Experiment agents never open `blind/`.
- **Contamination found the hard way:**
  - Round 10's fresh split put 140 of Round 8's 168 val ids into train. That made the "teacher val" in-sample for X1 and X5, which broke temperature refits (section 8).
  - One Round 10 row near-copied a held-out-5 item. It was never checked against the blind sets, which did not exist yet, and later had to be excluded at eval time.
  - Kev-FT's data has 4,382 + 228 = 4,610 records, which equals `round10/final-in/rows.jsonl` (before dedup), not the 4,609 in `final/rows-kept.jsonl`. Pre-registration 3 §4 names one Kev-FT row outside `rows-kept.jsonl` that was never screened. **[inf]** So the Kev data was most likely built from the pre-dedup file. Build it from `final/rows-kept.jsonl` next time.

## 6. LoRA training (Constantine, MPS)

`training/py/train_lora.py` runs TRL 1.16 `SFTTrainer` with PEFT 0.21 on the pre-tokenised rows. Loss covers only the completion, and nothing is re-templated.

**Defaults:**

| Setting | Default |
|---|---|
| LoRA rank / alpha / dropout | 16 / 32 / 0.05, all linear layers |
| Learning rate | 2e-4, cosine |
| Batch | 8 × gradient accumulation 4 (effective 32) |
| Precision | bf16 |
| Max length | 1024 |
| Seed | 42 |
| Padding | to a multiple of 64 |

```bash
# push (sha-check both sides), then on Constantine:
~/bai-training/launch.sh x5-train training/artifacts/round11-para/train-split.jsonl --val training/artifacts/round11-para/val.jsonl \
    --out training/artifacts/x5-350m/run --epochs 2 --batch 8 --grad-accum 4 --save-steps 50 --save-limit 2
# 1.2B arms add: --base training/models/LFM2.5-1.2B-Instruct
ssh trainbox "tail -c 600 ~/bai-training/x5-train.log | tr '\r' '\n' | tail -3"      # poll
```

**Memory:**
- Round 8's first attempt on the 36 GB Mac grew past 40 GB. The cause was dynamic padding, which creates one MPS cache shape per batch.
- The fix is `--pad-multiple 64` plus `torch.mps.empty_cache()` every step, under the watermark caps. After it, a 60-step memtest plateaued at 12–14 GiB of footprint.
- Full runs peak at about 16–19 GiB of footprint.
- A 36 GB machine has not been re-tested since the fix [est: probably enough].
- The watchdog sends TERM and then KILL above 32 GiB. It has never fired.

**Checkpoints:** `--save-steps 50 --save-limit 2`, and `--resume auto|<dir>`. Resume was tested: from checkpoint 50 to step 60, the loss matched to 4 decimal places.

**Observed runs:**

| Run | Data (sequences) | Steps (epochs) | Wall | Peak footprint | Final val loss |
|---|---|---|---|---|---|
| Round 8 (350M) | 7,895 | 741 (3) | 81.5 min | 16 GiB | 0.0161 (min 0.0143) |
| Round 10 (350M) | 7,187 | 450 (2) | 52.3 min | 16 GiB | 0.0126 |
| X1 (1.2B, Round 10 data) | 7,187 | 450 (2) | 132.6 min | 19 GiB | 0.0093 |
| **X5 (350M, Round 11)** | 13,547 | 848 (2) | **99.2 min** | 19.0 GiB | 0.0137 |
| F (1.2B, Round 11) | 13,547 | 848 (2) | about 4–4.5 h | about 16 GiB | – |
| X12 (350M, Round 12) | 19,916 | 1,246 (2) | 145.3 min | 17 GiB | 0.0119 |

## 7. Merge and GGUF export (this Mac)

```bash
rsync -a --exclude checkpoints trainbox:bai-training/training/artifacts/x5-350m/run/ training/artifacts/x5-350m/remote/   # then check SHA256SUMS
$P training/py/merge.py training/artifacts/x5-350m/remote/adapter --out training/artifacts/x5-350m/merged \
    --check training/artifacts/round10/split/val.jsonl --check-rows 16
training/scripts/export-gguf.sh training/artifacts/x5-350m/merged training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023
```

- **`merge.py`** runs PEFT `merge_and_unload` on the CPU. It then checks the logits against base + adapter on 16 rows: max |Δ| was 3.2e-4 for X5, and the argmax agreed everywhere. The merge took 20 s at 5 GB RSS.
- **`export-gguf.sh`** runs `convert_hf_to_gguf.py` to bf16, writes the published Liquid GGUF's chat template into the file (`gguf_new_metadata.py`), and quantises with `llama-quantize Q4_K_M`. The output is 229,312,224 B, the same size as Liquid's file. The script uses macOS-only commands (`stat -f`, `/usr/bin/time -l`).
- **Native val check** (training val, not an eval): with llama-server `--no-jinja`, temperature 0 and the runtime grammars, X5 gets step 1 214/228 and step 2 136/149.

## 8. Kev-0.8B fine-tune (Constantine)

The recipe files are `x4-kev/finetune/constantine-recipe.sh` and `kev-ft-export.sh`. They live in the gitignored backup `training/artifacts/exp-2026-10-23/x4-kev/finetune/`, which is byte-identical to the session copy. **They are not in the repo [gap].**

1. **Data:** `x4-kev/code/to_kev_jsonl.py <rows> <round10 split/val.jsonl> <catalog.json> <outdir>`. It writes one Kev record per row:
   - `state = "Request: <utterance>"`;
   - a `choice` question over the docType's ops, with criteria `human(opName): OP_DESCRIPTIONS[key]` plus "answer a question";
   - a `noul` "change?" question.

   Rows in Round 10 val go to `calibration.jsonl` (228), and the rest to `train.jsonl` (4,382; sha256 `ed3d9aac…6e65`). `catalog.json` (`b257573b…`) comes from `x4-kev/code/dump-catalog.ts`.
2. **Train** (`~/x4/launch-kev-ft.sh`, recipe step 2): `kev.train` with these settings:
   - base `Qwen/Qwen3.5-0.8B-Base@dc7cdfe2`, initialised from `jaredpalmer/kev-0.8b@bf75a6a8`;
   - LoRA 16 on all targets, fp32 on MPS, lr 2e-5, batch 4 × accum 2, 2 epochs, seed 0, all distractor augmentations off;
   - run under the same MPS caps and caffeinate, with its own watchdog.

   The run took 1,096 steps at about 4.8 s per record, from 16:09 on 10-23 to 03:36 on 10-24, i.e. **about 11.4 h of wall** (the plan estimated 8.3 h). Footprint was about 15 GB. **There are no checkpoints in LoRA mode**, so a crash or sleep restarts from step 0.
3. **Calibrate:** `kev.benchmark` on `calibration.jsonl`, then `scripts/calibrate_checkpoint.py --allow-in-distribution`. This took 14 min and fitted T = 2.7007 into `head.pt`. Kev warns that this T is in-distribution, which is expected.
4. **Export (this Mac):** `kev-ft-export.sh` copies the run back, checks SHA256SUMS, runs `convert_hf_to_gguf.py` (llama.cpp 46ca246 detects the Kev checkpoint) to BF16, then `llama-quantize Q4_K_M`. Conversion took 12 s and quantising 3 s. The GGUF carries `qwen35.decision.temperature.*` = 2.7007. **The script hardcodes the session scratchpad path** (`X=…/scratchpad/exp/x4-kev`), so it needs an env var before it can be committed.

## 9. Calibration and evaluation

### The rig

`exp/rig/rig.sh` (the README is committed as `docs/…/exp-2026-10-23/rig-README.md`; the code is only in the backup `training/artifacts/exp-2026-10-23/rig/` [gap]) runs everything on native llama-server and never writes to the repo.

**Step 1:**
- Uses the base repo tree at rev `5e9c3904`.
- Generates the R2c pick, then scores an exact token trie over every scoped op plus `{"ops": []}`.
- Kev scores the same candidates with the frozen `decide.mjs --variant desc --wording W3`.

**Step 2:**
- Runs on the **gold** op at temperature 0.
- Uses patched trees built from `git archive`: `base`, `x6`, and `x9` (x6 + x9, plus `today` from the set's `conventions.today`, `currentLists` and `STATE_CHOICES`).

So in the rig, **fully correct = (op right) ∧ (args right on the gold op)**.

```bash
cd <exp>/rig
./rig.sh --lora <lora.gguf> --kev <kev.gguf> --set dev --args x9 --temps dev-cv --out validation/<name>
python3 src/compare.py --level x9 --block dev-cv "A=validation/<a>" "B=validation/<b>"
```

**Wall time:** about 2.5 min for X5 × Kev on dev with x9 only; 8–9 min with val and three args levels. All four held-out-6 blocks took 18 min.

### Temperatures (gate-calibration option G2, `rig-gate-calibration.md`)

- **Fit:** for each expert, fit T by the NLL of gold on held-out-3 + held-out-4. Use the single and no-action items, with the softmax over every scoped option including none. The grids are 0.2·1.05^k for the LoRA and 0.25…10 in steps of 0.25 for Kev. In the rig this is `rig.sh --temps dev-cv`.
- **Keep from X7:** τ = 0.5, k = 3 and equal weights. Equal weights beat weights fit by leave-one-set-out.
- **Frozen values for C:** T_L = 1.63 for X5, T_K = 4.0 for Kev-FT.
- **Why not the in-distribution T:** Kev-FT's own T of 2.70 is in-distribution. On human wording it is more overconfident (4.0 fits). Skipping the dev fit costs 6 more wrong dispatches on dev.
- **Do not refit on teacher val:** it is in-sample for any model trained on Round 10 or later (140 of its 168 ids).
- **For a blind run,** freeze the dev values in the pre-registration and pass them with `--temps explicit`.

### Evaluation sets and discipline

| Set | Role | Uses so far |
|---|---|---|
| Teacher val (Round 8 / Round 10 val) | Loss monitoring, no-harm checks | In-sample for Round 10+ models |
| held-out-3 + held-out-4 (dev, 196 action + 20 no-action + 12 multi) | Every design decision, temperature fits | Heavily reused |
| **held-out-5** (180 items, sha `c472bbae…354e`) | Selection among arms | 2 runs (prereg-1, prereg-2) |
| **held-out-6** (220 items, sha `85942add…f775`) | **Confirmatory, run once** | 1 run (prereg-3) |

**Rules followed:**
- **Pre-register every blind run.** The file is frozen with a `.sha256` sidecar. `rig.sh --prereg <file> --prereg-run <name>` refuses the file if it differs by one byte. Every model, set and code file is sha-verified before and after the run.
- **Pre-commit the decision rule.** Prereg-3 §9: ship D over C only if D's effective gain is ≥ 3 points **and** McNemar p < 0.05.
- **Exclude leaked items at run start.** `--exclude-match <rows>:<id>` or `<rows>:*` removes every item that `dedup.leak_hit` matches against any training utterance of any arm, before any producer runs. Only ids and scores are logged.
- **Score args NORMALISED first.** That means trim, collapse spaces, and strip one trailing `[.!?,;:]` run, because blind writers keep the final "." and teacher rows drop it. STRICT is the secondary metric.
- **Report Wilson CIs and paired McNemar tests.** Differences of 1–3 items at n ≈ 200 are noise.
- **No agent that tunes anything ever opens a blind set.** Evaluator agents verify the sha without opening the file.

**Bars:** op one-shot ≥ 90% (point estimate); gate gold-in-choices ≥ 92%; ask ≤ 30%. The original args bar was 80%.

## 10. Shipping artifacts

| Artifact | Path (gitignored unless noted) | Size | sha256 |
|---|---|---|---|
| X5 LoRA Q4_K_M | `training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf` | 229,312,224 B | `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba` |
| X5 BF16 | same dir, `…-BF16.gguf` | 711,485,152 B | `4b9514edfb0af13b2c8dac4b90483a307abf14d6596deb6a1c48635f40df3c47` |
| X5 adapter | `training/artifacts/x5-350m/remote/` | about 24 MB | `f6d0d2d5968d194fa5dda6e49e488865c10ffe6b7f9a419105956b52e46583b7` |
| Kev-FT Q4_K_M | `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` | 529,595,072 B | `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23` |
| Kev-FT BF16 | same dir, `…-BF16.gguf` | 1,517,796,032 B | `cb9c2867f37072b46f40afa7c542fdb3a695c4c22c26d9855e335736a2695db5` |
| Kev-FT head (T 2.70) | `training/artifacts/kev-ft/remote/x4-kev08-r1/head.pt` | | `19537efe…fbfb` |
| X5 train split / val | `training/artifacts/round11-para/merged/split/` | 13,547 / 377 sequences | `1c4718d3…7f7d` / `1aa6b1c5…2e39` |
| Kev train / calibration | `x4-kev/finetune/data/` (backup) | 4,382 / 228 records | `ed3d9aac…6e65` / `6abffad7…5248` |
| X6 args patch (committed) | `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/x6-args-ship.patch` | | `8d29e48af703df3ac7a024d6d2df05ef8328c242c5abd491434fc1f03b84877f` |
| X9 args patch, on top of X6 (committed) | `…/exp-2026-10-23/x9-args2.patch` | | `1173738261b17bb135db8b5c2517bad50653a339b44415c299960d8bfbc00529` |
| Fusion and gate parameters | prereg-3 §1–2 | | T_L 1.63, T_K 4.0, w 0.5 / 0.5, τ 0.5, k 3, none rule |
| Runtime the numbers were measured on | llama.cpp `46ca246` (b11364), Metal | | |

GGUF hosting and the redistribution licence are both still open.

## 11. Total cost to reproduce C

| Item | Cost / time |
|---|---|
| Teacher, Rounds 8 + 10 + 11 | about **$94** API-equivalent ($38.30 + $21.22 + $34.79, including Round 11's pilots), plus about $3 of earlier pilots. Teacher wall time about 3 h at concurrency 3–5 [est], spread across usage-limit windows. |
| Round 12 (not needed for C) | $33 |
| X5 LoRA training | 1.7 h on a 64 GB M4 Max |
| Kev-FT training | 11.4 h, plus 14 min of calibration |
| Merge and export | under 1 min each |
| Dev rig run | 3–9 min |
| Blind run | about 20 min |

Earlier rounds (pilots, the batch-size comparison, X1, F, X12) are sunk exploration cost, not part of the recipe.
