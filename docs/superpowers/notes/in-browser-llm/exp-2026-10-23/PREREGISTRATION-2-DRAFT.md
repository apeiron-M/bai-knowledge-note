# DRAFT, NOT FROZEN: pre-registration 2, one consolidated held-out-5 run (run 2)

Status: **draft for review, 2026-10-23.**
- No sha256 has been taken. Freezing means filling every TBD, writing `PREREGISTRATION-2.md` and recording its sha256 in `PREREGISTRATION-2.sha256`, all before any held-out-5 producer runs.
- Nothing under `exp/blind/` was read to write this draft.
- The format follows `PREREGISTRATION.md` (X7 / run 1).
- The gate definition and its numbers come from `rig/validation/gate-calibration.md` (dev only).

## 0. Prior use of held-out-5 (stated before the run)

Held-out-5 file: `blind/heldout5/heldout5-eval.json`, sha256 `c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e`.
It holds 165 single-action, 15 no-action and 0 multi items.

1. **Run 1, 2026-10-23.** The X7 pre-registered C1 / C2 / C3 configurations (R8 LoRA × Kev-0.8B Q4, ship args) were run once on the full set, with no deviations. The report is `heldout5-run1/RESULTS.md`. Aggregates:
   - C1 op 135/165; C2 146/165 (+14/−3, p 0.0064).
   - C3: gold-in-choices 97.0%, ask 24.4%, wrong 6.
   - Fully NORM ship: C1 113, C2 120, C3 effective 130.

   Item-level outputs exist under `heldout5-run1/out/`.
2. **Round 11 / X5 data build.** `training/round11-para/para.py` read the held-out-5 utterances to *filter* training data: the source prefilter, the `leak` step and the prompt check. Blind hits were redacted to set + score.
   - It dropped 1 Round 10 source/train row and 1 paraphrase rewrite.
   - So X5's training data was filtered against held-out-5. R8's and X1's were not.
3. **This design was informed by run-1 aggregates.** The ask-rate transfer (dev 16.2% → held-out-5 24.4%) was used to judge that the gate's dev ask rate leaves headroom under the 30% bar. The gate's parameters were fit on dev only.
   - The drafting agent also saw run 1's per-category item-id lists, which contain ids only, with no utterances or gold. None was used.

**Consequence.** Run 2 is a second look at the same set.
- It is confirmatory for questions **not** chosen on held-out-5: A vs D, B vs A, and the new gate's ask/wrong trade-off.
- It is **not** a clean test of anything tuned after run 1.
- Held-out-6 stays untouched, as the final confirmation set.

## 1. Arms

Every arm uses: the **x9 args** (X9 shipped patch, `today` from the set's `conventions.today`, `currentLists`, `STATE_CHOICES`); step 2 on the **gold op** at temperature 0 with that arm's own LoRA; the X7 none rule (if the LoRA says `{"ops": []}`, the dispatch is none); and step 1 from the base tree. Fully-correct = [dispatched op == gold] ∧ args-ok(gold op). **NORMALISED is primary and STRICT secondary**, as recommended by X9.

| Arm | What | Op decision | Ask | Size on device |
|---|---|---|---|---|
| **A** | X5 alone: one 229 MB model | X5 native greedy R2c pick | never | 229 MB |
| **B** | X5 × Kev-0.8B Q4 | argmax over non-none ops of 0.5·log softmax(X5 exact / **1.63**) + 0.5·log softmax(Kev logprobsT1 / **0.75**) | never | 229 + 530 MB |
| **C** | B + gate | same as B | ask iff p₁ − p₂ < **0.50** (p = softmax of the fused score over all options incl. none; p₁, p₂ the two best non-none ops). Offer the fused top 3, ties broken in catalog order; "none of these" is allowed. | 229 + 530 MB |
| **D** | X1 1.2B alone | X1 native greedy R2c pick | never | 731 MB (Q4_K_M, 730,896,096 B) |
| **E** | <best LoRA> × fine-tuned Kev | **TBD.** Same form as B and C. T_L and T_K are fit by the §2 procedure on dev, then frozen. Gated (τ 0.50, top 3) and ungated are both reported. | TBD | TBD |
| **F** | 1.2B trained on the X5 data, alone | **TBD.** Native greedy R2c pick. | never | TBD |

**Shared calls.** A, B and C share one X5 step-1 pass, one Kev pass and one X5 step 2. D, E and F each need their own step 1 and step 2. E also needs its own Kev pass.

## 2. Gate and temperatures: frozen definition

From `gate-calibration.md`, option G2:
- **Temperature fit.** Per expert, choose T by NLL of gold on held-out-3 + held-out-4. Use the 196 action + 20 no-action items, with the softmax over all scoped options incl. none.
  - The grids are the rig's `fit_T_lora` (0.2·1.05^k ≤ 8) and `fit_T_kev` (0.25…10, step 0.25).
  - This is the rig's refit, pointed at dev instead of teacher val.
  - Why not teacher val: 140 of its 168 ids are in X1's and X5's training data.
- **Frozen values for this run:**
  - X5: T_L = **1.63**.
  - Kev-0.8B Q4: T_K = **0.75**.
  - For reference, not used in any arm: R8 2.184, X1 1.711.
  - LOSO fold fits were X5 1.63 / 1.71 and Kev 0.75 / 0.75.
- **Fixed parameters:** weights 0.5 / 0.5 (a CV fit gained nothing out of fold), τ = 0.50, k = 3, the none rule.
  - These are the X7 values; nothing new is fit except the two temperatures.
- **Arm E:** the same procedure on the same dev rows, with values recorded here before the run: T_L = TBD, T_K = TBD.

## 3. Frozen artifacts

| Item | Value |
|---|---|
| X5 LoRA | `training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf`, sha256 `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba` (229,312,224 B) |
| X1 LoRA | `training/artifacts/x1-1p2b/gguf/LFM2.5-1.2B-Instruct-vault-x1a-20261023-Q4_K_M.gguf`, sha256 `7dd843a08381aaa58ff8edf94cae443bff2ceddd3669c60e4045a803c8031bfc` |
| Kev | `exp/x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf`, sha256 `64f479de0a9ac921e2f5b941ff4549fff4b88588e0a31bf11462c552364746b1`, servedT 2.3510959148406982 from GGUF metadata |
| E: LoRA / fine-tuned Kev | TBD path + sha256 / TBD path + sha256 |
| F: 1.2B on X5 data | TBD path + sha256 |
| Rig | `exp/rig` at its current `FROZEN.sha256` (lib.ts `b48ff64f…`, decide.mjs `feed74fe…`, catalog `b257573b…`, x6 patch `8d29e48a…`, x9 patch `11737382…`, prereg_eval copy `f981613b…`). Repo rev `5e9c39046dcd`. llama.cpp `46ca246`, native Metal. LoRA server `-c 4096 -np 1 --no-jinja`; Kev server `-c 8192`. |
| Evaluator | **TBD.** `rig/src/evaluate.py` extended to take explicit temperatures (e.g. `--temps fixed:1.63,0.75`) and an exclusion list. It must (a) reproduce the current rig blocks at `frozen` and `refit` on the three dev runs, and (b) reproduce `gate-calibration/calib.py`'s G2 numbers for X5 below. Its sha256 goes here. |

**Planned commands (TBD until the rig flags exist):**

```bash
./rig.sh --lora <X5> --kev <Kev> --set heldout5 --blind-ok --args x9 --temps fixed:1.63,0.75 --exclude-leak --out <run2>/x5-kev   # A, B, C
./rig.sh --lora <X1> --set heldout5 --blind-ok --args x9 --exclude-leak --out <run2>/x1                                         # D
```

## 4. Leak exclusion: one held-out-5 item near-copies a Round 10 training row

**What the leak logs show** (`training/artifacts/round11-para/`):
- `sources.jsonl.summary.json`: `blindPrefilterDropped {"heldout5": 1}`.
- `merged/split/split.json`: `baseEvalLeakRows {"train:heldout5": 1}`, `baseTrainSequencesDropped 1`.
- The dropped row is **`gen-observation--IMPLEMENT_OBSERVATION-1-3`**, op `observation:IMPLEMENT_OBSERVATION`.
  - It is the only id in `round10/split/train-split.jsonl` that is missing from the merged train split.
  - Its source utterance is in `round10/final/rows-kept.jsonl`.
- Who trained on that row:
  - R8: Round 8 train, 2 sequences.
  - X1: Round 10 train.
  - **X5: not trained on it.**
  - Kev is zero-shot.
- `full/chain/rows-leak.jsonl.report.json` also rejected one rewrite as `eval-leak:heldout5` (score 1.0, contained): `para-gen-observation--IMPLEMENT_OBSERVATION-1-6-lowercase`.
  - Its source is `gen-observation--IMPLEMENT_OBSERVATION-1-6`, a Round 10 **val** row.
  - No model trained on either the rewrite or its source, so it is not a training leak.

**The held-out-5 item id is not in any log.** `para.py`'s `redacted()` records blind hits as set + score only, by design. It cannot be recovered without opening the blind file, which this draft does not do.

**Rule, applied mechanically at run start, before any producer runs:**
1. Load held-out-5 the way `dedup.load_eval` does.
2. For each held-out-5 item, compute `dedup.leak_hit(dedup.normalize(<utterance of gen-observation--IMPLEMENT_OBSERVATION-1-3>), [item])`. The threshold is 0.5 (char or word trigram Jaccard), or containment.
3. Exclude every item that hits, from **every** arm.
4. Write the id(s) into Part A of the results: **excluded id = TBD at run start**.
5. The expected count is 1. Probably a single-action item, given the op, but this is unverified. A count of 0 or more than 1 is logged as a deviation, and all hits are still excluded.
6. Also log, for information only, whether the `-1-6-lowercase` rewrite hits the same item.

The expected denominators are then 164 single-action + 15 no-action = 179. The full-set numbers are also reported, as exploratory.

## 5. Procedure (one run, no re-tuning)

1. **Integrity.** Check the sha256 of this file, of held-out-5 (= `c472bb…`) and of every artifact in §3. Apply the §4 exclusion.
2. **Parity.** Re-run 4 dev items per producer and match the stored dev rows (picks, args, |Δ trie| ≤ 0.05 nat, Kev |Δ| = 0).
3. **Producers.** Step 1 (pick + exact trie over every scoped op + none), Kev, and x9 step 2 on the gold op for every single-action item.
4. **Evaluate once** with the frozen evaluator and report every number it prints.

Crashes, retries and missing items are logged, never silently fixed. Multi-action items are excluded from every primary metric (held-out-5 has 0 of them).

**Split** by the set's own labels: `plain` / `messy`, and `difficulty`. Run 1 found that the evaluator's hard-coded natural/paraphrase split prints n = 0 on this set. The rig's `evaluate.py` splits by whatever `style` labels the set uses.

## 6. Metrics

- **Primary: fully-correct, x9 NORMALISED.**
  - For C, the primary figure is *effective* fully-correct: the optimistic simulated user picks gold when it is offered, otherwise "none of these", which is neither correct nor wrong.
  - The denominator is the single-action items.
- **Secondary:**
  - fully-correct, x9 STRICT;
  - one-shot op accuracy;
  - fixed/broken with a one-sided exact McNemar test.
- **Gated metrics, for C and gated E:**
  - gold-in-choices over single-action items;
  - ask over single-action + no-action items;
  - wrong dispatches, counting a dispatch on a no-action item as wrong.
- **No-action:** true positives and predicted-none, per arm.

## 7. Hypotheses and decision rules (DRAFT: to be agreed before freezing)

Comparisons are paired, per item, on the same items. A significance test is a one-sided exact McNemar on per-item [correct] unless stated otherwise.

- **H1 (primary): C > A on fully NORM**, i.e. C effective vs A one-shot. Confirmed iff fixed > broken and p < 0.05. This asks whether adding Kev plus the gate pays for the 530 MB.
- **H2: B > A on fully NORM** (and on op), with no ask. This measures the one-shot fusion gain over X5 alone.
- **H3: A vs D on fully NORM, two-sided.** This asks whether the 229 MB model matches the 1.2B model.
  - **Non-inferiority:** A ≥ D − 3 per 100 single-action items.
  - **Proposed margin, TBD:** 3 per 100.
- **H4: C gate bars.**
  - Gold-in-choices ≥ 92%.
  - Ask ≤ 30%.
  - Wrong dispatches ≤ ½ × A's.
  - Eff NORM − A fully NORM ≥ +5 per 100. This is proposed instead of X7's +8, because A is a much stronger baseline than R8 alone. **TBD.**
- **E, F (TBD):**
  - E is compared with C, using H1-style C-vs-E and the H4 bars.
  - F is compared with A and D, using the H3 form.
  - These are listed now; their numbers are added before freezing.
- **Multiplicity.** H1 is the only confirmatory test. H2–H4 and E/F are secondary, are reported without correction, and are labelled as such.
- **Shipping rule (draft).**
  - If H1 and H4 hold: recommend C for Flow 4.
  - If H1 fails: recommend A (one 229 MB model). The exception is H3 failing *against* A (D significantly better), in which case recommend D.
  - B is recommended only if H2 holds and it breaks ≤ ⅓ as many items as it fixes.

## 8. Expected numbers (dev, held-out-3 + held-out-4; 196 action / 216 single + none)

These use the frozen §2 parameters, which were fit on these same rows (in-sample). LOSO values are in brackets.

| Dev | A: X5 alone | B: X5 × Kev | C: B + gate | D: X1 alone |
|---|---|---|---|---|
| Op one-shot | 175 (89.3%) | 179 [179] | 179 | 173 (88.3%) |
| Fixed / broken vs A (op) | – | +10 / −6 (p 0.23) | same as B | +12 / −14 (vs A) |
| Fully x9 NORM (STRICT) | 159 (159) | 164 (164) [164] | eff **169** (169) [169] | 157 (156) |
| Fully NORM vs A | – | +8 / −3 (p 0.11) | +10 / −0 (p 0.001) | +11 / −13 (two-sided p 0.84) |
| Gold-in-choices | 175 | 179 | 188 (95.9%) [188] | 173 |
| Ask | 0 | 0 | 33/216 (15.3%) [34] | 0 |
| Wrong dispatches | 29 | 25 | 10 [10] | 28 |
| No-action TP / predicted none | 12/20, 13 | same as A | same as A | 15/20, 18 |
| Args on the gold op (NORM) | 175 | 175 | 175 | 174 |

**C by set and style** (in-sample):

| Split | Gold-in-choices | Ask | Wrong |
|---|---|---|---|
| h3 | 88/92 | 16/102 | 5 |
| h4 | 100/104 | 17/114 | 5 |
| Natural | 96/97 | – | – |
| Paraphrase | 92/99 | – | – |

C asks mostly on paraphrase items: 26 of the 33 asks.

**Expected shrinkage on held-out-5.**
- Run 1 lost about 2 pp of op relative to dev, raised the ask rate by about 1.5× (16.2% → 24.4%) and had weaker args (gold-op args 79% vs 84% on dev).
- So for C, expect ask ≈ 20–25% and gold-in-choices ≈ 93–97%.
- C − A is about +5 per 100, which sits at the H4 bar. At n ≈ 165, ±5 items is noise.

## 9. Known risks, stated in advance

- **The gate temperatures are fit on held-out-3/4**, the same rows that produced the §8 expectations. The LOSO sums match the in-sample numbers to within 1 item.
- **B vs A is weak on dev** (+10/−6 op). The dev-fit ratio weights Kev more heavily than the old teacher-val refit did (+6/−1 there).
- **Leak asymmetry.**
  - X5's data was filtered against held-out-5; X1's and R8's were not.
  - Only one Round 10 row is known to near-copy held-out-5, and it is excluded by §4.
  - One Round 8 row is outside the Round 10 pool, so it was never checked against held-out-5. It only matters for R8, which is not an arm.
- **Kev Q4 vs Q8.** Q4 is weaker alone on teacher text. That matters most for B and C on plain items.
- **The gated metrics use the optimistic simulated user.**
- **Held-out-5 is on its second use (§0).**

## 10. Exploratory (logged, not used for any decision)

- A, B and C on the full set, including the excluded item.
- B and C under the val-refit pair (0.437 / 1.25) and under the X7-frozen pair (1.8 / 1.0).
- X1 × Kev with T_L 1.711 / T_K 0.75.
- Branch-only trie scores.
- The disagreement gate.
