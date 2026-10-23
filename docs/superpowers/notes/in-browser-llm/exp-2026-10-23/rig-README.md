# Evaluation rig: score a new LoRA / Kev on dev with one command

Inference only (native llama-server, Metal, this Mac). It never writes to the repo: patched step-2 code lives in
`trees/`, which is built from `git archive` of a pinned repo revision. Nothing under `exp/blind/` is read unless you
pass `--set heldout5 --blind-ok` (or a `--prereg` file that says `set: heldout5` + `blind_ok: yes`), and that is a code
path for the separate, pre-registered blind runs only.

## Command

```bash
cd exp/rig
./rig.sh --lora <lora.gguf> [--kev <kev.gguf>] --set dev|val|heldout5|file:<path> \
         [--args base|x6|x9[,..]] --out <dir> [--temps refit|frozen|explicit|dev-cv] \
         [--t-lora <x> --t-kev <y>] [--val-from <dir>] [--dev-from <dir>] \
         [--exclude-match <training-row-file>:<row-id>]... [--rev <git rev>] [--only id,id,..] [--blind-ok]
./rig.sh --prereg <prereg.md> [--prereg-run <name>] [--prereg-sha256 <hex>]   # every parameter from the file
```

Example: Round 8 LoRA and Kev-0.8B Q4 on dev, with all three args levels. This is the validation run below.

```bash
./rig.sh --lora ~/projects/powerhouse/bai-knowledge-note/training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf \
         --kev ../x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf --set dev --args base,x6,x9 --out validation/r8-kevq4-dev
```

Example: X5 × Kev at the gate-calibration G2 pair (pre-registration-2 arms A/B/C), on dev.

```bash
./rig.sh --lora <x5.gguf> --kev ../x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf --set dev --args x9 \
         --temps explicit --t-lora 1.63 --t-kev 0.75 --out validation/v2/x5-kevq4-dev-explicit
```

Defaults: `--args x9`, `--temps refit`, `--rev 5e9c39046dcd` (the registered X7 commit). Without `--kev`, only LoRA alone is reported.
Every producer can resume: rerunning with the same `--out` skips the rows it already has. Point `--out` at an existing `val/`
dir with `--set val` and it adds the val args without scoring step 1 again.
Wall time on this Mac, with load average ~20 from other jobs: about 8 min for R8 350M on dev + val with three args levels and Kev,
and about 9 min for X1 1.2B with x9 only. The exact trie takes a median of 0.31 s/item for 350M and 0.53 s/item for 1.2B.
X5 350M × Kev on dev with x9 only and `--temps explicit` (no val pass): about 2.5 min.

## What it does (in order)

1. **Trees** (`src/build-trees.sh`), built from `git archive <rev>` of `editors document-models tests tsconfig.json package.json`.
   `node_modules spike vendor training` are symlinks to the repo.
   - `base`: unpatched.
   - `x6`: `git apply patches/x6-args-ship.patch` (sha `8d29e48a…`).
   - `x9`: the x6 patch, then `patches/x9-args2.patch` (sha `11737382…`).

   Check: `x9/editors/knowledge-vault` is byte-identical to `x9-args2/mirror/`, and the x6 files are identical to `x6-args/ship/`.
   Every frozen copy is sha-checked against `FROZEN.sha256` on each run.
2. **Items** (`src/items.py`):
   - `dev`: held-out-3 + held-out-4, which is 196 action, 20 no-action and 12 multi items.
   - `val`: the Round 8 teacher val, which is 150 action and 18 no-action items; 107 of them carry step-2 args.
   - `heldout5`: refused unless `--blind-ok` is passed.
   - `file:<path>`: any set in the held-out schema.

   **`today` comes from the set's own `conventions.today`** (X9 date plumbing). Teacher rows use the replay clock
   `REPLAY_NOW` (2026-10-20), which is read out of `training/gen/replay.ts`.
3. **LoRA server** (`-c 4096 -np 1 --no-jinja --no-webui`):
   - `src/step1.ts`: R2c generation, then `step1Pick`, which gives `loraPick`. It then runs the frozen X3 `lib.ts` `trieScore`, both exact and branch, over every scoped op + `{"ops": []}`.
     Step 1 always uses the **base** tree, whatever `--args` is.
     It derives BOS and `<|im_end|>` from the served model and aborts if they differ from `lib.ts`'s LFM2 constants (1/7).
   - `src/step2.ts`, one process per level: step 2 on the **gold** op at temperature 0.
     - `base`: repo `V1_ARGS`.
     - `x6`: patched `V1_ARGS`. This equals X6 `ship-v1`, which equals X9's `ship` variant.
     - `x9`: patched `V1_ARGS` + `today` + `currentLists` (`currentListsFor`) + `STATE_CHOICES` merged into the ref candidates. This is X9's `combo`, i.e. the shipped patch.
     - Teacher-val state comes from replaying the fixture.
     - Scored as in X9's `score()`. STRICT = `scoreArgRow`, with `exact !== false && refExact !== false`. NORMALISED = the same check after trimming, collapsing spaces and stripping a trailing `[.!?,;:]` run in the string leaves of the predicted and gold `args`. Teacher rows use a canonical exact match.
4. **Kev server** (`-c 8192`): the frozen X4 `kev/node/decide.mjs` (sha `feed74fe…`), run with `--runtime server --variant desc --wording W3`.
   - The option text is `kev/data/catalog.json` (sha `b257573b…`).
   - The candidates are the LoRA's scoped list, asserted to be in catalog order (as in `heldout5-run1/build-kev-items.py`).
   - `--servedT` is read from the Kev GGUF's `*.decision.temperature.choice`, using a stdlib reader in `src/gguf_meta.py`. For Kev-0.8B that is 2.3510959148406982, the registered value.
5. **Evaluate** (`src/evaluate.py`): the X7 `prereg_eval.py` logic, generalised.
   - **Configs:** LoRA alone (C1); Kev alone (argmax over non-none ops, with the LoRA's none rule); LoRA×Kev equal-weight product (C2); and C2 plus the fused-margin gate at τ = 0.5 with fused top-3 offered (C3).
   - **No-action rule:** if the LoRA says `{"ops": []}`, the dispatch is none.
   - **Metrics:** op one-shot; fully-correct per args level, STRICT and NORMALISED; gate effective fully, using the optimistic user; gold-in-choices; ask rate over single-action + no-action items; wrong dispatches; fixed/broken vs LoRA with McNemar.
   - **Splits:** by the set's own `style` labels (natural/paraphrase on dev).
   - **Outputs:** `rows.jsonl` (in the X7 row schema, with `kev` in place of `kev_q4` and `args.{base,x6,x9}[_norm]`), `results.json`, `results.md` and `manifest.json` (GGUF shas, frozen shas, sha256 of every `src/*` file and `rig.sh`, temperature values, exclusions, prereg sha, llama.cpp commit, node/tsx versions).

6. **Exclusion** (only with `--exclude-match`): applied to the items of step 2, before step 3 starts any producer; see below.

## Temperatures (`--temps`)

Every run always reports the **frozen** block (X7's 1.80 / 1.00). `--temps` picks the headline and adds at most one block:

| `--temps` | T_L / T_K from | Extra scoring |
|---|---|---|
| `refit` (default) | Round 8 teacher val, as below | val (step 1 + Kev) into `<out>/val/`, or `--val-from` |
| `frozen` | X7: 1.80 / 1.00 | none |
| `explicit` | `--t-lora <x>` and (with `--kev`) `--t-kev <y>`, both > 0 | none |
| `dev-cv` | gate-calibration.md option G2: fit on dev human wording | for `--set dev`, none (fits on the run itself); else `--dev-from <dev run>`, or dev (step 1 + step 2 + Kev) into `<out>/dev/` |

**`refit`** refits both temperatures on the Round 8 teacher val. That is 168 single items, action + none, with the softmax over all options including none:
- **LoRA:** `T_L` by X3's `analyze.fit_T`. The grid is 0.2·1.05^k ≤ 8 and the objective is the NLL of gold. This is how X7's 1.80 was obtained (X3: 1.797).
- **Kev:** `T_K` by X4's `analysis.py` grid, 0.25…10 in steps of 0.25, as the NLL of gold on the one-stage `logprobsT1`.
  - **Change from X7:** X4 fitted Kev's 1.0 on the *Round 10* val. The rig uses the R8 val for both experts, so one val run serves both.
- **Caveat** (`validation/gate-calibration.md`): 140 of the 168 val ids are in X1's and X5's training data, so for those models `refit` is in-sample and too sharp (X5: 0.437).

**`dev-cv`** is the gate-calibration definition (G2), and what PREREGISTRATION-2 freezes:
- The same two fitters (`fit_T_lora`, `fit_T_kev`), pointed at the **dev** rows: held-out-3 + held-out-4, 196 action + 20 no-action, softmax over all scoped options incl. none.
- The all-dev pair is the `dev-cv` block (the headline). Then the X7 gate, unchanged: equal weights, τ 0.50, fused top 3, the none rule.
- **CV report** (`results.json` `devCV`, last table of `results.md`; never the headline): leave one group out on the dev rows. Fit on h3 and test h4, fit on h4 and test h3, sum the test folds. The fold temperatures are listed per test fold.
- Temperatures are never fit on the eval set itself unless it *is* dev. For a blind set, freeze the dev-cv values in the pre-registration and run with `explicit`.

## Exclusion (`--exclude-match <training-row-file>:<row-id>`, repeatable)

At run start, after the items are built and before any producer runs:
- `src/exclude.py` loads row `<row-id>` from the file (JSONL or a JSON array; `id` or `meta.id`, `utterance` or `meta.utterance`).
- It tests every eval item exactly as `training/round11-para/para.py` tests a training row against an eval set: `dedup.leak_hit(dedup.normalize(<training utterance>), [<item, prepared as dedup.load_eval does>])`.
  - That is char or word trigram Jaccard ≥ `dedup.LEAK_THRESHOLD` (0.5), or a 3+-word item utterance contained in the row, or equality.
  - `dedup` is imported from the repo (`training/py/dedup.py`, no bytecode written); its sha256 is recorded.
- Every hit is removed from `<out>/items.jsonl`, so no producer ever sees it, and from every config.
- **Blind safety:** only the excluded item id and score are logged or written (`excluded.json`, `results.*`, `manifest.json`, `logs/rig.log`). `leak_hit`'s `evalUtterance` is dropped.
- Zero hits is a `WARN`. With a prereg `expect_excluded`, a different count is logged as a `DEVIATION`; all hits stay excluded.
- The excluded items are not scored at all. Full-set numbers (prereg-2 §10, exploratory) need a separate run without the flag.

## Pre-registration mode (`--prereg <file>`)

`--prereg` must be the first argument and takes no other flags (except `--prereg-run`, `--prereg-sha256`). `src/prereg.py`:
1. Checks the file's sha256 **before parsing it**, against its sidecar (`<file>.sha256` or `<stem>.sha256`, the format of `x7-fusion/PREREGISTRATION.sha256`) and/or `--prereg-sha256`. Neither → refused; a mismatch → exit 3.
2. Reads one fenced block with info string `rig-run [<name>]` (several blocks → `--prereg-run <name>`). One `key: value` per line; `#` comments; unknown keys are refused.
   - Required: `lora`, `lora_sha256`, `set`, `args`, `temps`, `rev`, `out`. With `kev`, `kev_sha256` is required.
   - `set: heldout5` needs `blind_ok: yes` and `set_sha256`; `set: file:<path>` needs `set_sha256`.
   - Optional: `t_lora`, `t_kev` (required with `temps: explicit`), `val_from`, `dev_from`, `exclude_match` (repeatable), `expect_excluded`, `verify: <sha256> <path>` (repeatable; e.g. `rig/src/evaluate.py`).
   - Relative paths resolve against the prereg file's directory, then the repo, then `exp/`. `out` resolves against the prereg file's directory.
3. Verifies every listed sha256 (LoRA, Kev, set, `verify` files), then re-executes `rig.sh` with the resulting flags.

The run copies the file to `<out>/prereg/` and records its path, sha256, run name and `expect_excluded` in `manifest.json`. The sha is re-checked at the end.

Example block (the planned prereg-2 A/B/C run; the paths and shas are from the draft's §3, the evaluator sha is TBD):

````markdown
```rig-run x5-kev
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf
kev_sha256: 64f479de0a9ac921e2f5b941ff4549fff4b88588e0a31bf11462c552364746b1
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 1.63
t_kev: 0.75
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: <sha256 of rig/src/evaluate.py> rig/src/evaluate.py
out: heldout5-run2/x5-kev
```
````

## Validation and first use

See `validation/VALIDATION.md`. In short: on dev, the rig reproduces X7 (op 164/177, gate gold-in-choices 187 / ask 35,
fully STRICT 136/146 base and 143/153 ship, eff 160) and X9 (args 173 STRICT / 174 NORM on the gold op) **exactly**. All 196 step-2
args per item are byte-identical to the X6/X9 outputs, all picks are identical, and max |Δ trie| is 0.036 nat.
First use, R8 LoRA × Kev-0.8B Q4 with x9 args (frozen temps): op 177, fully 159 STRICT / 160 NORM, gate effective 166 / 167.
Comparisons across runs: `python3 src/compare.py --level x9 [--block frozen|refit|explicit|dev-cv] "A=<run>" "B=<run>" [--latency "A=<run>"]`.

### Re-validation after the explicit / dev-cv / exclusion / prereg extension (2026-10-23, `validation/v2/`)

- **Unchanged paths:** copies of `r8-kevq4-dev` and `x5-kevq4-dev` (with `val/`), rerun through `rig.sh` with their original flags, which resume every producer.
  - The `frozen` and `refit` blocks, `rows.jsonl` and `results.md` are identical to the stored runs (`rs-*`). Only the val-dir path differs.
- **Fresh inference**, X5 × Kev on dev, `--temps explicit --t-lora 1.63 --t-kev 0.75` (`x5-kevq4-dev-explicit`):
  - 228/228 picks identical, max |Δ loraExact| 0, max |Δ Kev| 0, and 196/196 x9 args identical to `x5-kevq4-dev`. The frozen block is identical.
  - Explicit block, gate: op 179, gold-in-choices 188, ask **33**/216, wrong 10, fully NORM 164, eff NORM 169 / STRICT 169. PoE: +10/−6 vs X5.
  - This equals `calib.py`'s G2 X5 **in-sample** row (188/33/10/169) and prereg-2 §8.
  - gate-calibration.md's table value **ask 34** is the **LOSO** sum (fold fits 1.63 / 1.71), not the all-dev pair. `--temps dev-cv` reproduces it.
- **`dev-cv`** (evaluator on the stored rows, `ev-*`; and through `rig.sh`/`--prereg`):

  | Model | All-dev T_L / T_K | Fold fits (test h3 / test h4) | LOSO op / gio / ask / wrong / fully NORM / eff NORM / eff STRICT |
  |---|---|---|---|
  | R8 | 2.184 / 0.75 | 2.184 / 2.184 | 178 / 187 / 38 / 12 / 161 / 167 / 166 |
  | X1 | 1.711 / 0.75 | 1.63 / 1.797 | 176 / 186 / 29 / 13 / 160 / 167 / 166 |
  | X5 | 1.63 / 0.75 | 1.711 / 1.63 | 179 / 188 / 34 / 10 / 164 / 169 / 169 |

  All three equal gate-calibration.md's G2 rows exactly, as do the X5 `dev-cv` headline block and the `explicit` 1.63/0.75 block.
  - `--set val --temps dev-cv` with `<out>/dev/` (`devcv-on-val`; dev producers resumed from stored X5 rows, so this exercises the plumbing, not fresh inference) gives the same T and LOSO as the dev run.
- **Exclusion** (`excl-test/`): fake training rows built from dev item kn3-16 (`fake-train.jsonl`).
  - The exact copy, an upper-cased/re-spaced/punctuated copy, and a copy embedded in a longer row each exclude kn3-16 at score 1.0. A one-word-swapped, truncated copy excludes it at 0.831. An unrelated row: WARN, no hit.
  - A fresh run via `--prereg PREREG-TEST.md --prereg-run x5-kev-dev` (fake-near, `expect_excluded: 1`) excluded kn3-16 only: 227 items in every producer file, 195 action.
  - Its blocks equal the full fresh run's rows minus kn3-16, evaluated at the same temperatures. The kn3-16 utterance appears in **no** file under the out dir; the id appears only in results, manifest, `excluded.json` and logs.
- **Prereg:**
  - Several blocks without `--prereg-run` → refused.
  - One edited byte (t_lora 1.63 → 1.64) → sidecar mismatch, exit 3. No sidecar and no `--prereg-sha256` → refused.
  - A wrong `lora_sha256` (with a matching sidecar) → refused. Extra CLI flags → refused.
  - `PREREG-TEST2.md` (dev-cv, an expected count of 1 against 0 hits) logs a `DEVIATION` and reproduces the evaluator's dev-cv blocks.

## Files

- `rig.sh`: the entry point.
- `src/`: `items.py`, `step1.ts`, `step2.ts`, `kev_items.py`, `gguf_meta.py`, `evaluate.py`, `exclude.py`, `prereg.py`, `validate.py`, `compare.py`, `build-trees.sh`, and `prereg_eval.py` (an untouched X7 copy, used only as a cross-check).
- `lib/lib.ts`: X3, frozen.
- `kev/`: X4 `decide.mjs` + `catalog.json`, frozen.
- `patches/`: the X6 and X9 patches.
- `trees/`: generated; deletable.
- `validation/`: runs, reports and comparison JSON; `validation/v2/` holds the re-validation above (`check_explicit.py` compares a fresh run with the stored one).
