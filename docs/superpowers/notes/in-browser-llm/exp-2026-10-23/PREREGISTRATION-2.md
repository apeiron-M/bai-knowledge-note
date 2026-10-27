# Pre-registration 2: one consolidated blind run on held-out-5 (run 2)

Frozen 2026-10-26, before any held-out-5 producer of run 2 ran. The sha256 of this file is in `PREREGISTRATION-2.sha256` next to it; `rig.sh --prereg` refuses the file if one byte differs. Any edit after the first held-out-5 block starts voids the registration. Nothing under `exp/blind/` was opened to write it, and no held-out set was run. Every parameter below comes from dev (held-out-3 + held-out-4) or from training artifacts. It replaces `PREREGISTRATION-2-DRAFT.md` (2026-10-23), whose arms E/F are now concrete (Kev-FT, F) and whose zero-shot-Kev arms are dropped.

Paths are relative to `exp/` (the scratchpad experiment root) unless they start with `training/`, which is the repo. The machine-readable parameters are the `rig-run` blocks in §13; where prose and a block disagree, the block is what runs and the disagreement is a registration error to be reported.

## 0. Prior use of held-out-5, stated before the run

Held-out-5: `blind/heldout5/heldout5-eval.json`, sha256 `c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e`; 165 single-action, 15 no-action, 0 multi items (run 1, Part A).

1. **Run 1 (2026-10-23)** ran the X7 registration once (R8 LoRA x zero-shot Kev-0.8B Q4, base/ship args). Report `heldout5-run1/RESULTS.md`: C1 op 135/165, C2 146/165 (+14/-3, p 0.0064), C3 gold-in-choices 97.0%, ask 24.4%, wrong 6. Item-level outputs exist in `heldout5-run1/out/`.
2. **The X5 / Round 11 data build filtered against held-out-5.** `training/round11-para/para.py` read the held-out-5 utterances to drop near-copies (source prefilter, `leak` step, prompt check); hits were logged as set + score only. It dropped 1 Round 10 row (`gen-observation--IMPLEMENT_OBSERVATION-1-3`, §4) and 1 paraphrase rewrite. X5 and F were trained on that filtered data; R8, X1 and Kev-FT were not.
3. **One held-out-5 item near-copies a Round 10 training row** (§4). It is excluded from the primary analysis.
4. **This design used run-1 aggregates**: the ask-rate transfer (dev 16.2% -> held-out-5 24.4%) informed the expectation that the gate stays under the 30% ask bar. No parameter was fit on held-out-5; every temperature, tau, k and weight is from dev.
5. **Item ids seen.** The draft's author saw run 1's per-category id lists. The author of this file saw, in `heldout5-run1/RESULTS.md`, the ids rc5-01, rc5-03, none5-07, none5-09, none5-13, moc5-12, wbs5-22 and pq5-02 (ids only; no utterance, gold or output). None was used.
6. **Held-out-6 (`blind/heldout6/`) is untouched** and stays so. It is reserved for the final confirmation of the winner of this run (§9).

**Consequence.** Run 2 is the second look at held-out-5. It is confirmatory for the questions registered here (none was chosen by looking at held-out-5 items), but not a clean first test; the clean test is held-out-6.

## 1. Arms

All arms: step 1 (R2c pick + exact trie over every scoped op + none) from the base tree at repo rev `5e9c39046dcd8f08951a308e66c610dbd4c55c73`; the X7 none rule (LoRA says `{"ops": []}` -> dispatch none, no fusion, no ask); step 2 on the **gold** op at temperature 0 with that arm's own LoRA under **x9 args** (X9 shipped patch: patched `V1_ARGS` + `today` + `currentLists` + `STATE_CHOICES`). Fully-correct = [dispatched op == gold] and args-ok(gold op). Kev-FT is `decide.mjs --runtime server --variant desc --wording W3`, one-stage `logprobsT1`, servedT read from its GGUF (2.700699806213379).

| Arm | Run (block) | Op decision | Ask | On device |
|---|---|---|---|---|
| **A** | `x5-kevft`, config `lora` | X5 native greedy R2c pick | never | 229 MB |
| **B** | `x5-kevft`, config `lora_x_kev` | argmax over non-none ops of 0.5 log softmax(X5 exact / **1.63**) + 0.5 log softmax(Kev-FT logprobsT1 / **4.0**) | never | 229 + 530 MB |
| **C** | `x5-kevft`, config `gate` | as B | ask iff p1 - p2 < **0.50** (p = softmax of the fused score over all options incl. none; p1, p2 the two best non-none ops); offer the fused top **3**, ties in catalog order; "none of these" allowed | 229 + 530 MB |
| **D** | `f-kevft`, config `gate` | as C with F: 0.5 log softmax(F exact / **2.08**) + 0.5 log softmax(Kev-FT / **4.0**), same gate rule | as C | 731 + 530 MB |
| **K** | `r8`, config `lora` | R8 native greedy R2c pick: run 1's C1 op path (same GGUF, same step 1) | never | 229 MB |

K is the continuity control. Its op decisions on the full set must reproduce run 1's C1 picks (§5 step 6); its args are x9, so its fully-correct numbers are not comparable to run 1's base/ship numbers. Also reported, descriptive only: F alone and F x Kev-FT PoE (configs `lora`, `lora_x_kev` of the `f-kevft` run), and Kev-FT alone under each LoRA's none rule (rig config `kev`).

## 2. Temperatures (frozen, explicit)

The gate-calibration G2 procedure (`rig/validation/gate-calibration.md`): per expert, T by NLL of gold on the dev rows (held-out-3 + held-out-4, 196 action + 20 no-action, softmax over all scoped options incl. none), grids `fit_T_lora` (0.2 x 1.05^k <= 8, rounded to 3 dp) and `fit_T_kev` (0.25..10 step 0.25). Values are the **all-dev** fits recorded by `rig.sh --temps dev-cv` in the stored dev runs:

| Pair | T_L | T_K | Source run (results.json `devCV`) | LOSO folds (test h3 / test h4) |
|---|---|---|---|---|
| X5 x Kev-FT (A/B/C) | **1.63** | **4.0** | `rig/validation/kevft-x5-dev` | 1.711/3.75, 1.63/4.25 |
| F x Kev-FT (D) | **2.08** | **4.0** | `rig/validation/f-kevft-dev` | 2.08/3.75, 1.981/4.25 |
| R8 (K) | 2.184 | - | `rig/validation/kevft-r8-dev` | 2.184, 2.184 |

R8's T only satisfies `--temps explicit`; it does not enter the LoRA-alone config K. Weights 0.5/0.5, tau 0.50, k 3 and the none rule are the X7 values, unchanged. Nothing is fit on held-out-5. The rig also prints its `frozen` block (X7's 1.80/1.00) for every run; it is exploratory.

## 3. Frozen artifacts

| Item | Path | sha256 | Bytes |
|---|---|---|---|
| X5 350M LoRA (A, B, C) | `training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf` | `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba` | 229,312,224 |
| Kev-FT 0.8B Q4_K_M (B, C, D) | `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` | `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23` | 529,595,072 |
| F 1.2B LoRA (D) | `training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf` | `59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269` | 730,896,096 |
| R8 350M LoRA (K) | `training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf` | `6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00` | 229,312,224 |
| Held-out-5 | `blind/heldout5/heldout5-eval.json` | `c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e` | |
| Rig | `rig/`: `FROZEN.sha256` `4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf` (lib.ts `b48ff64f…`, decide.mjs `feed74fe…`, catalog `b257573b…`, x6 patch `8d29e48a…`, x9 patch `11737382…`) | see the `verify` lines in §13 for every rig file | |
| Evaluator | `rig/src/evaluate.py` | `69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50` | |
| Analysis (new) | `x7-fusion/code/prereg2_analysis.py`: imports `evaluate.decide` / `mcnemar`, asserts its within-run totals equal each run's `results.json` explicit block, and adds the cross-run tests, splits, Wilson CIs, determinism and continuity checks | `a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19` | |
| Exclusion source | `training/artifacts/round10/final/rows-kept.jsonl` | `550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c` | |
| dedup | `training/py/dedup.py` | `09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e` | |
| Runtime | native `~/.cache/bai-training/llama.cpp/build/bin/llama-server`, llama.cpp `46ca246`, Metal. LoRA server `-c 4096 -np 1 --no-jinja --no-webui`; Kev server `-c 8192` (as `rig.sh`) | | |

## 4. Exclusion: the held-out-5 item that near-copies Round 10 row `gen-observation--IMPLEMENT_OBSERVATION-1-3`

Evidence (training logs, no blind file read): `round11-para/sources.jsonl.summary.json` `blindPrefilterDropped {"heldout5": 1}`; `merged/split/split.json` `baseEvalLeakRows {"train:heldout5": 1}`. The dropped row is the only Round 10 train id missing from the merged Round 11 split.

Who trained on it (checked by id in the training files at freeze time):
- **R8**: yes, 2 sequences in `round8/split/train-split.jsonl`.
- **X1**: yes (`round10/split/train-split.jsonl`); X1 is not an arm.
- **Kev-FT**: yes (`x4-kev/finetune/data/train.jsonl`, sha `ed3d9aac…`, 1 row).
- **X5 and F**: **no**. Both were trained on `round11-para/merged/split/train-split.jsonl` (sha `1c4718d3…`), which does not contain it. (The brief for this file said F was trained on it; the training file says otherwise.)

So the item can favour K (R8) and every Kev-FT arm (B, C, D), and not A. **Rule, applied by the rig at run start, before any producer** (`--exclude-match`, `rig/src/exclude.py`): `dedup.leak_hit(dedup.normalize(<row utterance>), [<item>])` against every held-out-5 item (char or word trigram Jaccard >= 0.5, or containment of a 3+-word item utterance, or equality); every hit is removed from every arm; only ids and scores are logged. Expected count 1 (`expect_excluded: 1`); any other count is logged by the rig as a `DEVIATION` and all hits stay excluded. The excluded id(s) are written into Part A of the results.

The Round 10 **val** rewrite `para-gen-observation--IMPLEMENT_OBSERVATION-1-6-lowercase` (rejected as `eval-leak:heldout5` by the Round 11 build) is not a training row of any arm and is **not** an exclusion spec; the draft's informational check of it is dropped (the rig can only exclude, not just report).

**Both views are reported.** Primary = with the exclusion (expected 164 action + 15 no-action). Secondary = the full set, from separate `*-full` runs without `--exclude-match` (the rig never scores an excluded item). The decision rules in §9 use the primary view only.

## 5. Procedure (one run, no re-tuning)

1. **Integrity.** `rig.sh --prereg` checks this file against its sidecar, then every sha in the block (GGUFs, held-out-5, every `verify` file) before anything runs. Repo rev and llama.cpp commit are recorded in each `manifest.json`.
2. **Parity on dev.** Move the freeze-time validation outputs `x7-fusion/prereg2-dev/` to `x7-fusion/prereg2-dev-freeze/` (a move, not an edit), then run the three dev blocks (`x5-kevft-dev`, `f-kevft-dev`, `r8-dev`). Their rows must equal the freeze-time rows (picks and args identical, |delta trie| <= 0.05 nat, Kev |delta| = 0) and their analysis must reproduce §10. A failure stops the run before held-out-5.
3. **Held-out-5, primary.** Run blocks `x5-kevft`, `f-kevft`, `r8` (in that order), each with the exclusion.
4. **Held-out-5, full set.** Run blocks `x5-kevft-full`, `f-kevft-full`, `r8-full`.
5. **Date fallback** (§7): only if step 3 aborts with `x9 needs a per-item today`, run the six `*-x6` blocks instead of steps 3-4.
6. **Analyse once:**
   `python3 x7-fusion/code/prereg2_analysis.py --x5 heldout5-run2/x5-kevft --f heldout5-run2/f-kevft --r8 heldout5-run2/r8 --x5-full heldout5-run2/x5-kevft-full --f-full heldout5-run2/f-kevft-full --r8-full heldout5-run2/r8-full --run1 heldout5-run1/out/prereg-input-h5.jsonl --out heldout5-run2/analysis`
   (with the `-x6` dirs under the fallback). It aborts if any within-run total differs from the rig's `results.json`, if the three runs differ in items or labels, or if temperatures differ from §2. It also reports: determinism (excluded vs full runs agree on every shared row) and continuity (K's full-set picks vs run 1's C1 picks; expected 165/165 agreeing, op 135/165, |delta trie| <= 0.05 nat). Report every number it prints, and each run's `results.md`.

Crashes, retries and missing items are logged, never silently fixed. Resuming an interrupted block with the same `out` (the rig skips completed rows; producers are deterministic) is allowed and logged. Multi-action items are excluded from every primary metric (held-out-5 has 0).

## 6. Metrics and scoring

- **Args: x9 NORMALISED is primary, x9 STRICT secondary.** STRICT = `scoreArgRow`, ok = `exact !== false && refExact !== false`. NORMALISED = the same after trimming, collapsing whitespace and stripping one trailing `[.!?,;:]` run in the string leaves of predicted and gold `args` (X9 recommendation; blind writers keep the final ".").
- **Op one-shot** = dispatched op == gold over single-action items (no ask). It is the metric of H1-H3.
- **Fully-correct** (A, B, K, and the PoE configs), over single-action items with step-2 labels.
- **Gated (C, D):** effective fully-correct with the optimistic simulated user (picks gold when offered, else "none of these", which is neither correct nor wrong); gold-in-choices over single-action items (asked: gold in the offered 3; not asked: dispatch == gold); ask over single-action + no-action items; wrong dispatches = dispatched op != gold on action items + any dispatch on a no-action item.
- **No-action:** true positives and predicted-none per arm.
- **Splits** by the set's own labels: `style` (plain / messy; style subsets include that style's no-action items), `difficulty` (easy / medium / hard; action items only, as no-action items carry none), and style x difficulty. Small cells are reported, not tested.
- **Wilson 95% CI** on every op one-shot proportion.

## 7. Evaluation date for relative dates

**Rule:** `today` = the set's `conventions.today` (first 10 characters, `YYYY-MM-DD`), as `rig/src/items.py` reads it; the value is printed in the items summary line of `logs/rig.log` and goes into Part A. This is the set's own convention (held-out-3/4 carry `"today": "2026-10-22 (for relative dates)"`).

**Fallback, decided now.** Whether held-out-5 carries `conventions.today` is unknown without opening it. If it does not, `step2.ts` aborts at x9 by design (`x9 needs a per-item today`), after step 1 has run. Then: **skip date pinning** by running the six `*-x6` blocks: identical except `args: x6` (X6 ship patch = x9 without `today`, `currentLists` and `STATE_CHOICES`; rig-validated on dev against X6). No date is guessed, and no README or other blind file is consulted for one. Step 1 and Kev are deterministic, so the op decisions, the gate and H1-H5 are unchanged by the fallback; only fully-correct moves to the x6 level and is labelled "x6 (no date pinning)". Taking the fallback is not a deviation; the aborted x9 runs are kept and logged.

## 8. Hypotheses

Paired per item on the same (primary-view) items. Tests are one-sided exact McNemar on per-item [op one-shot correct] (`evaluate.mcnemar`), alpha = 0.05.

- **H1 (primary): B > A.** Confirmed iff fixed > broken and p < 0.05. Does Kev-FT fusion beat X5 alone? Also reported: the same on fully NORM.
- **H2 (key secondary): B > K.** Confirmed iff fixed > broken and p < 0.05. Does the new one-shot decider beat run 1's control path?
- **H3 (descriptive): B op one-shot >= 90%**, reported with its Wilson 95% CI. "Met" = point estimate >= 90%; whether the CI's lower bound clears 90% is also stated.
- **H4 (gate C bars):** gold-in-choices >= 92% (of action items) and ask <= 30% (of single-action + no-action items); both required. Wrong dispatches are reported, with A, B, K and D for reference; no bar. Also reported: C effective NORM vs A fully NORM (per 100 action items, and paired fixed/broken).
- **H5 (descriptive): D vs C.** Op, fully NORM/STRICT, gold-in-choices, ask, wrong, effective NORM/STRICT, no-action TP, and paired fixed/broken on op and on effective NORM with exact two-sided p. No decision is attached.

**Multiplicity.** H1 and H2 are the two tests, each judged at alpha 0.05 as stated. A Holm reading (smaller p vs 0.025, larger vs 0.05) is reported alongside; it is not the decision rule. H3-H5 are descriptive.

## 9. Decision rule: the winner taken to held-out-6

- If H1 is confirmed and H4 is met: **C** (X5 x Kev-FT + gate) for Flow 4.
- Else if H1 is confirmed: **B** (one-shot fusion, no ask).
- Else: **A** (X5 alone, one 229 MB model); the dev fusion gain is treated as selection noise.
- H2 failing does not change the winner, but is reported as a red flag (the new pipeline not beating the old control path).
- D is not eligible to win on run 2 (H5 is descriptive): F costs 3.2x X5's size and ~1.9x its latency and was not better on dev.
- The winner is confirmed once on held-out-6 under a separate, later registration.

## 10. Expected numbers (dev, from the stored rig runs; in-sample for the temperatures, LOSO in brackets)

Computed by `prereg2_analysis.py` on the stored dev rows re-evaluated at the §2 temperatures (196 action, 20 no-action; dev styles are natural/paraphrase). These are the parity targets of §5 step 2.

| Dev | A: X5 | B: X5 x Kev-FT | C: B + gate | D: F x Kev-FT + gate | K: R8 |
|---|---|---|---|---|---|
| Op one-shot | 175 (89.3%) | 183 (93.4%, Wilson 89.0-96.1) | 183 | 182 | 164 (83.7%) |
| Fully x9 NORM / STRICT | 159 / 159 | 165 / 165 | eff 170 / 170 [170] | eff 169 / 169 [169] | 149 / 148 |
| Gold-in-choices | 175 | 183 | 189 (96.4%) [189] | 190 [190] | 164 |
| Ask /216 | 0 | 0 | 29 (13.4%) [30] | 24 [25] | 0 |
| Wrong dispatches | 29 | 21 | 11 [10] | 10 [10] | 39 |
| No-action TP /20 | 12 | 12 | 12 | 14 | 13 |

H1 on dev: B vs A +10/-2, p 0.019. H2 on dev: B vs K +21/-2, p 3.3e-05. H5 on dev: D vs C op +2/-3, eff NORM +4/-5. C eff NORM - A fully NORM = +5.6 per 100 (+11/-0).

**Held-out-5 expectations.** Run 1 lost ~2 pp of op versus dev, asked ~1.5x as often and had weaker args (gold-op args 79% vs 84%). So expect B op ~90-92% (H3 near its bar; at n ~164 the Wilson half-width is ~4.5 pp), C ask ~20% and gold-in-choices ~94-97%. The fusion gain over X5 is +8 op on dev, from a +10/-2 discordant set; at n ~164 H1 could fail on noise alone.

## 11. Known risks, stated in advance

- **Temperatures are fit on dev**, the same rows as §10; LOSO differs from in-sample by <= 1 item per metric.
- **Kev-FT T_K = 4.0** (dev) vs its in-distribution 2.70: it is more overconfident on human wording than its own calibration says; held-out-5 is messier still.
- **Leak asymmetry:** the §4 item favours R8 and Kev-FT; it is excluded. X5's and F's data were filtered against held-out-5; R8's, X1's and Kev-FT's were not, beyond this one known row. Kev-FT's training rows had no separate near-duplicate check against held-out-5.
- **Kev-FT prompt packing:** its training records carried the `noul` question in the same record; the rig sends the op choice alone (`decide.mjs` frozen). Untested.
- **Optimistic simulated user** for all gated metrics.
- **Second use of held-out-5** (§0).
- **Date fallback** (§7) would lower fully-correct for date items for every arm alike.

## 12. Exploratory (logged, not used for any decision)

The rig's `frozen` (1.80/1.00) block for every run; Kev-FT alone; F alone and F x Kev-FT PoE; branch-only trie scores; the full-set view's hypotheses (§4); per-style ask.

## 13. Machine-readable run blocks (`rig.sh --prereg x7-fusion/PREREGISTRATION-2.md --prereg-run <name>`)

Relative paths resolve against `x7-fusion/`, then the repo, then `exp/`. Every block verifies the same rig, analysis, dedup and exclusion-source files. Dev blocks (`*-dev`) are the parity check; their exclusion is expected to hit nothing on dev.

### Parity on dev (§5 step 2; also the freeze-time validation)

```rig-run x5-kevft-dev
# dev parity for arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: dev
args: x9
temps: explicit
t_lora: 1.63
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: prereg2-dev/x5-kevft-dev
```

```rig-run f-kevft-dev
# dev parity for arm D (+ F alone, F x Kev-FT PoE, descriptive)
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: dev
args: x9
temps: explicit
t_lora: 2.08
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: prereg2-dev/f-kevft-dev
```

```rig-run r8-dev
# dev parity for arm K (control)
lora: training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf
lora_sha256: 6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00
set: dev
args: x9
temps: explicit
t_lora: 2.184
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: prereg2-dev/r8-dev
```

### Held-out-5, primary view: with the exclusion (§5 step 3)

```rig-run x5-kevft
# held-out-5 primary, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 1.63
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/x5-kevft
```

```rig-run f-kevft
# held-out-5 primary, arm D (+ F alone, F x Kev-FT PoE, descriptive)
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 2.08
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/f-kevft
```

```rig-run r8
# held-out-5 primary, arm K (control)
lora: training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf
lora_sha256: 6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 2.184
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/r8
```

### Held-out-5, secondary view: full set, no exclusion (§5 step 4)

```rig-run x5-kevft-full
# held-out-5 full set, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 1.63
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/x5-kevft-full
```

```rig-run f-kevft-full
# held-out-5 full set, arm D (+ F alone, F x Kev-FT PoE, descriptive)
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 2.08
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/f-kevft-full
```

```rig-run r8-full
# held-out-5 full set, arm K (control)
lora: training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf
lora_sha256: 6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x9
temps: explicit
t_lora: 2.184
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/r8-full
```

### Date fallback, only if the x9 blocks abort for lack of `conventions.today` (§7)

```rig-run x5-kevft-x6
# date fallback, primary, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 1.63
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/x5-kevft-x6
```

```rig-run f-kevft-x6
# date fallback, primary, arm D (+ F alone, F x Kev-FT PoE, descriptive)
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 2.08
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/f-kevft-x6
```

```rig-run r8-x6
# date fallback, primary, arm K (control)
lora: training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf
lora_sha256: 6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 2.184
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/r8-x6
```

```rig-run x5-kevft-full-x6
# date fallback, full set, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 1.63
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/x5-kevft-full-x6
```

```rig-run f-kevft-full-x6
# date fallback, full set, arm D (+ F alone, F x Kev-FT PoE, descriptive)
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 2.08
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/f-kevft-full-x6
```

```rig-run r8-full-x6
# date fallback, full set, arm K (control)
lora: training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf
lora_sha256: 6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00
set: heldout5
set_sha256: c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e
blind_ok: yes
args: x6
temps: explicit
t_lora: 2.184
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 9059152e18990286534df418271d12ade66dc57ac8c9abad8e458a901d9257e8 rig/src/exclude.py
verify: e6de02685796be5a27b6ef2ccb4835267a9ce4f4eeaa34a197fbfd9fdc91d6db rig/src/items.py
verify: 8c5253b7978fc05f50853df0a84c6fcb43b72f857296578cea34b8f8a4fabe16 rig/src/step1.ts
verify: aece6fc0b4c5d75399b781d4365069919117960e81f4f2e51f8c3ed7d1197048 rig/src/step2.ts
verify: 5665ba55ac98e574667d87b37628658d476cbbf2b050902fdae4d60ce044f13c rig/src/kev_items.py
verify: 6e353eaa8eb6d4f7d4ecd13a8aa3e112721e4ca9ae5b52db9e149030c4685703 rig/src/gguf_meta.py
verify: 61a0a156dff0c7ef841c8b9f5741b097948073847ab5e700479d0c86ab07d9ed rig/src/prereg.py
verify: 183efd66617858d18e2c835b03193df5791482b320008fc77022148c4d7af296 rig/src/build-trees.sh
verify: 4faea56c4865c9f050dcb5ad023c88879efddc2bba59d46648672dffb199e672 rig/rig.sh
verify: 4c7f41e3e3e11e8873e0d875c835d2a9bff1b3698c89f0f5860a6d268d644acf rig/FROZEN.sha256
verify: a36ce55bf7676054285ba3a27cf9e6be6ea1c2853c43e78c3690df3f4f773a19 code/prereg2_analysis.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
out: ../heldout5-run2/r8-full-x6
```
