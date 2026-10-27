# Pre-registration 3: the single confirmatory run on held-out-6

Frozen 2026-10-27, before any held-out-6 producer ran (revision 2 of the same day; see §0.6). The sha256 of this file is in `PREREGISTRATION-3.sha256` next to it; `rig.sh --prereg` refuses the file if one byte differs, and any edit after the first held-out-6 block starts voids the registration. No held-out-6 item was opened to write it and no held-out set was run (§0). Every model, temperature, weight, gate parameter, args level and scoring rule is **identical to PREREGISTRATION-2** (`x7-fusion/PREREGISTRATION-2.md`, sha256 `798b289e…c333`); nothing was retuned. What is new: the eval set (held-out-6), a wider exclusion (§4), the arm list (§1), the hypotheses (§8) and the shipping rule (§9).

Paths are relative to `exp/` (the scratchpad experiment root) unless they start with `training/`, which is the repo. Commands run from `exp/`. The machine-readable parameters are the `rig-run` blocks in §13; where prose and a block disagree, the block is what runs and the disagreement is a registration error to be reported.

## 0. Prior use of held-out-6 and what the author saw, stated before the run

Held-out-6: `blind/heldout6/heldout6-eval.json`, sha256 `85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775`. The author computed this sha (equal to `heldout6-eval.json.sha256`) without opening the file.

1. **No evaluation has touched held-out-6.** It has never been passed to the rig, the harness or any model.
2. **The X5 / F training data was filtered against it.** `training/round11-para/para.py` read the held-out-6 utterances (the file with this sha: `round11-para/sources.jsonl.summary.json` `blind.heldout6.sha256` = `85942add…`, `sidecarMatches: true`) in three places, logging set + score only: the source prefilter (`blindPrefilterDropped` lists heldout5 1, heldout6 0), the `leak` step on the rewrites (heldout6 0, `x5-paraphrase-data/REPORT.md`), and the `mirror` step on the Round 10 base rows (`merged/split/split.json` `baseEvalLeakRows` lists only `train:heldout5: 1`). X5 and F were trained on the result; Kev-FT was not (§4).
3. **The author read `blind/heldout6/README.md` in full**: format, counts (200 action items over 94 ops, 20 no-action, 0 multi; 70 plain / 130 messy; easy/medium/hard 12/129/59, every hard item messy), the messy-kind tags (26 terse, 30 partial-title, …), the domains, the field-class conventions, and the sentence "today is 2026-10-23". It names some ids (kn6-11, prj6-01, prj6-02, pq6-01, pq6-02; ids and a field name only, no utterance or gold). Nothing from the README sets a parameter: the date is read by the rig from the set (§7) and the README's sentence is not used.
4. **This design was made after held-out-5 run 2** (`heldout5-run2/RESULTS.md`): the arm choice (C and D, both confirmed here), the 3-point margin of the shipping rule (§9) and the expectations in §10 use its aggregates. On held-out-5 the §9 rule would have chosen D (effective NORM 151 vs 142 of 164, +5.5 points, +10/-1, two-sided p 0.0117). No temperature, tau, k or weight was refit after it.
5. **Dev only, at freeze time:** the new exclusion (§4) was run on dev items (held-out-3 + held-out-4, not blind). It hits one dev item, `none3-02` (score 1.0, containment, Kev-FT row `gen-knowledge-note--UPDATE_LINK_TYPE-4-0`). That is why the dev parity has two block pairs (§5).

6. **Revision before any held-out-6 run (2026-10-27).** The first frozen version (sha256 `12566281fae803427d25a230cc280ecb8e695466973f312c1b3d01c259246913`, kept as `x7-fusion/prereg3-exclusion/PREREGISTRATION-3-v1-12566281.md.txt`) made P1/P2 pass only on a Holm-corrected one-sided exact binomial test against 90%. At n = 200 that needs >= 189/200 (94.5%), so §10 predicted both would fail even with a point estimate above 90%. The user decided, before any held-out-6 block ran and with no held-out-6 result in existence, that **the pass criterion is the point estimate >= 90% of the scored action items, with the Wilson 95% CI reported**, and that the exact binomial test (with Holm over the two) stays as a reported secondary. The user also accepted the `exclude.py` `<file>:*` change (§3). Only §0, §8, §10, the analysis sha and its `verify` lines changed; `prereg3_analysis.py` changed only in how P1/P2 are labelled (`b317dbcb…` -> `8be69b8c…`, the old version kept as `prereg3-exclusion/prereg3_analysis-b317dbcb.py.txt`). The dev blocks were rechecked under this revision (§5 step 2).

**Consequence.** Held-out-6 is a clean first test for every registered question. It is run once.

## 1. Arms (no others)

All arms are prereg-2's machinery, unchanged: step 1 (R2c pick + exact trie over every scoped op + none) from the base tree at repo rev `5e9c39046dcd8f08951a308e66c610dbd4c55c73`; the X7 none rule (LoRA says `{"ops": []}` -> dispatch none, no fusion, no ask); step 2 on the **gold** op at temperature 0 with that arm's own LoRA under **x9 args** (patched `V1_ARGS` + `today` + `currentLists` + `STATE_CHOICES`). Kev-FT is `decide.mjs --runtime server --variant desc --wording W3`, one-stage `logprobsT1`, servedT read from its GGUF. Fusion is 0.5 log softmax(LoRA exact / T_L) + 0.5 log softmax(Kev-FT logprobsT1 / T_K), argmax over non-none ops. The gate asks iff p1 - p2 < **0.50** (p = softmax of the fused score over all options incl. none; p1, p2 the two best non-none ops), offers the fused top **3** (ties in catalog order) plus "none of these".

| Arm | Role | Run (block) / rig config | Op decision | Ask | On device |
|---|---|---|---|---|---|
| **C** | confirmed | `x5-kevft`, `gate` | X5 x Kev-FT fused, T 1.63 / 4.0 | gate tau 0.5, top 3 | 229 + 530 MB |
| **D** | confirmed | `f-kevft`, `gate` | F x Kev-FT fused, T 2.08 / 4.0 | same gate | 731 + 530 MB |
| **B** | C one-shot (P1) | `x5-kevft`, `lora_x_kev` | as C | never | 229 + 530 MB |
| **D-oneshot** | D one-shot (P2) | `f-kevft`, `lora_x_kev` | as D | never | 731 + 530 MB |
| **A** | reference only | `x5-kevft`, `lora` | X5 native greedy R2c pick | never | 229 MB |

B and D-oneshot are the dispatch rules of C and D without the ask; they carry the op hypotheses P1/P2 and are otherwise descriptive. The rig also prints F alone, Kev-FT alone and the `frozen` (1.80 / 1.00) block in each `results.md`; they are not analysed (§12). R8 / K is dropped.

## 2. Temperatures (frozen, identical to prereg-2 §2)

| Pair | T_L | T_K | Source (all-dev G2 fit, `rig.sh --temps dev-cv`) |
|---|---|---|---|
| X5 x Kev-FT (A, B, C) | **1.63** | **4.0** | `rig/validation/kevft-x5-dev` |
| F x Kev-FT (D-oneshot, D) | **2.08** | **4.0** | `rig/validation/f-kevft-dev` |

Equal weights 0.5 / 0.5, tau 0.50, k 3 and the none rule are the X7 values. Nothing is fit on held-out-6. `prereg2_analysis.load` (imported by the analysis) aborts if a run's explicit temperatures differ from these.

## 3. Frozen artifacts

| Item | Path | sha256 |
|---|---|---|
| X5 350M LoRA (A, B, C) | `training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf` | `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba` |
| F 1.2B LoRA (D-oneshot, D) | `training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf` | `59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269` |
| Kev-FT 0.8B Q4_K_M (B, C, D-oneshot, D) | `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf` | `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23` |
| Held-out-6 | `blind/heldout6/heldout6-eval.json` (rig `set: file:`; no `blind_ok` key exists for `file:` sets) | `85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775` |
| Rig | `rig/`: `FROZEN.sha256` `4c7f41e3…` and every `src` file as in prereg-2, **except `rig/src/exclude.py`**: `9059152e…` -> `258bfce9…` (adds the `<file>:*` spec, §4; the named-row path is unchanged; the prereg-2 version is kept as `x7-fusion/prereg3-exclusion/exclude-prereg2.py.txt`). Prereg-2's `verify` line for exclude.py no longer matches; prereg-2 is complete | see `verify` in §13 |
| Evaluator | `rig/src/evaluate.py` | `69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50` |
| Analysis | `x7-fusion/code/prereg3_analysis.py` (new; imports `prereg2_analysis.py` `a36ce55b…`, which imports `evaluate.decide`) | `8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503` |
| Training-utterance builder | `x7-fusion/code/prereg3_train_utterances.py` (training files only; asserts both source shas) | `c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334` |
| X5 / F training utterances | `x7-fusion/prereg3-exclusion/train-utterances-round11.jsonl` (7,808 rows from 13,547 sequences) | `e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd` |
| Kev-FT training utterances | `x7-fusion/prereg3-exclusion/train-utterances-kevft.jsonl` (4,382 rows) | `e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e` |
| X5 / F training data | `training/artifacts/round11-para/merged/split/train-split.jsonl` (both `train-stats.json`: 13,547 rows) | `1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d` |
| Kev-FT training data | `x4-kev/finetune/data/train.jsonl` | `ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65` |
| Round 10 exclusion source | `training/artifacts/round10/final/rows-kept.jsonl` | `550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c` |
| dedup | `training/py/dedup.py` | `09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e` |
| Runtime | native `~/.cache/bai-training/llama.cpp/build/bin/llama-server`, llama.cpp `46ca246`, Metal; LoRA server `-c 4096 -np 1 --no-jinja --no-webui`, Kev server `-c 8192` | |

`prereg3_train_utterances.py` extracts, per training id, the single `Request: …<|im_end|>` of each Round 11 prompt and Kev-FT's `state` minus `Request: `. It is deterministic (two builds gave identical shas); 4,380 of the Round 11 ids and 4,381 of the Kev-FT ids are Round 10 rows whose extracted utterance equals `rows-kept.jsonl` verbatim.

## 4. Exclusion

**Rule, applied by the rig at run start, before any producer** (`rig/src/exclude.py`, ids and scores only): an item is removed from every arm if `dedup.leak_hit(dedup.normalize(<training utterance>), [<item>])` hits (char or word trigram Jaccard >= 0.5, or a 3+-word item utterance contained in the row, or equality) for any of:

1. prereg-2's spec, unchanged: Round 10 row `gen-observation--IMPLEMENT_OBSERVATION-1-3` (`rows-kept.jsonl`);
2. **every** training row of X5 and F: `train-utterances-round11.jsonl:*`;
3. **every** training row of Kev-FT: `train-utterances-kevft.jsonl:*`.

Rows of (2) and (3) are screened first with one `leak_hit` call against all items and only the rows that hit get per-item calls, which gives the same hits as testing every pair (checked on dev and on prereg-2's `excl-test` fake rows: kn3-16 at 1.0, 1.0, 1.0, 0.831, as the per-row path). Logged: item id, score and training row id (`excluded.json`, `results.*`, `manifest.json`, `logs/rig.log`); never an utterance.

**Expected count: 0** (`expect_excluded: 0`), from the training logs in §0: the Round 11 rows X5 and F trained on were filtered against held-out-6 at this threshold; Kev-FT's rows are 4,381 Round 10 rows that the `mirror` step screened against held-out-6, plus one row (`gen-knowledge-note--UPDATE_LINK_TYPE-4-0`) outside `rows-kept.jsonl` that was never screened. Two rows can still produce a hit: that unscreened row, and `IMPLEMENT_OBSERVATION-1-3`, whose held-out-6 status the `mirror` log masks (`leak_source` stops at the first set that hits, and it hit held-out-5). Held-out-6 has 26 terse items, and containment makes short utterances easy to hit. Any other count is logged by the rig as a `DEVIATION`; all hits stay excluded; the ids go into Part A.

**Both views are reported.** Primary = with the exclusion. Secondary = the full set, from the `*-full` blocks without exclusion, run unconditionally (they also give the determinism check). §8 and §9 use the primary view only.

## 5. Procedure (one run, no re-tuning)

1. **Integrity.** `rig.sh --prereg x7-fusion/PREREGISTRATION-3.md --prereg-run <name>` checks this file against its sidecar, then every sha in the block (GGUFs, held-out-6, every `verify` file) before anything runs.
2. **Parity on dev (done at freeze time; repeat before held-out-6 only if any verified file changed, which voids this file anyway).** Run `x5-kevft-dev`, `f-kevft-dev`, `x5-kevft-dev-excl`, `f-kevft-dev-excl`, then:
   `python3 x7-fusion/code/prereg3_analysis.py --x5 x7-fusion/prereg3-dev/x5-kevft-dev --f x7-fusion/prereg3-dev/f-kevft-dev --parity-x5 x7-fusion/prereg2-dev-freeze/x5-kevft-dev --parity-f x7-fusion/prereg2-dev-freeze/f-kevft-dev --out x7-fusion/prereg3-dev/analysis-dev`
   `python3 x7-fusion/code/prereg3_analysis.py --x5 x7-fusion/prereg3-dev/x5-kevft-dev-excl --f x7-fusion/prereg3-dev/f-kevft-dev-excl --parity-x5 x7-fusion/prereg2-dev-freeze/x5-kevft-dev --parity-f x7-fusion/prereg2-dev-freeze/f-kevft-dev --out x7-fusion/prereg3-dev/analysis-dev-excl`
   Both must print `PARITY OK` (exit 0): rows equal the prereg-2 freeze rows on every shared id (options, picks, args and gold identical, |delta trie| <= 0.05 nat, Kev |delta| = 0); the ids only in the stored run are exactly the fresh run's excluded ids (none, then `none3-02`); every metric of every arm and split, the hypotheses and the decision equal the stored rows' on the same items; and §10's dev numbers come out. A failure stops the run before held-out-6.
3. **Held-out-6, primary:** `x5-kevft`, then `f-kevft`.
4. **Held-out-6, full set:** `x5-kevft-full`, then `f-kevft-full`.
5. **Date fallback (§7):** only if step 3 aborts with `x9 needs a per-item today`, run the four `*-x6` blocks instead of steps 3-4.
6. **Analyse once:**
   `python3 x7-fusion/code/prereg3_analysis.py --x5 heldout6-run/x5-kevft --f heldout6-run/f-kevft --x5-full heldout6-run/x5-kevft-full --f-full heldout6-run/f-kevft-full --out heldout6-run/analysis`
   (the `-x6` dirs under the fallback). It aborts if a within-run total differs from the rig's `results.json` explicit block, if the two runs differ in items or labels, or if temperatures differ from §2. Report every number it prints, the determinism check (excluded vs full rows agree on every shared row), and each run's `results.md`.

Crashes, retries and missing items are logged, never silently fixed. Resuming an interrupted block with the same `out` (the rig skips completed rows; producers are deterministic) is allowed and logged. Multi-action items are excluded from every metric (held-out-6 has 0 per its README).

## 6. Metrics and scoring (as prereg-2 §6)

- **Args: x9 NORMALISED is primary, x9 STRICT secondary.** STRICT = `scoreArgRow`, ok = `exact !== false && refExact !== false`. NORMALISED = the same after trimming, collapsing whitespace and stripping one trailing `[.!?,;:]` run in the string leaves of predicted and gold `args`.
- **Op one-shot** = dispatched op == gold, over single-action items (no ask). Wilson 95% CI on every op proportion.
- **Fully-correct** (A, B, D-oneshot) = [dispatched op == gold] and args-ok(gold op), over action items with step-2 labels (`nArgs`).
- **Gated (C, D):** effective fully-correct (optimistic simulated user: picks gold when offered, else "none of these", which is neither correct nor wrong), over `nArgs`, with a Wilson 95% CI; gold-in-choices over action items (asked: gold in the offered 3; not asked: dispatch == gold); ask over action + no-action items; wrong dispatches = final op != gold on action items + any dispatch on a no-action item, and the wrong-dispatch rate over action + no-action items with a Wilson 95% CI.
- **No-action:** true positives and predicted-none per arm.
- **Splits** by the set's labels: `style` (plain / messy; style subsets include that style's no-action items), `difficulty` (easy / medium / hard, action items only) and style x difficulty. Small cells are reported, not tested.

## 7. Evaluation date for relative dates (as prereg-2 §7)

**Rule:** `today` = the set's `conventions.today` (first 10 characters), as `rig/src/items.py` reads it; the value is printed in the items summary line of `logs/rig.log` and goes into Part A. **Fallback, decided now:** if the set has no `conventions.today`, `step2.ts` aborts at x9 by design after step 1; then run the four `*-x6` blocks (`args: x6`: x9 without `today`, `currentLists` and `STATE_CHOICES`). No date is supplied by hand; the README's date sentence (§0) is not used. Step 1 and Kev are deterministic, so op decisions, the gate, P1, P2 and the gate bars are unchanged by the fallback; fully-correct and effective fully-correct move to the x6 level and are labelled "x6 (no date pinning)", and §9 is then applied to x6 effective NORM. Taking the fallback is not a deviation; the aborted x9 runs are kept and logged.

## 8. Hypotheses (primary view)

**Primary (revised before any held-out-6 run, §0.6):**

- **P1: B (C one-shot) op one-shot >= 90%.** PASS iff op >= 0.90 x n, n = the scored action items of the primary view (computed exactly as 10 x op >= 9 x n; n = 200 if nothing is excluded, so >= 180/200). Reported with its Wilson 95% CI, and whether the Wilson lower bound is >= 90%.
- **P2: D-oneshot op one-shot >= 90%.** The same criterion.
- No multiplicity correction applies to the pass decision: each is a point-estimate bar.
- **Secondary, reported only:** one-sided exact binomial test of H0 pi = 0.90 against pi > 0.90, p = P(X >= x | n, 0.90), with Holm step-down over P1 and P2 at family alpha 0.05 (smaller p vs 0.025; only if rejected, the larger vs 0.05; equal p: P1 first). It does not decide pass / fail.

**Gate bars (as prereg-2 H4), for C and for D separately:** gold-in-choices >= 92% of action items and ask <= 30% of action + no-action items, both required, judged on the point estimates. Also: effective fully-correct NORM (and STRICT) with Wilson 95% CI, wrong dispatches and the wrong-dispatch rate with Wilson 95% CI.

**D vs C (descriptive):** op, fully NORM / STRICT, gold-in-choices, ask, wrong, effective NORM / STRICT, no-action TP; paired fixed / broken with exact McNemar, two-sided, on op and on effective NORM (`evaluate.mcnemar`, via `prereg2_analysis.paired`). The effective-NORM McNemar enters §9; no other decision is attached.

**Reference:** A's numbers in every table; B vs A and D-oneshot vs A paired on op (descriptive). All splits by style, difficulty and style x difficulty for every arm (descriptive).

## 9. Shipping decision rule (pre-committed)

On the primary view (x9 NORMALISED; x6 under the date fallback), with `nArgs` = action items with step-2 labels and nothing rounded:

- delta = 100 x (effective fully-correct NORM of D - that of C) / nArgs, in percentage points;
- p = two-sided exact McNemar on the paired per-item effective fully-correct NORM, D vs C, alpha 0.05.

**Ship D iff delta >= 3.0 and p < 0.05. Otherwise ship C** (delta < 3, which includes D below C, or the McNemar not significant). `prereg3_analysis.py` prints the decision (`decision.ship`) with delta, fixed / broken and p.

- The rule is applied whatever P1, P2 and the gate bars show. Their outcomes are reported with the shipped configuration; a failure is reported as a failure. There is no re-selection, no retuning and no further held-out set.
- **Size / latency note, stated with the decision:** D is 731 + 530 MB on device against C's 229 + 530 MB (F is 3.2x X5), and F's native latency is ~1.9x X5's on step 1 and ~2.1x on step 2 (`rig/validation/latency-b2b2-{f,x5}`; Kev-FT's cost is shared). Shipping D means accepting that cost for at least a 3-point, significant effective gain.

## 10. Expected numbers

**Dev, stored rows** (`x7-fusion/prereg2-dev-freeze/`, re-evaluated at §2 by `prereg3_analysis.py`; 196 action + 20 no-action; in-sample for the temperatures). These are the parity targets of blocks `*-dev` (§5 step 2):

| Dev (216) | A: X5 | B | C | D-oneshot | D |
|---|---|---|---|---|---|
| Op one-shot | 175 (89.3%) | 183 (93.4%, 89.0-96.1) | 183 | 182 (92.9%, 88.4-95.7) | 182 |
| Fully x9 NORM / STRICT | 159 / 159 | 165 / 165 | eff 170 / 170 (86.7%, 81.3-90.8) | 163 / 163 | eff 169 / 169 (86.2%, 80.7-90.4) |
| Gold-in-choices | 175 | 183 | 189 (96.4%) | 182 | 190 (96.9%) |
| Ask /216 | 0 | 0 | 29 (13.4%) | 0 | 24 (11.1%) |
| Wrong dispatches /216 | 29 | 21 | 11 (5.1%) | 20 | 10 (4.6%) |
| No-action TP /20 | 12 | 12 | 12 | 14 | 14 |

Dev P1 183/196 and P2 182/196 both PASS (point >= 90%; Wilson lower bounds 89.0% and 88.4%); secondary binomial p 0.067 / 0.109, neither rejected under Holm; both bars met for C and D; D vs C op +2/-3, effective NORM +4/-5 (p 1.0), delta -0.51 points -> C. B vs A op +10/-2.

**Dev with the held-out-6 exclusion** (blocks `*-dev-excl`): `none3-02` is excluded (a no-action item every arm dispatched on), leaving 196 + 19. Op, fully-correct, gold-in-choices, effective and ask counts are unchanged; ask denominators become 215; wrong dispatches A 28, B 20, C 10, D-oneshot 19, D 9; no-action TP unchanged.

**Held-out-5 run 2** (primary view, 164 + 15; reference, not a target): B 146 (89.0%), D-oneshot 152 (92.7%); C gio 162 / ask 34 / wrong 3 / eff NORM 142; D gio 163 / ask 31 / wrong 2 / eff NORM 151.

**Held-out-6 expectations.** Held-out-6 is 65% messy with 59 hard items, all messy (held-out-5: 60% messy, 62 hard), over four new domains, so op should land near held-out-5's, not dev's. With n = 200 action items (0 excluded), P1/P2 pass at **x >= 180 (90.0%)**. If B's true rate is held-out-5's 89%, P1 passes with probability ~38%; at D-oneshot's held-out-5 rate (92.7%) P2 passes with ~94%; at the dev rates (93.4%, 92.9%) ~98% and ~95%. P1 is therefore close to a coin flip on held-out-5's evidence. The secondary binomial test needs x >= 189 (94.5%) for the 0.025 Holm slot and x >= 188 for 0.05, and is expected to reject for neither. The gate bars are expected to hold (held-out-5: gio ~99%, ask ~18%; the messy share pushes ask up). For §9, held-out-5 gave delta +5.5 with p 0.0117 (D) and dev gave -0.5 (C): the decision is open.

## 11. Known risks, stated in advance

- **Temperatures fit on dev**; Kev-FT's T_K 4.0 is more overconfident on human wording than its in-distribution 2.70; held-out-6 is messier than dev.
- **Leak asymmetry:** X5's and F's training data were filtered against held-out-6 by construction; Kev-FT's only through the Round 10 `mirror` screen, except the two rows named in §4. Both exclusions are applied.
- **The containment rule** can remove short (terse) items that merely occur inside a longer training request; if that happens the count is a `DEVIATION`, the items stay excluded, and the full-set view shows their effect.
- **Rig change:** `exclude.py` gained `<file>:*`; the dev blocks show that the named-row path and every other producer reproduce prereg-2's stored rows.
- **Optimistic simulated user** for all gated metrics; **one shot**: a single run per block, n = 200 (Wilson half-width ~3.5-4.5 points near 90%).
- **Date fallback** (§7) would lower fully-correct on date items for every arm alike.
- **Prior knowledge:** the README (§0.3) and held-out-5 run 2 (§0.4) were seen before this file was written.

## 12. Exploratory (logged, not used for any decision)

The rig's `frozen` (1.80/1.00) block; Kev-FT alone and F alone (in each `results.md`); the full-set view's hypotheses and decision; per-style ask; branch-only trie scores.

## 13. Machine-readable run blocks (`rig.sh --prereg x7-fusion/PREREGISTRATION-3.md --prereg-run <name>`)

Relative paths resolve against `x7-fusion/`, then the repo, then `exp/`; `out` against `x7-fusion/`. Every block verifies the same rig, analysis, exclusion and training files.

### Parity on dev (§5 step 2): prereg-2 exclusion only, must reproduce prereg-2's stored rows exactly

```rig-run x5-kevft-dev
# dev parity for arms A, B, C (prereg-2 exclusion only)
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
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: prereg3-dev/x5-kevft-dev
```

```rig-run f-kevft-dev
# dev parity for arms D-oneshot, D (prereg-2 exclusion only)
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
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: prereg3-dev/f-kevft-dev
```

### Parity on dev with the full held-out-6 exclusion (§5 step 2): expected to exclude none3-02 only

```rig-run x5-kevft-dev-excl
# dev, arms A, B, C, with the held-out-6 exclusion specs
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
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: prereg3-dev/x5-kevft-dev-excl
```

```rig-run f-kevft-dev-excl
# dev, arms D-oneshot, D, with the held-out-6 exclusion specs
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
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 1
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: prereg3-dev/f-kevft-dev-excl
```

### Held-out-6, primary view: with the exclusion (§5 step 3)

```rig-run x5-kevft
# held-out-6 primary, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x9
temps: explicit
t_lora: 1.63
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/x5-kevft
```

```rig-run f-kevft
# held-out-6 primary, arms D-oneshot, D
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x9
temps: explicit
t_lora: 2.08
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/f-kevft
```

### Held-out-6, secondary view: full set, no exclusion (§5 step 4)

```rig-run x5-kevft-full
# held-out-6 full set, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x9
temps: explicit
t_lora: 1.63
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/x5-kevft-full
```

```rig-run f-kevft-full
# held-out-6 full set, arms D-oneshot, D
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x9
temps: explicit
t_lora: 2.08
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/f-kevft-full
```

### Date fallback, only if the x9 blocks abort for lack of `conventions.today` (§7)

```rig-run x5-kevft-x6
# date fallback, primary, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x6
temps: explicit
t_lora: 1.63
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/x5-kevft-x6
```

```rig-run f-kevft-x6
# date fallback, primary, arms D-oneshot, D
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x6
temps: explicit
t_lora: 2.08
t_kev: 4.0
exclude_match: training/artifacts/round10/final/rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3
exclude_match: prereg3-exclusion/train-utterances-round11.jsonl:*
exclude_match: prereg3-exclusion/train-utterances-kevft.jsonl:*
expect_excluded: 0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/f-kevft-x6
```

```rig-run x5-kevft-full-x6
# date fallback, full set, arms A, B, C
lora: training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf
lora_sha256: 062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x6
temps: explicit
t_lora: 1.63
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/x5-kevft-full-x6
```

```rig-run f-kevft-full-x6
# date fallback, full set, arms D-oneshot, D
lora: training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf
lora_sha256: 59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269
kev: training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf
kev_sha256: 30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23
set: file:blind/heldout6/heldout6-eval.json
set_sha256: 85942addfde08276655d337dac05760d643d764c7bff8a399b5b3da35048f775
args: x6
temps: explicit
t_lora: 2.08
t_kev: 4.0
rev: 5e9c39046dcd8f08951a308e66c610dbd4c55c73
verify: 69223b6a76bc18b38a703f7544b1ca710010341dc8e523f946a4f1cf3abd3c50 rig/src/evaluate.py
verify: 258bfce917beff9f199c649676a678d8a0cd10b2031bc8f562bf8be4fac6241d rig/src/exclude.py
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
verify: 8be69b8cfc51a4bcae83405772e6bc56c902a5b9e19afd64468ba61881397503 code/prereg3_analysis.py
verify: c85a6de359e151d7418b161335aa42a1622e334d2229be216709c55545aba334 code/prereg3_train_utterances.py
verify: 09fa995a3532b21a2375a8db1767e5ed643d05b67b9391c613d405c75a3fee6e training/py/dedup.py
verify: 550eea7a2aac99f301c7a735a4e101ad6e00370c84066c471424429e4c2f877c training/artifacts/round10/final/rows-kept.jsonl
verify: e7c1b5cc5e4905590f3168e108e5ee99723cd9fa9557698d0fab423c5f9df2fd prereg3-exclusion/train-utterances-round11.jsonl
verify: e50876e56c2ec43d823cace77ae4a7f6341be2315d30ffa10e8f6c65b77df75e prereg3-exclusion/train-utterances-kevft.jsonl
verify: 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d training/artifacts/round11-para/merged/split/train-split.jsonl
verify: ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65 x4-kev/finetune/data/train.jsonl
out: ../heldout6-run/f-kevft-full-x6
```
