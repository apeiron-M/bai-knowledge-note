# X7: fusing the op deciders (LoRA R8, Kev-0.8B, gte head) into one decider + gate

2026-10-23. This is analysis only, apart from one small gap-fill: Kev-0.8B (Q4_K_M and Q8_0) run on the Round 8 teacher val (168 items). Nothing under `exp/blind/` was read. The repo is untouched and nothing was committed. Pre-registration: `PREREGISTRATION.md`, sha256 `eac4ad28e53e5aad1435b64236231f07d3d4bb5c6d7fb925a7275df58bf765d5` (also in `PREREGISTRATION.sha256`).

## Data, alignment, coverage

`code/build_items.py` → `out/items.jsonl` joins every source by (set, id). It asserts three things per item:
- the candidate order is identical across the LoRA, Kev and head (scoped ops in catalog order + none);
- the oracle args agree: `oracle-args.json` = X3 `argsOkIfGold` = X6 `base.json`;
- (the third check is the gap-fill parity below).

| Set | Single-action | No-action | Multi | LoRA (pick, exact, pGen) | head | Kev Q4/Q8 |
|---|---|---|---|---|---|---|
| held-out-3 | 92 | 10 | 6 | all | single + none | all |
| held-out-4 | 104 | 10 | 6 | all | single + none | all |
| R8 teacher val | 150 (107 with step 2) | 18 | – | all | all | **gap-filled here** |

**Why the gap-fill.** X4's Kev val was the *Round 10* val. Only 28 of its ids overlap the Round 8 val that the LoRA and head were scored on.

**Parity of the gap-fill.** Native llama-server @46ca246, the same `decide.mjs` W3/desc and servedT 2.351. On the 28 overlapping items it matches the stored rows exactly: same picks, max |Δ logprob| = 0.

Kev alone on R8 val:
- Q8: 80/150.
- Q4: 70/150.
- LoRA: 134/150.

**Experts.** The temperatures were fixed from data outside h3/h4:
- LoRA: softmax(exact_sum / 1.80), T fit on val by X3.
- Kev: logprobsT1, T = 1.0, refit on R10 val by X4.
- Head: LR Train-A, T = 2 from train OOF.

**No-action rule, everywhere.** If the LoRA says `{"ops": []}`, the dispatch is none. Otherwise only non-none ops compete. LoRA pick = native greedy, which differs from browser R2c on 1 item (pq4-06, where native is right).

**Args oracles.** Fully-correct = [op == gold] ∧ args-ok(gold op), from step 2 on the gold op:
- **baseline** (X6 `base`): h3 73, h4 84, dev **157**/196, val 95/107;
- **ship** (X6 `ship-v1`, the real patch re-run): 74, 91, **165**, 99.

The normalised scorer (trim, collapse whitespace, strip a trailing `[.!?,;:]` run on both sides) flips exactly 1 dev item, kn3-02, under both oracles.

## 1. One-shot op decider (Kev Q4; Q8 in `out/oneshot-q8.log`)

| Config | Dev op /196 (nat/para) | Fixed/broken vs LoRA | Fully base / ship | h3 / h4 | Val op /150 |
|---|---|---|---|---|---|
| LoRA native pick | 164 (92/72) | – | 136 / 143 | 79 / 85 | 134 |
| Kev alone | 160 (86/74) | +15/−19 | 134 / 141 | 75 / 85 | 86 |
| Head alone | 121 | +13/−56 | 104 / 106 | 62 / 59 | 118 |
| **PoE L+K, equal weights (no dev fit)** | **177 (95/82)** | **+14/−1** | **146 / 153** | 84 / 93 | 135 |
| PoE L+K+H, equal | 174 | +15/−5 | 145 / 153 | 83 / 91 | 141 |
| Fused L+K, weights fit by LOSO | 176 (h3→h4 w = .4/.6; h4→h3 .3/.7) | +15/−3 | 145 / 152 | – | – |
| Fused L+K+H, LOSO | 176 (head weight chosen 0 in both folds) | +15/−3 | 145 / 152 | – | – |
| Fused L+K, val → dev (w = .7/.3) | 174 | +11/−1 | 145 / 152 | – | – |
| Fused L+K+H, val → dev (picks L+H .5/.5) | 165 | +8/−7 | 141 / 146 | – | – |
| Fused L+H (head only), LOSO | 166 | +7/−5 | 140 / 146 | – | – |
| Rule: Kev and head agree against the LoRA | 174 | +11/−1 | 146 / 153 | – | 134 |
| Rule: Kev confident and disagrees, LOSO θ | 171 | +9/−2 | – | – | – |
| Rule: pGen < τ → fused, LOSO | 176 | +14/−2 | – | – | – |
| Fusion may override the LoRA's none, LOSO | 179 | +17/−2 | – | – | – |

- **The Kev + LoRA product is the gain.** It is +12 to +13 op under every protocol, robust to the weights (wK 0.3 to 0.7 gives 174–178) and to the LoRA temperature (T 1.0–3.0 gives 175–178).
  - The head adds nothing once Kev is in. Teacher-val fitting prefers the head, because Kev is weak on teacher-style text, and that choice transfers worse to dev.
  - Errors are complementary: 11 of the 14 dev fixes are paraphrase items (5 on h3, 6 on h4), and the one break is moc4-02.
- **Teacher val is flat:** PoE 135 vs 134 (+5/−4), with fully-correct 90 vs 92.
- **Overriding none** gains 2 dev items (ten3-03 and ten4-03, both DISSOLVE_TENSION) and costs 1 false none on val. It is not adopted.
- **Kev Q4 vs Q8 inside the fusion:** PoE 177 vs 178, LOSO 176 vs 178. They are equal within noise despite Q4 being 10–18 items weaker alone on teacher val.

## 2. Gates (ask rate over 216 dev single + none items; offered k = 3; τ by LOSO = best train gold-in-choices with ask ≤ 25%)

| Gate | Dev gold-in-choices | Ask | Eff fully base / ship (Δ per 100 vs LoRA) | Wrong dispatches |
|---|---|---|---|---|
| none (LoRA) | 164 (83.7%) | 0 | 136 / 143 | 39 |
| none (PoE dispatch) | 177 (90.3%) | 0 | 146 / 153 (+5.1) | 26 |
| LoRA ≠ Kev → ask; LoRA pick + Kev ranks | 182 (92.9%) | 44 (20.4%) | 150 / 157 (+7.1) | 14 |
| LoRA ≠ Kev → ask; LoRA pick + fused ranks | 186 (94.9%) | 44 (20.4%) | 151 / 159 (+7.7/+8.2) | 14 |
| pGen < τ (LOSO .8/.8); head alternatives (X2's best) | 179 (91.3%) | 37 (17.1%) | 149 / 156 (+6.6) | 19 |
| LoRA scored margin (LOSO .6/.3) | 181 (92.3%) | 42 (19.4%) | 150 / 157 (+7.1) | 20 |
| **Fused margin, PoE dispatch (LOSO .6/.4)** | **187 (95.4%)** | **35 (16.2%)** | **152 / 160 (+8.2 / +8.7)** | **11** |
| Fused margin, val → dev (τ .7) | 188 (95.9%) | 59 (27.3%) | 152 / 160 | 8 |
| pGen OR disagree, PoE (LOSO) | 185 (94.4%) | 47 (21.8%) | 150 / 158 | 14 |
| Always ask, fused top-3 (ceiling) | 189 (96.4%) | 201 (93%) | 152 / 160 | 2 |

- The fused-margin gate is the only one that clears all three Exp-1 bars under LOSO: ≥ 92%, ≤ 30%, and +8.
- In `gates.py` the offered list puts the disagreeing LoRA/Kev pick second. The pre-registered C3 offers the plain fused top-3, which gives the same 187 / 35 / 152 / 160 on dev, 12 wrong dispatches, and val gold-in-choices 142 instead of 140.
- By set, at τ = 0.5:
  - h3: gold-in-choices 88/92, ask 16/102;
  - h4: 99/104, ask 19/114;
  - natural 97/97, paraphrase 90/99.
- Q8 gives the same: 188, 41, 152/160.

**Top-3 coverage (dev /196):**

| Source | Top-3 | Top-1 |
|---|---|---|
| PoE L+K | **191** | 179 |
| LoRA scored | 188 | 166 |
| Kev | 187 | 162 |
| Head | 168 | 123 |

Curves for every gate and every τ are in `out/gates-q4.json`.

## 3. Oracle ceilings (dev, 196)

| | Baseline args | Ship args |
|---|---|---|
| Perfect op decider | 157 | 165 |
| LoRA one-shot | 136 | 143 |
| PoE one-shot | 146 | 153 |
| PoE + gate (optimistic) | 152 | 160 |
| Op-fix headroom (LoRA wrong, args OK) | 21 | 22 |
| Args headroom (LoRA right, args wrong) | 28 | 21 |
| Dead (both wrong) | 11 | 10 |

- **The op side is mostly harvested.** One-shot fusion closes 10 of 21 headroom items; the gate closes 16. What is left: 5 items, plus 7 where gold is not in the top 3.
- **The remaining loss is now args:** 21–28 items, against at most 5 more from op. The next gains are step 2 (X6 territory) and the context-dependent fields.
- Multi-action, 12 items: the expected-op set contains the LoRA's pick in 10, Kev's in 12, and the PoE pick (no head) in 9.

## 4. Pre-registered, frozen

Three configurations share the same model calls. Full detail in `PREREGISTRATION.md`.

| Config | What it is | Primary args |
|---|---|---|
| **C1** | LoRA one-shot (control) | baseline |
| **C2** | PoE: 0.5·LoRA(T 1.8) + 0.5·Kev-Q4(T 1.0), LoRA none rule | ship |
| **C3** | C2 + fused-margin gate τ = 0.50, fused top-3 | ship |

- **Expected dev numbers:**
  - op 164 / 177 / 177;
  - fully STRICT 136 (base) / 153 (ship) / eff 160;
  - C3 gold-in-choices 95.4%, ask 16.2%.
- **Hypotheses:** H1 is McNemar C2 > C1 on op, p < 0.05. H3 is the Exp-1 bars for C3.
- **Scorer:** STRICT is primary and NORMALISED secondary. Step 2 runs on the gold op under both baseline and ship for every item.
- **Frozen evaluator:** `code/prereg_eval.py`. It reproduces the dev and val numbers above from `out/prereg-input-*.jsonl`.

## Caveats

- **Selection on dev.** C2/C3 were chosen among about 15 families on h3/h4. C2 itself has no fitted parameter, but expect shrinkage.
- **Head contamination.** Train-A groups were seeded from the h3 confusion list. The head is not in any pre-registered configuration.
- **The gated numbers use the optimistic simulated user.**
- **The ship args gains are in-sample** (X6).
- **Small n:** 13–19 LoRA misses per set.
- **Latency is not measured here.** C2 needs the full trie scoring: X3 measured 41 ms native for branch-only and 327 ms for exact. Branch-only gives identical dev results. On top of that, one Kev call (~190 ms native, 530 MB).

## Files

- `code/`:
  - `build_items.py`: the aligned table.
  - `fuse.py`: the library.
  - `oneshot.py`, `gates.py`, `extras.py`: the analyses.
  - `export_head.py`: the frozen LR head.
  - `prereg_eval.py`: the frozen evaluator.
- `out/`:
  - `items.jsonl`, `coverage.json`;
  - `oneshot-{q4,q8}.{json,log}`, `gates-{q4,q8}.{json,log}`, `extras-q4.{json,log}`;
  - `kev08{,q4}-desc-r8val.jsonl` (the gap-fill) and `items-r8val.json`;
  - `prereg-input-*.jsonl`, `prereg-expected-*.json`;
  - `head-lr.json` (sha256 `8f3ca91d…`, which reproduces X2's predictions to 2e-6).
- `logs/`: the Kev server logs. Both servers are stopped.
