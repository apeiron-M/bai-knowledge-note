# Evaluation rig: score a LoRA and a Kev on dev (or a pre-registered blind set) with one command

This rig produced every configuration-C number in `training/docs/TRAINING-GUIDE.md` §9. It was moved here from the
session experiment tree (`exp/rig/`, backup `training/artifacts/exp-2026-10-23/rig/`). The original README is
committed as `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/rig-README.md`. It holds the full design notes and
the first validation, and it still describes this code. The differences are listed under "Moved into the repo".

It does inference only, on native llama-server with Metal. It never writes to the repo: the patched step-2 code
lives in trees outside the repo, built from `git archive` of a pinned revision. It reads a blind set only with
`--set heldout5 --blind-ok`, or from a `--prereg` file that says `set: heldout5` with `blind_ok: yes`. That code path
is for the separate, pre-registered blind runs only.

## Command

Run from anywhere. Paths are resolved from the script's location.

```bash
training/eval-rig/rig.sh --lora <lora.gguf> [--kev <kev.gguf>] --set dev|val|heldout5|file:<path> \
    [--args base|x6|x9[,..]] --out <dir> [--temps refit|frozen|explicit|dev-cv] \
    [--t-lora <x> --t-kev <y>] [--val-from <dir>] [--dev-from <dir>] \
    [--exclude-match <training-row-file>:<row-id>]... [--rev <git rev>] [--only id,id,..] [--blind-ok]
training/eval-rig/rig.sh --prereg <prereg.md> [--prereg-run <name>] [--prereg-sha256 <hex>]   # every parameter from the file
python3 training/eval-rig/src/compare.py --level x9 [--block frozen|refit|explicit|dev-cv] "A=<run>" "B=<run>"
```

Example: C's two experts on dev, with dev-fit temperatures (G2). This is the re-validation run below.

```bash
training/eval-rig/rig.sh \
    --lora training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf \
    --kev  training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf \
    --set dev --args x9 --temps dev-cv --out training/artifacts/eval-rig/runs/x5-kevft-dev
```

Defaults: `--args x9`, `--temps refit`, `--rev 5e9c39046dcd` (the registered X7 commit). Without `--kev`, only the
LoRA alone is reported. Every producer resumes: rerunning with the same `--out` skips the rows it already has. Wall
time is about 2.5–3 min for X5 × Kev on dev with x9 only.

### Environment

| Variable | Default | What |
|---|---|---|
| `RIG_REPO` | the repo this script is in | Source of `git archive`, `spike/llm-harness/eval/` (dev sets), `training/` (val, `dedup.py`, `replay.ts`) |
| `RIG_KEV` | `training/kev` | Frozen `node/decide.mjs` and `data/catalog.json` |
| `RIG_PATCHES` | `docs/superpowers/notes/in-browser-llm/exp-2026-10-23` | `x6-args-ship.patch`, `x9-args2.patch` |
| `RIG_TREES` | `$BAI_TRAINING_TOOLS/rig-trees` | Built trees, one dir per rev. They must stay outside the repo, because the root tsconfig includes `**/*`. Safe to delete. |
| `BAI_TRAINING_TOOLS` | `~/.cache/bai-training` | llama.cpp b11364 build (`training/scripts/setup.sh`) |
| `LLAMA_SERVER` | `$BAI_TRAINING_TOOLS/llama.cpp/build/bin/llama-server` | |
| `BAI_BLIND_DIR` | `training/artifacts/blind` (gitignored) | `heldout5/heldout5-eval.json` for `--set heldout5`. The same variable that `para.py` uses. Other blind sets go through `--set file:<path>` with a `set_sha256`. |
| `RIG_EXP` | `training/artifacts/exp-2026-10-23` (gitignored backup) | Third fallback root for relative paths in a prereg file, and the stored X6/X7/X9 outputs for `src/validate.py`. The committed PREREGISTRATION-2/3 files use paths relative to the experiment tree (`x4-kev/export/…`, `rig/src/evaluate.py`), so this fallback is what lets them re-run as written. |
| `TSX` | `tsx` | |

Put run outputs under `training/artifacts/eval-rig/` (gitignored) or outside the repo.

## What it does

1. **Trees** (`src/build-trees.sh`). It runs `git archive <rev>` of `editors document-models tests tsconfig.json
   package.json` into `base`, `x6` (plus `x6-args-ship.patch`, sha `8d29e48a…`) and `x9` (plus the x6 patch, then
   `x9-args2.patch`, sha `11737382…`). `node_modules spike vendor training` are symlinks to the repo. Every frozen file
   is sha-checked against `FROZEN.sha256` on each run.
2. **Items** (`src/items.py`):
   - `dev` is held-out-3 + held-out-4: 196 action, 20 no-action and 12 multi items.
   - `val` is the Round 8 teacher val.
   - `heldout5` is refused without `--blind-ok`.
   - `file:<path>` takes any set in the held-out schema.
   - `today` comes from the set's `conventions.today`.
3. **LoRA server** (`-c 4096 -np 1 --no-jinja`):
   - `src/step1.ts` runs the R2c pick and then the exact and branch token trie (`lib/lib.ts` `trieScore`) over every scoped op + `{"ops": []}`. It always uses the `base` tree.
   - `src/step2.ts` runs step 2 on the gold op at temperature 0, once per args level, and scores STRICT and NORMALISED.
4. **Kev server** (`-c 8192`): `training/kev/node/decide.mjs --runtime server --variant desc --wording W3`. The option text is `training/kev/data/catalog.json`. `--servedT` is read from the GGUF (`src/gguf_meta.py`).
5. **Evaluate** (`src/evaluate.py`, the X7 logic):
   - configs: LoRA alone, Kev alone, the equal-weight product, and the product + margin gate (τ 0.5, fused top 3, none rule);
   - outputs: `rows.jsonl`, `results.json`, `results.md` and `manifest.json` (every sha, temperatures, exclusions, prereg).

The temperature modes, the run-start exclusion (`--exclude-match`, `dedup.leak_hit`, ids and scores only) and the
pre-registration mode (sha sidecar first, then one `rig-run` block, every listed sha verified) are documented in
detail in `rig-README.md`. The format of a `rig-run` block is in `src/prereg.py`'s docstring.

## Pre-registrations

Blind runs go through `--prereg`. The committed, frozen pre-registrations are the templates:
- `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/PREREGISTRATION-2.md` (+ `.sha256`): held-out-5 run 2, arms
  A/B/C. Results in `heldout5-run2-RESULTS.md`.
- `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/PREREGISTRATION-3.md` (+ `.sha256`, `e9733fe2…7486`): the
  held-out-6 confirmatory run, C vs D. Results in `heldout6-run1-RESULTS.md`.

The committed copies are byte-identical to the frozen files in the backup `training/artifacts/exp-2026-10-23/x7-fusion/`.
Their paths are relative to that directory (`code/prereg2_analysis.py`) and to the experiment root (`rig/src/…`,
`x4-kev/…`), so re-run them from the backup copy, e.g.
`training/eval-rig/rig.sh --prereg training/artifacts/exp-2026-10-23/x7-fusion/PREREGISTRATION-3.md --prereg-run x5-kevft-dev`.
On 2026-10-27 `src/prereg.py` resolved and sha-verified every path of that block this way. Their `verify` lines pin the
frozen session rig files in the backup, not the path-edited copies here.

A new pre-registration should use paths relative to the repo (`training/…`). They resolve on the second fallback, so
the file does not depend on `RIG_EXP`.

## Analysis helpers (`analysis/`)

| File | What it does |
|---|---|
| `prereg2_analysis.py` | Per-item machinery for a pre-registered comparison: load (asserts the frozen temperatures), outcomes through `evaluate.decide`, metrics, paired McNemar, Wilson, the within-run check against `results.json`. |
| `prereg3_analysis.py` | Prereg-3: arms A–D from two rig runs (`--x5`, `--f`), P1/P2, the gate bars, and D vs C under the pre-committed shipping rule. The arm names are those of prereg-3; a new pre-registration copies and renames them. |
| `prereg3_train_utterances.py` | Writes `{id, utterance}` rows of every arm's training data, which are the `<file>:*` exclusion specs. Sources: `round11-para/merged/split/train-split.jsonl` and Kev-FT's `train.jsonl` (`$KEV_TRAIN`, or regenerate with `training/kev/to_kev_jsonl.py`). |
| `calib.py` | The gate-calibration study (`rig-gate-calibration.md`): G1/G2 temperature options, τ / k / weights, over stored dev runs in `$RIG_VALIDATION`. |

`src/prereg_eval.py` is the untouched X7 evaluator, used only as a cross-check by `src/validate.py`.

The X2 native client `native-llm.mts` and its `lora-native.mts` producer are not here. The rig does not use them:
`lib/lib.ts` (X3) is its native llama-server client and trie scorer.

## Moved into the repo (2026-10-27)

Only path handling changed. No scoring, prompt, item or temperature logic changed.
- **Byte-identical to the frozen session copies:** `src/evaluate.py` (`69223b6a…`, the sha that PREREGISTRATION-2/3 `verify`), `compare.py`, `gguf_meta.py`, `step1.ts`, `prereg_eval.py` (`f981613b…`), `decide.mjs` (`feed74fe…`) and `catalog.json` (`b257573b…`).
- **Path edits only:** `rig.sh`, `build-trees.sh`, `items.py`, `prereg.py`, `exclude.py`, `kev_items.py`, `step2.ts`, `validate.py`, and in `analysis/`, `prereg2_analysis.py`, `prereg3_train_utterances.py` and `calib.py`. These edits replace hardcoded absolute paths with the variables above. The new shas are recorded in each run's `manifest.json` `rigFiles`.
- **`lib/lib.ts`:** the two `import type` paths are now relative. esbuild erases type imports, so behaviour is unchanged. The new sha is in `FROZEN.sha256`.
- **`FROZEN.sha256`** now names the Kev files in `training/kev/` and the patches in `docs/…/exp-2026-10-23/` (same shas).
- Trees are built under `$RIG_TREES`, not `<rig>/trees/`. The trees built for rev `5e9c3904` are identical to the session's (`diff -r`).

### Re-validation from the repo copy

On 2026-10-27 the stored run `exp/rig/validation/kevft-x5-dev` (X5 × Kev-FT, dev, `--args x9 --temps dev-cv`) was
reproduced with fresh inference from this directory, using the command in the example above (2.5 min wall time).
- **Byte-identical:** `items.jsonl`, `kev-items.json`, `rows.jsonl` and `results.md`.
- **Identical except for timings:** `step1.jsonl`, `args-x9.jsonl` and `kev.jsonl`. With `genMs`, `exactMs`, `exactRequests`, `wallMs`, `refMs` and `ms` dropped, they are equal as JSON: every pick, every trie logprob, every Kev probability, and all 196 x9 args with their scores.
- **`results.json`:** equal except for the two out-dir paths (`run`, `devCV.devDir`).
- **Headline (dev-cv, T_L 1.63 / T_K 4.0):**
  - fused op: 183/196;
  - gate gold-in-choices: 189;
  - ask: 29/216;
  - wrong: 11;
  - fully correct x9: 165/165;
  - effective: 170 / 170.
  These are the stored numbers.
- **`manifest.json`:** differs only in `frozen` (the new relative paths and `lib.ts`'s sha `0f496101…`) and in `rigFiles` (the path-edited files above). This is expected.
