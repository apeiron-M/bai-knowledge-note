# Evaluation rig: score a new LoRA / Kev on dev with one command

Inference only (native llama-server, Metal, this Mac). It never writes to the repo: patched step-2 code lives in
`trees/`, which is built from `git archive` of a pinned repo revision. Nothing under `exp/blind/` is read unless you
pass `--set heldout5 --blind-ok`, and that is a code path for the separate, pre-registered blind runs only.

## Command

```bash
cd exp/rig
./rig.sh --lora <lora.gguf> [--kev <kev.gguf>] --set dev|val|heldout5|file:<path> \
         [--args base|x6|x9[,..]] --out <dir> [--temps refit|frozen] [--val-from <dir>] \
         [--rev <git rev>] [--only id,id,..] [--blind-ok]
```

Example: Round 8 LoRA and Kev-0.8B Q4 on dev, with all three args levels. This is the validation run below.

```bash
./rig.sh --lora ~/projects/powerhouse/bai-knowledge-note/training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf \
         --kev ../x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf --set dev --args base,x6,x9 --out validation/r8-kevq4-dev
```

Defaults: `--args x9`, `--temps refit`, `--rev 5e9c39046dcd` (the registered X7 commit). Without `--kev`, only LoRA alone is reported.
Every producer can resume: rerunning with the same `--out` skips the rows it already has. Point `--out` at an existing `val/`
dir with `--set val` and it adds the val args without scoring step 1 again.
Wall time on this Mac, with load average ~20 from other jobs: about 8 min for R8 350M on dev + val with three args levels and Kev,
and about 9 min for X1 1.2B with x9 only. The exact trie takes a median of 0.31 s/item for 350M and 0.53 s/item for 1.2B.

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
   - **Outputs:** `rows.jsonl` (in the X7 row schema, with `kev` in place of `kev_q4` and `args.{base,x6,x9}[_norm]`), `results.json`, `results.md` and `manifest.json` (GGUF shas, frozen shas, llama.cpp commit, node/tsx versions).

## Temperatures (refit per new model)

The headline (`--temps refit`, the default) **refits both temperatures on the Round 8 teacher val**. That is 168 single items, action + none, with the softmax over all options including none:
- **LoRA:** `T_L` by X3's `analyze.fit_T`. The grid is 0.2·1.05^k ≤ 8 and the objective is the NLL of gold. This is how X7's 1.80 was obtained (X3: 1.797).
- **Kev:** `T_K` by X4's `analysis.py` grid, 0.25…10 in steps of 0.25, as the NLL of gold on the one-stage `logprobsT1`.
  - **Change from X7:** X4 fitted Kev's 1.0 on the *Round 10* val. The rig uses the R8 val for both experts, so one val run serves both.
- **Val run:** for a non-val `--set`, the rig scores val itself (step 1 + Kev, no args) into `<out>/val/`. Reuse an earlier one with `--val-from`.
- **Frozen block:** the X7-frozen pair (1.80 / 1.00) is always reported as well. Use `--temps frozen` to make it the headline, which is right for the registered models.

## Validation and first use

See `validation/VALIDATION.md`. In short: on dev, the rig reproduces X7 (op 164/177, gate gold-in-choices 187 / ask 35,
fully STRICT 136/146 base and 143/153 ship, eff 160) and X9 (args 173 STRICT / 174 NORM on the gold op) **exactly**. All 196 step-2
args per item are byte-identical to the X6/X9 outputs, all picks are identical, and max |Δ trie| is 0.036 nat.
First use, R8 LoRA × Kev-0.8B Q4 with x9 args (frozen temps): op 177, fully 159 STRICT / 160 NORM, gate effective 166 / 167.
Comparisons across runs: `python3 src/compare.py --level x9 [--block frozen] "A=<run>" "B=<run>" [--latency "A=<run>"]`.

## Files

- `rig.sh`: the entry point.
- `src/`: `items.py`, `step1.ts`, `step2.ts`, `kev_items.py`, `gguf_meta.py`, `evaluate.py`, `validate.py`, `compare.py`, `build-trees.sh`, and `prereg_eval.py` (an untouched X7 copy, used only as a cross-check).
- `lib/lib.ts`: X3, frozen.
- `kev/`: X4 `decide.mjs` + `catalog.json`, frozen.
- `patches/`: the X6 and X9 patches.
- `trees/`: generated; deletable.
- `validation/`: runs, reports and comparison JSON.
