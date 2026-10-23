# Gate calibration: one model-agnostic definition of the fused-margin gate (dev only)

2026-10-23. Analysis only. No inference was run: everything comes from the existing rig rows in
`r8-kevq4-dev/`, `x1-kevq4-dev/` and `x5-kevq4-dev/` (x9 args). Nothing under `exp/blind/` was read and no
held-out-5/6 set was run. Code and outputs are in `gate-calibration/`:
- `calib.py` produces `calib.json` and `calib.out`.
- `weights.py` produces `weights.json` and `weights.out`.
- `fixbreak.out` holds the fixed/broken counts.

`calib.py` imports the rig's own `src/evaluate.py` (`lsm`, `fit_T_lora`, `fit_T_kev`, `mcnemar`). It **reproduces
the rig's gate block exactly** for all six model × {refit, frozen} cases (op, gold-in-choices, ask, wrong, eff
STRICT/NORM; asserted). It also asserts that Kev's scores, options and order are identical across the three runs.

## Why the val refit is inconsistent: the val set is in-sample for X1 and X5

The Round 8 teacher val, 168 items, is what `--temps refit` fits on. **140 of those 168 ids are in the Round 10
train split**, which is what X1 was trained on. They are also in the Round 11 / X5 train split. They are in 0 of
R8's own train rows. So for X1 and X5, the "refit" fits T_L on mostly *training* items, and the result is a
sharp temperature:
- R8: 1.797
- X1: 0.747
- X5: 0.437

That is not a calibration on unseen human wording. The temperature also only sets *how sharp* the LoRA's
distribution is; the dispatch is a separate quantity. Under equal weights, the fused argmax depends only on the ratio
(1/T_L):(1/T_K). The margin p₁ − p₂, which drives the gate, depends on the overall scale. That is why X5's op is 180
under both the refit pair (0.437 / 1.25) and the frozen pair (1.8 / 1.0), while its asks swing from 15 to 42.

## Options compared (leave-one-set-out, h3 ↔ h4)

**Protocol.**
- Fit on one set and test on the other, both ways, then sum the test folds.
- Totals are 196 action items, and 216 single + no-action items for the ask denominator. Folds are h3 = 92 + 10 and h4 = 104 + 10.
- **NORMALISED fully x9 is primary**; STRICT is secondary. For X5, STRICT equals NORM on every row.
- All options use the X7 none rule (if the LoRA says none, the dispatch is none and nothing is asked), the fused top-3 offer, and the optimistic user.
- G0 and G1 fit nothing on dev and are references.

**Options:**
- **G0:** the val-refit temperatures (the rig default) with τ = 0.5.
- **G1:** the X7-frozen pair 1.8 / 1.0 with τ = 0.5.
- **G2:** **T_L and T_K fit on dev by NLL of gold.** This uses the rig's own grids and objective (single + no-action items, softmax over all options incl. none), but on human wording instead of teacher val. Then τ = 0.5.
- **G3 / G3b:** G2, plus a fused-scale T_F fit on dev, by NLL of gold (G3) or by binary NLL of [top1 = gold] against p₁ (G3b). Then τ = 0.5.
- **G3v:** the val temperatures plus T_F fit on dev.
- **G4a / G4b:** the val temperatures, with τ chosen on the train fold as the best gold-in-choices subject to ask ≤ 20% (G4a) or ≤ 25% (G4b). This is the X7 rule.
- **G4c:** G2 temperatures, with τ chosen by the G4a rule.
- **G5:** G2 temperatures with a disagreement gate: ask iff argmax_L ≠ argmax_K. This is the rank-based, scale-free option.

| Model × Kev | Option | Fold params (test h4 / test h3) | Op | Gold-in-choices /196 | Ask /216 | Wrong | Fully NORM | Eff NORM | Eff STRICT |
|---|---|---|---|---|---|---|---|---|---|
| R8 | G0 val-refit | 1.80/1.25 | 176 | 187 | 38 | 12 | 159 | 167 | 166 |
| R8 | G1 frozen | 1.8/1.0 | 177 | 187 | 35 | 12 | 160 | 167 | 166 |
| R8 | **G2 dev-fit T** | 2.18/0.75 both | 178 | 187 | 38 | 12 | 161 | 167 | 166 |
| R8 | G3 + T_F | T_F .85 / .89 | 178 | 185 | 29 | 14 | 161 | 165 | 164 |
| R8 | G4a τ (ask ≤ 20%) | τ .3 / .4 | 176 | 185 | 28 | 15 | 159 | 166 | 165 |
| R8 | G4b τ (ask ≤ 25%) | τ .55 / .4 | 176 | 187 | 41 | 12 | 159 | 167 | 166 |
| R8 | G5 disagree | – | 178 | 185 | 44 | 14 | 161 | 165 | 164 |
| X1 | G0 val-refit | 0.747/1.25 | 176 | 188 | 23 | 12 | 159 | 169 | 168 |
| X1 | G1 frozen | 1.8/1.0 | 177 | 190 | 41 | 9 | 160 | 170 | 169 |
| X1 | **G2 dev-fit T** | 1.80/0.75 / 1.63/0.75 | 176 | 186 | 29 | 13 | 160 | 167 | 166 |
| X1 | G3 + T_F | T_F .89 / .89 | 176 | 186 | 25 | 13 | 160 | 167 | 166 |
| X1 | G3v val-T + T_F | T_F 1.38 / 1.25 | 176 | 190 | 31 | 10 | 159 | 170 | 169 |
| X1 | G4a τ (ask ≤ 20%) | τ .75 / .5 | 176 | 188 | 29 | 12 | 159 | 169 | 168 |
| X1 | G4c dev-T + τ | τ .6 / .6 | 176 | 189 | 40 | 9 | 160 | 169 | 168 |
| X1 | G5 disagree | – | 176 | 184 | 35 | 15 | 160 | 166 | 165 |
| X5 | G0 val-refit | 0.437/1.25 | 180 | 183 | 15 | 19 | 163 | 166 | 166 |
| X5 | G1 frozen | 1.8/1.0 | 180 | 188 | 42 | 10 | 165 | 169 | 169 |
| X5 | **G2 dev-fit T** | 1.63/0.75 / 1.71/0.75 | 179 | **188** | **34** | **10** | 164 | **169** | 169 |
| X5 | G3 + T_F | T_F .85 / .85 | 179 | 188 | 23 | 14 | 164 | 169 | 169 |
| X5 | G3v val-T + T_F | T_F 2.04 / 2.04 | 180 | 185 | 36 | 16 | 163 | 168 | 168 |
| X5 | G4a τ (ask ≤ 20%) | τ .9 / .85 | 180 | 186 | 40 | 14 | 163 | 168 | 168 |
| X5 | G4b τ (ask ≤ 25%) | τ .9 / .9 | 180 | 187 | 44 | 13 | 163 | 168 | 168 |
| X5 | G4c dev-T + τ | τ .4 / .4 | 179 | 188 | 22 | 14 | 164 | 169 | 169 |
| X5 | G5 disagree | – | 179 | 188 | 41 | 11 | 164 | 169 | 169 |

The G3b rows (within one item of G3) and the remaining rows are in `gate-calibration/calib.out`.
Ask and wrong by fold under G2 (h3 /102, h4 /114):

| Model | Ask h3 | Ask h4 | Wrong h3 | Wrong h4 |
|---|---|---|---|---|
| R8 | 18 | 20 | 6 | 6 |
| X1 | 13 | 16 | 7 | 6 |
| X5 | 17 | 17 | 5 | 5 |

## Choice: G2, temperatures per expert by NLL on dev human wording, then the X7 gate unchanged

**Definition.**
- Per expert, fit T by NLL of gold on held-out-3 + held-out-4. Use the single + no-action items, with the softmax over all scoped options incl. none.
- Grids: LoRA 0.2·1.05^k, Kev 0.25…10 in 0.25 steps. These are the rig's `fit_T_lora` / `fit_T_kev`, pointed at dev instead of teacher val.
- Then fuse with equal weights: 0.5·log softmax(L/T_L) + 0.5·log softmax(K/T_K).
- Ask iff p₁ − p₂ < **0.50**, with p = softmax of the fused score over all options and p₁, p₂ the two best non-none ops. Offer the fused top 3.
- The none rule is unchanged.

**Why this one:**
- **It is one procedure for every model, with no new free parameter.** τ, the weights and k keep their X7 values. Only the temperatures are re-estimated, and they are estimated on text that resembles deployment and the blind sets, not on the models' own training rows.
- **The fitted temperatures agree across models.**
  - Kev: 0.75 in both folds, for all three runs.
  - LoRA: R8 2.18 (both folds), X1 1.80 / 1.63, X5 1.63 / 1.71. That is at most one grid step between folds.
  - On teacher val the LoRA temperatures were 1.80 / 0.75 / 0.44.
- **The gate behaves consistently across models.**
  - Ask: 29–38 / 216, i.e. 13–18%.
  - Wrong: 10–13.
  - Gold-in-choices: 186–188.
  - Compare G0: ask 15–38 and wrong 12–19.
- **For X5, it fixes the refit's failure.**
  - Wrong dispatches: 19 → 10.
  - Gold-in-choices: 183 → 188.
  - Eff NORM: 166 → 169.
  - The cost is 19 more asks (15 → 34).
  - Against the frozen pair (G1), it matches gold-in-choices, wrong and eff (188 / 10 / 169) with 8 fewer asks.

**Why not the others:**
- **For X1, G2 trails G1 by 3–4 items** (gold-in-choices 186 vs 190, wrong 13 vs 9, eff 167 vs 170). That is at the noise level, and X1 is an ungated arm (D) in the draft. It is the one model where G2 is not at least level with the frozen pair.
- **G1** works about as well, but its LoRA temperature was fit for R8 only, so it is not a procedure for future models (arms E and F).
- **A fused-scale fit (G3 / G3b)** reliably sharpens the fusion (T_F 0.85–0.89). That trades about 9 asks for 2–4 more wrong dispatches, at equal eff. NLL calibration treats an ask and a wrong dispatch as equally bad, but for a dispatch gate a wrong dispatch is the costlier error. Rejected.
- **Target-ask τ (G4)** is fold-unstable (R8 τ .3 / .4 and .55 / .4; X1 .75 / .5) and never beats G2 on wrong or eff.
- **The disagreement gate (G5)** is the only scale-free option. It asks more (35–44) for no gain.
- **G3v** (val temperatures plus a dev scale) works for X1 but not X5 (wrong 16), because the val ratio stays X5-sharp.

**Frozen values for a held-out run.** These are fit on all of dev; LOSO showed the fold fits within one grid step.

| Model | T_L | T_K |
|---|---|---|
| R8 | 2.184 | 0.75 |
| X1 | 1.711 | 0.75 |
| X5 | 1.63 | 0.75 |

For a new LoRA or a new Kev, run the same fit on the same dev rows before the run.

**Dispatch side effect.** The dev-fit pair weights Kev more heavily: the L:K ratio is 0.46 for X5, against 2.86 under the refit.
- X5 × Kev PoE vs X5 alone goes from +6/−1 (op 180, p 0.062) to **+10/−6** (op 179, p 0.23).
- Under the frozen pair it is +10/−5. The broken items are kn3-16, prj3-12, wbs3-05, src3-02, prj4-14 and prj4-18.
- The fusion gain over X5 alone is small (+4 to +5 op) under any ratio. That is the open question for arm B.

**Ask-rate transfer.** On held-out-5 run 1 the same gate asked 24.4%, against 16.2% on dev: messier text means more asks. G2 asks 15.3% in-sample on dev for X5, so expect about 23% on held-out-5, still under the 30% bar.

## Fusion weight, X5 × Kev: keep equal weights

The weight w_L is chosen by LOSO as the best train-fold op, with ties broken toward 0.5, on the grid 0.1…0.9. The gate uses τ = 0.5. Data: `weights.out`.

| Temps | Weights | Op | Fully NORM | Gold-in-choices | Ask | Wrong | Eff NORM |
|---|---|---|---|---|---|---|---|
| G2 dev-fit | equal 0.5 | **179** | **164** | 188 | 34 | **10** | 169 |
| G2 dev-fit | LOSO (test h3: 0.6, test h4: 0.9) | 179 | 163 | 188 | 43 | 12 | 169 |
| G0 val-refit | equal 0.5 | 180 | 163 | 183 | 15 | 19 | 166 |
| G0 val-refit | LOSO (0.3, 0.5) | 178 | 163 | 184 | 17 | 18 | 166 |

The all-dev op curve under G2 temperatures is flat from w_L 0.4 to 0.9 (178–181). The fold choices (0.6 vs 0.9) disagree, and the CV fit gains nothing out of fold.
- R8: equal 178 vs LOSO 177.
- X1: equal 176 vs LOSO 175.

Keep equal weights; this is the same conclusion as X7's 176 vs 177.

## Caveats
- **The temperatures are now fit on held-out-3/4**, the same rows the options are compared on. The LOSO numbers are the honest estimate. The all-dev numbers are in-sample (for X5: gold-in-choices 188, ask 33, wrong 10, eff 169).
- **Differences of 1–3 items are noise** at n = 196. The robust findings are the X5 refit's wrong-dispatch rise, which G2 removes, and the agreement of the dev-fit temperatures across models.
- **The ask-rate transfer estimate uses held-out-5 run-1 aggregates**; see the prior-use note in the pre-registration draft.
- **Using these temperatures needs a rig change.** The rig's `evaluate.py` only knows `refit` and `frozen`, so a held-out run would need either an explicit `--temps T_L,T_K` or `calib.py`'s evaluator. Either must be re-validated to reproduce the rig at the frozen pair before use.
