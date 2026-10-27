# Held-out-6, run 1: Pre-registration 3 results (blind evaluator)

Executed 2026-10-27 08:35-08:53 CDT, this Mac, native llama-server Metal (llama.cpp 46ca246), repo rev 5e9c3904, node v24.13.0, tsx 4.21.0.
This is the first and only held-out-6 execution of PREREGISTRATION-3. Each block ran once. Nothing was rerun, resumed or retried, and no parameter was changed.

## Part A: integrity, procedure, deviations

- `x7-fusion/PREREGISTRATION-3.md` sha256 `e9733fe2...7486` matches the expected value and its sidecar (re-checked by the rig at the start and end of every block).
- `x7-fusion/code/prereg3_analysis.py` `8be69b8c...` and `rig/src/exclude.py` `258bfce9...` match the prereg's `verify` lines. Every block also re-verified the GGUF shas, the set sha and all `verify` files (all ok).
- `blind/heldout6/heldout6-eval.json` sha256 `85942add...f775` matches `heldout6-eval.json.sha256`. The evaluator did not open the eval file.
- **Dev parity (§5 step 2)** was done at freeze time: `prereg3-dev/analysis-dev.console.log` and `analysis-dev-excl.console.log` both end with `PARITY OK`. It was not rerun, because §5.2 requires a rerun only if a verified file changed, and the rig's `verify` lines passed.
- **Date (§7):** `today = 2026-10-23`, from the set's `conventions.today` (items summary: n 220, 200 action, 20 no-action, 0 multi, 200 with step 2). The x9 path ran in all four blocks. The `*-x6` fallback was **not** used.
- **Exclusion (§4): 0 items excluded**, which equals `expect_excluded: 0`. Each of the three specs logged `WARN no hit`: `rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3`, `train-utterances-round11.jsonl:*` (7,808 rows) and `train-utterances-kevft.jsonl:*` (4,382 rows). No DEVIATION line was logged. The primary view and the full set are therefore the same 200 + 20 items.
- **Blocks**, run in order via `rig/rig.sh --prereg ../x7-fusion/PREREGISTRATION-3.md --prereg-run <name>` (cwd `exp/rig`), all rc 0:

  | Block | Time |
  |---|---|
  | x5-kevft | 08:35:56-08:39:26 |
  | f-kevft | -08:44:33 |
  | x5-kevft-full | -08:48:21 |
  | f-kevft-full | -08:53:22 |

  Missing rows: 0, and floored trie children: 0, in every block.
- **Locations.** The rig output dirs are where §13 says: `exp/heldout6-run/<block>` and `exp/heldout6-run/analysis.{md,json}`. The evaluator's own files are in `exp/heldout6-run1/`: `PROGRESS.log`, `phase.log`, `driver.sh`, `<block>.console.log`, `analysis.console.log`, `categories_gate.py`, `categories-C.json` and this file.
- **Analysis:** the §5.6 command ran once from `exp/`, verbatim, with rc 0. Its within-run assertions passed (totals equal to the rig's `results.json`, identical items and labels, §2 temperatures).
- **Determinism**, excluded run vs full run: x5 and f each share 220 rows, with pickDiff 0, argsDiff 0, max |d loraExact| 0 and max |d Kev| 0. x5 and f have identical ids and gold.
- `categories_gate.py` was written before the first block finished. It is a read-only reader that imports the rig's `evaluate.decide`, and it was run once, after the analysis, on `x5-kevft/rows.jsonl` at 1.63 / 4.0. Its totals reconcile with the analysis: eff 175, gold-in-choices 196, ask 35, wrong 6.
- **Deviations from procedure: none.**
- **§10 context:** P1 passed; §10 called it close to a coin flip on held-out-5's rate (about 38-98% depending on the prior rate).
- **Expectation miss (§10), logged only:** the secondary binomial rejected for P2 (192 >= 189), where §10 expected it to reject for neither.

## Part B: primary view (0 excluded; 200 action + 20 no-action; x9 args)

| Arm | Op one-shot (Wilson 95%) | Fully NORM / STRICT | Gold-in-choices | Ask /220 | Wrong /220 (Wilson) | Eff NORM (Wilson) / STRICT | NA TP /20 |
|---|---|---|---|---|---|---|---|
| A: X5 | 169 (84.5%, 78.8-88.9) | 153 / 153 | 169 | 0 | 34 (15.5%) | - | 17 |
| B: X5 x Kev-FT (C one-shot) | 187 (93.5%, 89.2-96.2) | 167 / 167 | 187 | 0 | 16 (7.3%) | - | 17 |
| **C**: B + gate | 187 | 167 / 167 | **196 (98.0%)** | **35 (15.9%)** | 6 (2.7%, 1.3-5.8) | **175 (87.5%, 82.2-91.4)** / 175 | 17 |
| D-oneshot: F x Kev-FT | 192 (96.0%, 92.3-98.0) | 174 / 174 | 192 | 0 | 11 (5.0%) | - | 17 |
| **D**: D-oneshot + gate | 192 | 174 / 174 | **197 (98.5%)** | **30 (13.6%)** | 3 (1.4%, 0.5-3.9) | **179 (89.5%, 84.5-93.0)** / 179 | 17 |

### Hypotheses

- **P1, B op >= 90%: PASS.** 187/200 = 93.5%, Wilson 89.2-96.2. The lower bound is below 90%.
- **P2, D-oneshot op >= 90%: PASS.** 192/200 = 96.0%, Wilson 92.3-98.0. The lower bound is at least 90%.
- **Secondary**, one-sided exact binomial against 0.90 with Holm (reported only; it does not decide pass/fail):
  - P2: p = 0.00139 < 0.025, **rejected**.
  - P1: p = 0.0566 against 0.05, **not rejected**.
- **Gate bars, C: MET.** Gold-in-choices 196/200 (98.0%, bar 92%). Ask 35/220 (15.9%, bar 30%).
- **Gate bars, D: MET.** Gold-in-choices 197/200 (98.5%). Ask 30/220 (13.6%).
- **D vs C (descriptive):**

  | Measure | D | C |
  |---|---|---|
  | Op | 192 | 187 |
  | Fully NORM / STRICT | 174 / 174 | 167 / 167 |
  | Gold-in-choices | 197 | 196 |
  | Ask | 30 | 35 |
  | Wrong | 3 | 6 |
  | Effective NORM / STRICT | 179 / 179 | 175 / 175 |
  | No-action TP | 17 | 17 |

  Paired on op: +8/-3, two-sided McNemar p 0.227. Paired on effective NORM: +9/-5, two-sided p 0.424.
- **Reference, op paired:** B vs A +19/-1 (two-sided p 4.0e-05). D-oneshot vs A +25/-2 (p 5.6e-06).

### §9 shipping decision: **ship C (X5 350M x Kev-FT + gate)**

- delta = 100 x (179 - 175) / 200 = **+2.0 points**, which is below 3.0.
- McNemar on effective NORM: +9/-5, p **0.424**, which is not below 0.05. Both conditions fail.
- Size and latency: C is 229 + 530 MB on device, against D's 731 + 530 MB. F is about 1.9x / 2.1x X5's latency on step 1 / step 2.
- With C shipped, P1 (C's one-shot op) PASSES on the point estimate, and C's gate bars are MET.

### Splits (primary; op / gold-in-choices / ask / eff NORM)

| Split | A op | B op | C gio | C ask | C eff | D-1s op | D gio | D ask | D eff |
|---|---|---|---|---|---|---|---|---|---|
| plain (70 + 7 none) | 64 | 68 | 70 | 5/77 | 66 | 68 | 69 | 5/77 | 66 |
| messy (130 + 13 none) | 105 (80.8%) | 119 (91.5%) | 126 | 30/143 | 109 | 124 (95.4%) | 128 | 25/143 | 113 |
| easy (12) | 12 | 12 | 12 | 0 | 12 | 12 | 12 | 0 | 12 |
| medium (129) | 112 | 122 | 128 | 18 | 119 | 125 | 128 | 14 | 121 |
| hard (59, all messy) | 45 (76.3%) | 53 (89.8%) | 56 | 16 | 44 | 55 (93.2%) | 57 | 14 | 46 |

Style x difficulty cells are in the appended analysis. Messy x hard is the same as hard. In messy x medium (67 items): B 62, D-oneshot 65, C eff 61, D eff 63. In plain x medium (62 items): B 60, D-oneshot 60, C eff 58, D eff 58.

### Secondary view (full set, no exclusion)

It is identical to the primary view: 0 items were excluded, and the rows are byte-identical in picks and args. Its hypotheses and decision equal the primary's (ship C, delta +2.0, p 0.424).

### Shipped config C: error categories (ids only; `categories-C.json`)

| Category | n | Ids |
|---|---|---|
| Not asked, op right, args ok (NORM) | 148 | |
| Not asked, op right, args wrong (NORM, x9) | 14 | moc6-02, moc6-06, moc6-07, moc6-16, prj6-14, wbs6-03, wbs6-21, wbs6-28, vc6-02, src6-01, src6-02, src6-04, ten6-02, hr6-01 |
| Not asked, op right, args wrong STRICT only | 0 | |
| Not asked, **wrong dispatch** (another op) | 3 | moc6-09, prj6-26, obs6-04 |
| Not asked, **false none** (LoRA none rule) | 1 | ten6-06 |
| Asked, gold offered, args ok | 27 | |
| Asked, gold offered, args wrong (NORM, x9) | 7 | prj6-15, wbs6-02, wbs6-09, wbs6-11, wbs6-12, wbs6-15, der6-06 |
| Asked, gold not offered | 0 | |
| No-action TP | 17 | |
| No-action asked (user picks none-of-these) | 1 | none6-16 |
| No-action **false-positive dispatch** | 2 | none6-04, none6-13 |

C's 6 wrong dispatches are 3 + 1 + 2. Its 25 effective misses are 14 + 7 args failures, 3 wrong dispatches and 1 false none.

## Appendix 1: analysis output (`heldout6-run/analysis.md`, verbatim)

# Pre-registration 3: analysis

## primary: with the pre-registered exclusion (args level x9, 220 single items)

Excluded ids: x5: none; f: none

### all

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 169/200 (84.5%) | 0.7884-0.8886 | 153/200 | 153 | 169 (84.5%) | 0/220 | 34 (15.45%) | - | 17/20, 18 |
| B: X5 x Kev-FT PoE (C one-shot) | 187/200 (93.5%) | 0.892-0.9616 | 167/200 | 167 | 187 (93.5%) | 0/220 | 16 (7.27%) | - | 17/20, 18 |
| C: B + margin gate | 187/200 (93.5%) | 0.892-0.9616 | 167/200 | 167 | 196 (98.0%) | 35/220 | 6 (2.73%) | 175 (0.822-0.9139) / 175 | 17/20, 18 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 192/200 (96.0%) | 0.9231-0.9796 | 174/200 | 174 | 192 (96.0%) | 0/220 | 11 (5.0%) | - | 17/20, 17 |
| D: D-oneshot + margin gate | 192/200 (96.0%) | 0.9231-0.9796 | 174/200 | 174 | 197 (98.5%) | 30/220 | 3 (1.36%) | 179 (0.8448-0.9303) / 179 | 17/20, 17 |

### style=messy

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 105/130 (80.8%) | 0.7315-0.8662 | 93/130 | 93 | 105 (80.77%) | 0/143 | 26 (18.18%) | - | 12/13, 13 |
| B: X5 x Kev-FT PoE (C one-shot) | 119/130 (91.5%) | 0.8548-0.9521 | 103/130 | 103 | 119 (91.54%) | 0/143 | 12 (8.39%) | - | 12/13, 13 |
| C: B + margin gate | 119/130 (91.5%) | 0.8548-0.9521 | 103/130 | 103 | 126 (96.92%) | 30/143 | 5 (3.5%) | 109 (0.7656-0.8918) / 109 | 12/13, 13 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 124/130 (95.4%) | 0.903-0.9787 | 109/130 | 109 | 124 (95.38%) | 0/143 | 7 (4.9%) | - | 12/13, 12 |
| D: D-oneshot + margin gate | 124/130 (95.4%) | 0.903-0.9787 | 109/130 | 109 | 128 (98.46%) | 25/143 | 1 (0.7%) | 113 (0.8005-0.9167) / 113 | 12/13, 12 |

### style=plain

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 64/70 (91.4%) | 0.8253-0.9601 | 60/70 | 60 | 64 (91.43%) | 0/77 | 8 (10.39%) | - | 5/7, 5 |
| B: X5 x Kev-FT PoE (C one-shot) | 68/70 (97.1%) | 0.9017-0.9921 | 64/70 | 64 | 68 (97.14%) | 0/77 | 4 (5.19%) | - | 5/7, 5 |
| C: B + margin gate | 68/70 (97.1%) | 0.9017-0.9921 | 64/70 | 64 | 70 (100.0%) | 5/77 | 1 (1.3%) | 66 (0.8621-0.9776) / 66 | 5/7, 5 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 68/70 (97.1%) | 0.9017-0.9921 | 65/70 | 65 | 68 (97.14%) | 0/77 | 4 (5.19%) | - | 5/7, 5 |
| D: D-oneshot + margin gate | 68/70 (97.1%) | 0.9017-0.9921 | 65/70 | 65 | 69 (98.57%) | 5/77 | 2 (2.6%) | 66 (0.8621-0.9776) / 66 | 5/7, 5 |

### difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | 12 (0.7575-1.0) / 12 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | 12 (0.7575-1.0) / 12 | 0/0, 0 |

### difficulty=hard (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 45/59 (76.3%) | 0.6403-0.8531 | 36/59 | 36 | 45 (76.27%) | 0/59 | 14 (23.73%) | - | 0/0, 1 |
| B: X5 x Kev-FT PoE (C one-shot) | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 53 (89.83%) | 0/59 | 6 (10.17%) | - | 0/0, 1 |
| C: B + margin gate | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 56 (94.92%) | 16/59 | 3 (5.08%) | 44 (0.622-0.8394) / 44 | 0/0, 1 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 55 (93.22%) | 0/59 | 4 (6.78%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 57 (96.61%) | 14/59 | 1 (1.69%) | 46 (0.6587-0.8665) / 46 | 0/0, 0 |

### difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 112/129 (86.8%) | 0.7991-0.9161 | 105/129 | 105 | 112 (86.82%) | 0/129 | 17 (13.18%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 122/129 (94.6%) | 0.8922-0.9735 | 114/129 | 114 | 122 (94.57%) | 0/129 | 7 (5.43%) | - | 0/0, 0 |
| C: B + margin gate | 122/129 (94.6%) | 0.8922-0.9735 | 114/129 | 114 | 128 (99.22%) | 18/129 | 1 (0.78%) | 119 (0.8632-0.9574) / 119 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 125/129 (96.9%) | 0.923-0.9879 | 118/129 | 118 | 125 (96.9%) | 0/129 | 4 (3.1%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 125/129 (96.9%) | 0.923-0.9879 | 118/129 | 118 | 128 (99.22%) | 14/129 | 1 (0.78%) | 121 (0.8824-0.9682) / 121 | 0/0, 0 |

### style=messy x difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | 4 (0.5101-1.0) / 4 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | 4 (0.5101-1.0) / 4 | 0/0, 0 |

### style=messy x difficulty=hard (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 45/59 (76.3%) | 0.6403-0.8531 | 36/59 | 36 | 45 (76.27%) | 0/59 | 14 (23.73%) | - | 0/0, 1 |
| B: X5 x Kev-FT PoE (C one-shot) | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 53 (89.83%) | 0/59 | 6 (10.17%) | - | 0/0, 1 |
| C: B + margin gate | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 56 (94.92%) | 16/59 | 3 (5.08%) | 44 (0.622-0.8394) / 44 | 0/0, 1 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 55 (93.22%) | 0/59 | 4 (6.78%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 57 (96.61%) | 14/59 | 1 (1.69%) | 46 (0.6587-0.8665) / 46 | 0/0, 0 |

### style=messy x difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 56/67 (83.6%) | 0.7294-0.9058 | 53/67 | 53 | 56 (83.58%) | 0/67 | 11 (16.42%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 62/67 (92.5%) | 0.8369-0.9677 | 58/67 | 58 | 62 (92.54%) | 0/67 | 5 (7.46%) | - | 0/0, 0 |
| C: B + margin gate | 62/67 (92.5%) | 0.8369-0.9677 | 58/67 | 58 | 66 (98.51%) | 14/67 | 1 (1.49%) | 61 (0.8181-0.9583) / 61 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 65/67 (97.0%) | 0.8975-0.9918 | 61/67 | 61 | 65 (97.01%) | 0/67 | 2 (2.99%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 65/67 (97.0%) | 0.8975-0.9918 | 61/67 | 61 | 67 (100.0%) | 10/67 | 0 (0.0%) | 63 (0.8563-0.9765) / 63 | 0/0, 0 |

### style=plain x difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | 8 (0.6756-1.0) / 8 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | 8 (0.6756-1.0) / 8 | 0/0, 0 |

### style=plain x difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 56/62 (90.3%) | 0.8045-0.9549 | 52/62 | 52 | 56 (90.32%) | 0/62 | 6 (9.68%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 60/62 (96.8%) | 0.8898-0.9911 | 56/62 | 56 | 60 (96.77%) | 0/62 | 2 (3.23%) | - | 0/0, 0 |
| C: B + margin gate | 60/62 (96.8%) | 0.8898-0.9911 | 56/62 | 56 | 62 (100.0%) | 4/62 | 0 (0.0%) | 58 (0.8455-0.9746) / 58 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 60/62 (96.8%) | 0.8898-0.9911 | 57/62 | 57 | 60 (96.77%) | 0/62 | 2 (3.23%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 60/62 (96.8%) | 0.8898-0.9911 | 57/62 | 57 | 61 (98.39%) | 4/62 | 1 (1.61%) | 58 (0.8455-0.9746) / 58 | 0/0, 0 |

### Hypotheses

```json
{
 "P1 B op one-shot >= 90%": {
  "op": 187,
  "n": 200,
  "pct": 93.5,
  "wilson95": [
   0.892,
   0.9616
  ],
  "PASS (op >= 0.90 x n, point estimate)": true,
  "wilsonLowerAtLeast90 (descriptive)": false,
  "secondary: oneSidedExactBinomialP (H0 pi=0.90)": 0.05656204313708803
 },
 "P2 D-oneshot op one-shot >= 90%": {
  "op": 192,
  "n": 200,
  "pct": 96.0,
  "wilson95": [
   0.9231,
   0.9796
  ],
  "PASS (op >= 0.90 x n, point estimate)": true,
  "wilsonLowerAtLeast90 (descriptive)": true,
  "secondary: oneSidedExactBinomialP (H0 pi=0.90)": 0.0013880336210247955
 },
 "secondary: exact binomial vs 0.90, Holm over P1, P2 (reported, not the pass criterion)": {
  "P2": {
   "p": 0.0013880336210247955,
   "threshold": 0.025,
   "rejected": true
  },
  "P1": {
   "p": 0.05656204313708803,
   "threshold": 0.05,
   "rejected": false
  }
 },
 "gate bars C": {
  "goldInChoices": [
   196,
   200,
   98.0
  ],
  "goldInChoicesMet (>= 92%)": true,
  "ask": [
   35,
   220,
   15.91
  ],
  "askMet (<= 30%)": true,
  "met (both)": true,
  "effNorm": [
   175,
   200,
   87.5,
   [
    0.822,
    0.9139
   ]
  ],
  "effStrict": [
   175,
   200,
   87.5
  ],
  "wrongDispatches": [
   6,
   220,
   2.73,
   [
    0.0126,
    0.0582
   ]
  ]
 },
 "gate bars D": {
  "goldInChoices": [
   197,
   200,
   98.5
  ],
  "goldInChoicesMet (>= 92%)": true,
  "ask": [
   30,
   220,
   13.64
  ],
  "askMet (<= 30%)": true,
  "met (both)": true,
  "effNorm": [
   179,
   200,
   89.5,
   [
    0.8448,
    0.9303
   ]
  ],
  "effStrict": [
   179,
   200,
   89.5
  ],
  "wrongDispatches": [
   3,
   220,
   1.36,
   [
    0.0046,
    0.0393
   ]
  ]
 },
 "D vs C (descriptive; effNorm McNemar enters the shipping rule)": {
  "op": {
   "D": 192,
   "C": 187
  },
  "fullyNorm": {
   "D": 174,
   "C": 167
  },
  "fullyStrict": {
   "D": 174,
   "C": 167
  },
  "goldInChoices": {
   "D": 197,
   "C": 196
  },
  "ask": {
   "D": 30,
   "C": 35
  },
  "wrong": {
   "D": 3,
   "C": 6
  },
  "effNorm": {
   "D": 179,
   "C": 175
  },
  "effStrict": {
   "D": 179,
   "C": 175
  },
  "naTP": {
   "D": 17,
   "C": 17
  },
  "effNorm paired (D vs C, exact McNemar)": {
   "n": 200,
   "fixed": 9,
   "broken": 5,
   "oneSidedP": 0.21197509765625,
   "twoSidedP": 0.4239501953125
  },
  "op paired (D vs C, exact McNemar)": {
   "n": 200,
   "fixed": 8,
   "broken": 3,
   "oneSidedP": 0.11328125,
   "twoSidedP": 0.2265625
  }
 },
 "reference: B vs A, D-oneshot vs A (op, paired)": {
  "B vs A": {
   "n": 200,
   "fixed": 19,
   "broken": 1,
   "oneSidedP": 2.002716064453125e-05,
   "twoSidedP": 4.00543212890625e-05
  },
  "D-oneshot vs A": {
   "n": 200,
   "fixed": 25,
   "broken": 2,
   "oneSidedP": 2.823770046234131e-06,
   "twoSidedP": 5.647540092468262e-06
  }
 }
}
```

### Shipping decision (pre-registered rule)

```json
{
 "rule": "ship D iff 100*(effNorm_D - effNorm_C)/nArgs >= 3.0 AND two-sided exact McNemar p (paired effNorm, D vs C) < 0.05; else ship C",
 "effNormD": 179,
 "effNormC": 175,
 "nArgs": 200,
 "deltaPoints": 2.0,
 "mcnemarEffNorm": {
  "fixed (D right, C wrong)": 9,
  "broken (C right, D wrong)": 5,
  "twoSidedP": 0.4239501953125
 },
 "deltaAtLeast3": false,
 "mcnemarSignificant": false,
 "ship": "C (X5 350M x Kev-FT + gate)",
 "sizeNote": "C 229 + 530 MB on device; D 731 + 530 MB (F is 3.2x X5); F native latency ~1.9x X5 on step 1 and ~2.1x on step 2 (rig/validation/latency-b2b2-{f,x5}); Kev-FT is shared"
}
```

## secondary: full set, no exclusion (args level x9, 220 single items)

Excluded ids: x5: none; f: none

### all

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 169/200 (84.5%) | 0.7884-0.8886 | 153/200 | 153 | 169 (84.5%) | 0/220 | 34 (15.45%) | - | 17/20, 18 |
| B: X5 x Kev-FT PoE (C one-shot) | 187/200 (93.5%) | 0.892-0.9616 | 167/200 | 167 | 187 (93.5%) | 0/220 | 16 (7.27%) | - | 17/20, 18 |
| C: B + margin gate | 187/200 (93.5%) | 0.892-0.9616 | 167/200 | 167 | 196 (98.0%) | 35/220 | 6 (2.73%) | 175 (0.822-0.9139) / 175 | 17/20, 18 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 192/200 (96.0%) | 0.9231-0.9796 | 174/200 | 174 | 192 (96.0%) | 0/220 | 11 (5.0%) | - | 17/20, 17 |
| D: D-oneshot + margin gate | 192/200 (96.0%) | 0.9231-0.9796 | 174/200 | 174 | 197 (98.5%) | 30/220 | 3 (1.36%) | 179 (0.8448-0.9303) / 179 | 17/20, 17 |

### style=messy

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 105/130 (80.8%) | 0.7315-0.8662 | 93/130 | 93 | 105 (80.77%) | 0/143 | 26 (18.18%) | - | 12/13, 13 |
| B: X5 x Kev-FT PoE (C one-shot) | 119/130 (91.5%) | 0.8548-0.9521 | 103/130 | 103 | 119 (91.54%) | 0/143 | 12 (8.39%) | - | 12/13, 13 |
| C: B + margin gate | 119/130 (91.5%) | 0.8548-0.9521 | 103/130 | 103 | 126 (96.92%) | 30/143 | 5 (3.5%) | 109 (0.7656-0.8918) / 109 | 12/13, 13 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 124/130 (95.4%) | 0.903-0.9787 | 109/130 | 109 | 124 (95.38%) | 0/143 | 7 (4.9%) | - | 12/13, 12 |
| D: D-oneshot + margin gate | 124/130 (95.4%) | 0.903-0.9787 | 109/130 | 109 | 128 (98.46%) | 25/143 | 1 (0.7%) | 113 (0.8005-0.9167) / 113 | 12/13, 12 |

### style=plain

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 64/70 (91.4%) | 0.8253-0.9601 | 60/70 | 60 | 64 (91.43%) | 0/77 | 8 (10.39%) | - | 5/7, 5 |
| B: X5 x Kev-FT PoE (C one-shot) | 68/70 (97.1%) | 0.9017-0.9921 | 64/70 | 64 | 68 (97.14%) | 0/77 | 4 (5.19%) | - | 5/7, 5 |
| C: B + margin gate | 68/70 (97.1%) | 0.9017-0.9921 | 64/70 | 64 | 70 (100.0%) | 5/77 | 1 (1.3%) | 66 (0.8621-0.9776) / 66 | 5/7, 5 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 68/70 (97.1%) | 0.9017-0.9921 | 65/70 | 65 | 68 (97.14%) | 0/77 | 4 (5.19%) | - | 5/7, 5 |
| D: D-oneshot + margin gate | 68/70 (97.1%) | 0.9017-0.9921 | 65/70 | 65 | 69 (98.57%) | 5/77 | 2 (2.6%) | 66 (0.8621-0.9776) / 66 | 5/7, 5 |

### difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | 12 (0.7575-1.0) / 12 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 12/12 (100.0%) | 0.7575-1.0 | 12/12 | 12 | 12 (100.0%) | 0/12 | 0 (0.0%) | 12 (0.7575-1.0) / 12 | 0/0, 0 |

### difficulty=hard (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 45/59 (76.3%) | 0.6403-0.8531 | 36/59 | 36 | 45 (76.27%) | 0/59 | 14 (23.73%) | - | 0/0, 1 |
| B: X5 x Kev-FT PoE (C one-shot) | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 53 (89.83%) | 0/59 | 6 (10.17%) | - | 0/0, 1 |
| C: B + margin gate | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 56 (94.92%) | 16/59 | 3 (5.08%) | 44 (0.622-0.8394) / 44 | 0/0, 1 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 55 (93.22%) | 0/59 | 4 (6.78%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 57 (96.61%) | 14/59 | 1 (1.69%) | 46 (0.6587-0.8665) / 46 | 0/0, 0 |

### difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 112/129 (86.8%) | 0.7991-0.9161 | 105/129 | 105 | 112 (86.82%) | 0/129 | 17 (13.18%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 122/129 (94.6%) | 0.8922-0.9735 | 114/129 | 114 | 122 (94.57%) | 0/129 | 7 (5.43%) | - | 0/0, 0 |
| C: B + margin gate | 122/129 (94.6%) | 0.8922-0.9735 | 114/129 | 114 | 128 (99.22%) | 18/129 | 1 (0.78%) | 119 (0.8632-0.9574) / 119 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 125/129 (96.9%) | 0.923-0.9879 | 118/129 | 118 | 125 (96.9%) | 0/129 | 4 (3.1%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 125/129 (96.9%) | 0.923-0.9879 | 118/129 | 118 | 128 (99.22%) | 14/129 | 1 (0.78%) | 121 (0.8824-0.9682) / 121 | 0/0, 0 |

### style=messy x difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | 4 (0.5101-1.0) / 4 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 4/4 (100.0%) | 0.5101-1.0 | 4/4 | 4 | 4 (100.0%) | 0/4 | 0 (0.0%) | 4 (0.5101-1.0) / 4 | 0/0, 0 |

### style=messy x difficulty=hard (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 45/59 (76.3%) | 0.6403-0.8531 | 36/59 | 36 | 45 (76.27%) | 0/59 | 14 (23.73%) | - | 0/0, 1 |
| B: X5 x Kev-FT PoE (C one-shot) | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 53 (89.83%) | 0/59 | 6 (10.17%) | - | 0/0, 1 |
| C: B + margin gate | 53/59 (89.8%) | 0.7954-0.9526 | 41/59 | 41 | 56 (94.92%) | 16/59 | 3 (5.08%) | 44 (0.622-0.8394) / 44 | 0/0, 1 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 55 (93.22%) | 0/59 | 4 (6.78%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 55/59 (93.2%) | 0.8382-0.9733 | 44/59 | 44 | 57 (96.61%) | 14/59 | 1 (1.69%) | 46 (0.6587-0.8665) / 46 | 0/0, 0 |

### style=messy x difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 56/67 (83.6%) | 0.7294-0.9058 | 53/67 | 53 | 56 (83.58%) | 0/67 | 11 (16.42%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 62/67 (92.5%) | 0.8369-0.9677 | 58/67 | 58 | 62 (92.54%) | 0/67 | 5 (7.46%) | - | 0/0, 0 |
| C: B + margin gate | 62/67 (92.5%) | 0.8369-0.9677 | 58/67 | 58 | 66 (98.51%) | 14/67 | 1 (1.49%) | 61 (0.8181-0.9583) / 61 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 65/67 (97.0%) | 0.8975-0.9918 | 61/67 | 61 | 65 (97.01%) | 0/67 | 2 (2.99%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 65/67 (97.0%) | 0.8975-0.9918 | 61/67 | 61 | 67 (100.0%) | 10/67 | 0 (0.0%) | 63 (0.8563-0.9765) / 63 | 0/0, 0 |

### style=plain x difficulty=easy (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| C: B + margin gate | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | 8 (0.6756-1.0) / 8 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 8/8 (100.0%) | 0.6756-1.0 | 8/8 | 8 | 8 (100.0%) | 0/8 | 0 (0.0%) | 8 (0.6756-1.0) / 8 | 0/0, 0 |

### style=plain x difficulty=medium (action only)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask | Wrong (rate) | Eff NORM (Wilson 95%) / STRICT | NA TP / predNone |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 alone (reference) | 56/62 (90.3%) | 0.8045-0.9549 | 52/62 | 52 | 56 (90.32%) | 0/62 | 6 (9.68%) | - | 0/0, 0 |
| B: X5 x Kev-FT PoE (C one-shot) | 60/62 (96.8%) | 0.8898-0.9911 | 56/62 | 56 | 60 (96.77%) | 0/62 | 2 (3.23%) | - | 0/0, 0 |
| C: B + margin gate | 60/62 (96.8%) | 0.8898-0.9911 | 56/62 | 56 | 62 (100.0%) | 4/62 | 0 (0.0%) | 58 (0.8455-0.9746) / 58 | 0/0, 0 |
| D-oneshot: F x Kev-FT PoE (D one-shot) | 60/62 (96.8%) | 0.8898-0.9911 | 57/62 | 57 | 60 (96.77%) | 0/62 | 2 (3.23%) | - | 0/0, 0 |
| D: D-oneshot + margin gate | 60/62 (96.8%) | 0.8898-0.9911 | 57/62 | 57 | 61 (98.39%) | 4/62 | 1 (1.61%) | 58 (0.8455-0.9746) / 58 | 0/0, 0 |

### Hypotheses

```json
{
 "P1 B op one-shot >= 90%": {
  "op": 187,
  "n": 200,
  "pct": 93.5,
  "wilson95": [
   0.892,
   0.9616
  ],
  "PASS (op >= 0.90 x n, point estimate)": true,
  "wilsonLowerAtLeast90 (descriptive)": false,
  "secondary: oneSidedExactBinomialP (H0 pi=0.90)": 0.05656204313708803
 },
 "P2 D-oneshot op one-shot >= 90%": {
  "op": 192,
  "n": 200,
  "pct": 96.0,
  "wilson95": [
   0.9231,
   0.9796
  ],
  "PASS (op >= 0.90 x n, point estimate)": true,
  "wilsonLowerAtLeast90 (descriptive)": true,
  "secondary: oneSidedExactBinomialP (H0 pi=0.90)": 0.0013880336210247955
 },
 "secondary: exact binomial vs 0.90, Holm over P1, P2 (reported, not the pass criterion)": {
  "P2": {
   "p": 0.0013880336210247955,
   "threshold": 0.025,
   "rejected": true
  },
  "P1": {
   "p": 0.05656204313708803,
   "threshold": 0.05,
   "rejected": false
  }
 },
 "gate bars C": {
  "goldInChoices": [
   196,
   200,
   98.0
  ],
  "goldInChoicesMet (>= 92%)": true,
  "ask": [
   35,
   220,
   15.91
  ],
  "askMet (<= 30%)": true,
  "met (both)": true,
  "effNorm": [
   175,
   200,
   87.5,
   [
    0.822,
    0.9139
   ]
  ],
  "effStrict": [
   175,
   200,
   87.5
  ],
  "wrongDispatches": [
   6,
   220,
   2.73,
   [
    0.0126,
    0.0582
   ]
  ]
 },
 "gate bars D": {
  "goldInChoices": [
   197,
   200,
   98.5
  ],
  "goldInChoicesMet (>= 92%)": true,
  "ask": [
   30,
   220,
   13.64
  ],
  "askMet (<= 30%)": true,
  "met (both)": true,
  "effNorm": [
   179,
   200,
   89.5,
   [
    0.8448,
    0.9303
   ]
  ],
  "effStrict": [
   179,
   200,
   89.5
  ],
  "wrongDispatches": [
   3,
   220,
   1.36,
   [
    0.0046,
    0.0393
   ]
  ]
 },
 "D vs C (descriptive; effNorm McNemar enters the shipping rule)": {
  "op": {
   "D": 192,
   "C": 187
  },
  "fullyNorm": {
   "D": 174,
   "C": 167
  },
  "fullyStrict": {
   "D": 174,
   "C": 167
  },
  "goldInChoices": {
   "D": 197,
   "C": 196
  },
  "ask": {
   "D": 30,
   "C": 35
  },
  "wrong": {
   "D": 3,
   "C": 6
  },
  "effNorm": {
   "D": 179,
   "C": 175
  },
  "effStrict": {
   "D": 179,
   "C": 175
  },
  "naTP": {
   "D": 17,
   "C": 17
  },
  "effNorm paired (D vs C, exact McNemar)": {
   "n": 200,
   "fixed": 9,
   "broken": 5,
   "oneSidedP": 0.21197509765625,
   "twoSidedP": 0.4239501953125
  },
  "op paired (D vs C, exact McNemar)": {
   "n": 200,
   "fixed": 8,
   "broken": 3,
   "oneSidedP": 0.11328125,
   "twoSidedP": 0.2265625
  }
 },
 "reference: B vs A, D-oneshot vs A (op, paired)": {
  "B vs A": {
   "n": 200,
   "fixed": 19,
   "broken": 1,
   "oneSidedP": 2.002716064453125e-05,
   "twoSidedP": 4.00543212890625e-05
  },
  "D-oneshot vs A": {
   "n": 200,
   "fixed": 25,
   "broken": 2,
   "oneSidedP": 2.823770046234131e-06,
   "twoSidedP": 5.647540092468262e-06
  }
 }
}
```

### Shipping decision (pre-registered rule)

```json
{
 "rule": "ship D iff 100*(effNorm_D - effNorm_C)/nArgs >= 3.0 AND two-sided exact McNemar p (paired effNorm, D vs C) < 0.05; else ship C",
 "effNormD": 179,
 "effNormC": 175,
 "nArgs": 200,
 "deltaPoints": 2.0,
 "mcnemarEffNorm": {
  "fixed (D right, C wrong)": 9,
  "broken (C right, D wrong)": 5,
  "twoSidedP": 0.4239501953125
 },
 "deltaAtLeast3": false,
 "mcnemarSignificant": false,
 "ship": "C (X5 350M x Kev-FT + gate)",
 "sizeNote": "C 229 + 530 MB on device; D 731 + 530 MB (F is 3.2x X5); F native latency ~1.9x X5 on step 1 and ~2.1x on step 2 (rig/validation/latency-b2b2-{f,x5}); Kev-FT is shared"
}
```

## Determinism (excluded vs full runs)

```json
{
 "x5": {
  "shared": 220,
  "onlyInFull": [],
  "pickDiff": 0,
  "argsDiff": 0,
  "maxAbsDeltaLoraExact": 0.0,
  "maxAbsDeltaKev": 0.0
 },
 "f": {
  "shared": 220,
  "onlyInFull": [],
  "pickDiff": 0,
  "argsDiff": 0,
  "maxAbsDeltaLoraExact": 0.0,
  "maxAbsDeltaKev": 0.0
 }
}
```

## Appendix 2: rig results.md of each block

# Rig results: x5-kevft

Headline temperatures: **explicit**. Explicit: T_lora 1.63, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

Excluded at run start (0 item(s), dedup normalize + leak_hit, threshold 0.5): rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3 -> no hit; train-utterances-round11.jsonl:* -> no hit; train-utterances-kevft.jsonl:* -> no hit

### explicit (headline): T_lora 1.63, T_kev 4.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 179 / 179

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 169 (84.5%) | 105/130 | 64/70 | 153 / 153 | - | 169 (84.5%) | 0/220 (0.0%) | 34 | 17/20, 18 |
| Kev alone (LoRA none rule) | 184 (92.0%) | 118/130 | 66/70 | 165 / 165 | +23/-8 (0.0053) | 184 (92.0%) | 0/220 (0.0%) | 19 | 17/20, 18 |
| LoRA x Kev (equal-weight PoE) | 187 (93.5%) | 119/130 | 68/70 | 167 / 167 | +19/-1 (2e-05) | 187 (93.5%) | 0/220 (0.0%) | 16 | 17/20, 18 |
| LoRA x Kev + margin gate tau 0.5 | 187 (93.5%) | 119/130 | 68/70 | 167 / 167 (eff 175 / 175) | +19/-1 (2e-05) | 196 (98.0%); messy 126/130, plain 70/70 | 35/220 (15.9%) | 6 | 17/20, 18 |

### frozen: T_lora 1.8, T_kev 1.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 179 / 179

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 169 (84.5%) | 105/130 | 64/70 | 153 / 153 | - | 169 (84.5%) | 0/220 (0.0%) | 34 | 17/20, 18 |
| Kev alone (LoRA none rule) | 184 (92.0%) | 118/130 | 66/70 | 165 / 165 | +23/-8 (0.0053) | 184 (92.0%) | 0/220 (0.0%) | 19 | 17/20, 18 |
| LoRA x Kev (equal-weight PoE) | 188 (94.0%) | 122/130 | 66/70 | 168 / 168 | +24/-5 (0.00027) | 188 (94.0%) | 0/220 (0.0%) | 15 | 17/20, 18 |
| LoRA x Kev + margin gate tau 0.5 | 188 (94.0%) | 122/130 | 66/70 | 168 / 168 (eff 172 / 172) | +24/-5 (0.00027) | 193 (96.5%); messy 125/130, plain 68/70 | 15/220 (6.8%) | 9 | 17/20, 18 |

# Rig results: f-kevft

Headline temperatures: **explicit**. Explicit: T_lora 2.08, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

Excluded at run start (0 item(s), dedup normalize + leak_hit, threshold 0.5): rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3 -> no hit; train-utterances-round11.jsonl:* -> no hit; train-utterances-kevft.jsonl:* -> no hit

### explicit (headline): T_lora 2.08, T_kev 4.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 181 / 181

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 181 (90.5%) | 116/130 | 65/70 | 165 / 165 | - | 181 (90.5%) | 0/220 (0.0%) | 22 | 17/20, 17 |
| Kev alone (LoRA none rule) | 185 (92.5%) | 119/130 | 66/70 | 169 / 169 | +13/-9 (0.26) | 185 (92.5%) | 0/220 (0.0%) | 18 | 17/20, 17 |
| LoRA x Kev (equal-weight PoE) | 192 (96.0%) | 124/130 | 68/70 | 174 / 174 | +12/-1 (0.0017) | 192 (96.0%) | 0/220 (0.0%) | 11 | 17/20, 17 |
| LoRA x Kev + margin gate tau 0.5 | 192 (96.0%) | 124/130 | 68/70 | 174 / 174 (eff 179 / 179) | +12/-1 (0.0017) | 197 (98.5%); messy 128/130, plain 69/70 | 30/220 (13.6%) | 3 | 17/20, 17 |

### frozen: T_lora 1.8, T_kev 1.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 181 / 181

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 181 (90.5%) | 116/130 | 65/70 | 165 / 165 | - | 181 (90.5%) | 0/220 (0.0%) | 22 | 17/20, 17 |
| Kev alone (LoRA none rule) | 185 (92.5%) | 119/130 | 66/70 | 169 / 169 | +13/-9 (0.26) | 185 (92.5%) | 0/220 (0.0%) | 18 | 17/20, 17 |
| LoRA x Kev (equal-weight PoE) | 190 (95.0%) | 123/130 | 67/70 | 173 / 173 | +12/-3 (0.018) | 190 (95.0%) | 0/220 (0.0%) | 13 | 17/20, 17 |
| LoRA x Kev + margin gate tau 0.5 | 190 (95.0%) | 123/130 | 67/70 | 173 / 173 (eff 177 / 177) | +12/-3 (0.018) | 195 (97.5%); messy 127/130, plain 68/70 | 12/220 (5.5%) | 6 | 17/20, 17 |

# Rig results: x5-kevft-full

Headline temperatures: **explicit**. Explicit: T_lora 1.63, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

### explicit (headline): T_lora 1.63, T_kev 4.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 179 / 179

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 169 (84.5%) | 105/130 | 64/70 | 153 / 153 | - | 169 (84.5%) | 0/220 (0.0%) | 34 | 17/20, 18 |
| Kev alone (LoRA none rule) | 184 (92.0%) | 118/130 | 66/70 | 165 / 165 | +23/-8 (0.0053) | 184 (92.0%) | 0/220 (0.0%) | 19 | 17/20, 18 |
| LoRA x Kev (equal-weight PoE) | 187 (93.5%) | 119/130 | 68/70 | 167 / 167 | +19/-1 (2e-05) | 187 (93.5%) | 0/220 (0.0%) | 16 | 17/20, 18 |
| LoRA x Kev + margin gate tau 0.5 | 187 (93.5%) | 119/130 | 68/70 | 167 / 167 (eff 175 / 175) | +19/-1 (2e-05) | 196 (98.0%); messy 126/130, plain 70/70 | 35/220 (15.9%) | 6 | 17/20, 18 |

### frozen: T_lora 1.8, T_kev 1.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 179 / 179

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 169 (84.5%) | 105/130 | 64/70 | 153 / 153 | - | 169 (84.5%) | 0/220 (0.0%) | 34 | 17/20, 18 |
| Kev alone (LoRA none rule) | 184 (92.0%) | 118/130 | 66/70 | 165 / 165 | +23/-8 (0.0053) | 184 (92.0%) | 0/220 (0.0%) | 19 | 17/20, 18 |
| LoRA x Kev (equal-weight PoE) | 188 (94.0%) | 122/130 | 66/70 | 168 / 168 | +24/-5 (0.00027) | 188 (94.0%) | 0/220 (0.0%) | 15 | 17/20, 18 |
| LoRA x Kev + margin gate tau 0.5 | 188 (94.0%) | 122/130 | 66/70 | 168 / 168 (eff 172 / 172) | +24/-5 (0.00027) | 193 (96.5%); messy 125/130, plain 68/70 | 15/220 (6.8%) | 9 | 17/20, 18 |

# Rig results: f-kevft-full

Headline temperatures: **explicit**. Explicit: T_lora 2.08, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

### explicit (headline): T_lora 2.08, T_kev 4.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 181 / 181

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 181 (90.5%) | 116/130 | 65/70 | 165 / 165 | - | 181 (90.5%) | 0/220 (0.0%) | 22 | 17/20, 17 |
| Kev alone (LoRA none rule) | 185 (92.5%) | 119/130 | 66/70 | 169 / 169 | +13/-9 (0.26) | 185 (92.5%) | 0/220 (0.0%) | 18 | 17/20, 17 |
| LoRA x Kev (equal-weight PoE) | 192 (96.0%) | 124/130 | 68/70 | 174 / 174 | +12/-1 (0.0017) | 192 (96.0%) | 0/220 (0.0%) | 11 | 17/20, 17 |
| LoRA x Kev + margin gate tau 0.5 | 192 (96.0%) | 124/130 | 68/70 | 174 / 174 (eff 179 / 179) | +12/-1 (0.0017) | 197 (98.5%); messy 128/130, plain 69/70 | 30/220 (13.6%) | 3 | 17/20, 17 |

### frozen: T_lora 1.8, T_kev 1.0

200 single-action, 20 no-action, 0 multi; fully-correct over 200 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 181 / 181

| Config | Op /200 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 181 (90.5%) | 116/130 | 65/70 | 165 / 165 | - | 181 (90.5%) | 0/220 (0.0%) | 22 | 17/20, 17 |
| Kev alone (LoRA none rule) | 185 (92.5%) | 119/130 | 66/70 | 169 / 169 | +13/-9 (0.26) | 185 (92.5%) | 0/220 (0.0%) | 18 | 17/20, 17 |
| LoRA x Kev (equal-weight PoE) | 190 (95.0%) | 123/130 | 67/70 | 173 / 173 | +12/-3 (0.018) | 190 (95.0%) | 0/220 (0.0%) | 13 | 17/20, 17 |
| LoRA x Kev + margin gate tau 0.5 | 190 (95.0%) | 123/130 | 67/70 | 173 / 173 (eff 177 / 177) | +12/-3 (0.018) | 195 (97.5%); messy 127/130, plain 68/70 | 12/220 (5.5%) | 6 | 17/20, 17 |

