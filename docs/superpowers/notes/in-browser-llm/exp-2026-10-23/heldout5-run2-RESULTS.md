# Held-out-5, run 2: Pre-registration 2 results (blind evaluator)

Executed 2026-10-26 18:34-18:57 CDT, this Mac, native llama-server Metal (llama.cpp 46ca246), repo rev 5e9c3904, node v24.13.0, tsx 4.21.0.
This is the first held-out-5 execution of PREREGISTRATION-2 (a previous evaluator was stopped before writing any held-out-5 output).
Each block ran once. Nothing was rerun, resumed or retried, and no parameter was changed.

## Part A: integrity, procedure, deviations

- `x7-fusion/PREREGISTRATION-2.md` sha256 `798b289e...c333` matches the expected value and its sidecar. `x7-fusion/code/prereg2_analysis.py` sha256 `a36ce55b...3f4f773a19` matches §3.
- `blind/heldout5/heldout5-eval.json` sha256 `c472bbaa...354e` matches `heldout5-eval.json.sha256`. Every `rig.sh --prereg` block also re-verified the GGUF, set and `verify` shas (all ok).
- **§5 step 2 (dev parity) was already done before this evaluator started.** Someone else did the move to `prereg2-dev-freeze/` and the three dev reruns into `x7-fusion/prereg2-dev/` (phase.log 15:59-16:10, "all ok"); who did them is not recorded. This evaluator re-verified the parity before held-out-5 (outputs are in `parity-check/`):
  - The rows of all three dev runs equal the freeze rows: 228/228 ids, 0 pick and 0 args differences, max |d trie| 0, max |d Kev| 0.
  - The dev analysis equals the freeze `analysis-dev.json` and reproduces §10: A 175, B 183, C gio 189 / ask 29 / eff 170, D 182 / gio 190 / ask 24 / eff 169, K 164; H1 +10/-2 p 0.019; H2 +21/-2 p 3.3e-05.
- **Date rule (§7):** `today = 2026-10-23`, from the set's `conventions.today` as printed by items.py (items summary: n 180, 165 action, 15 no-action, 0 multi, 165 with step 2). The x9 path ran, so the `*-x6` fallback was **not** used. The eval file was not opened by this evaluator.
- **Exclusion (§4):** `rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3` hit **obs5-05** (score 0.55). The count of 1 equals `expect_excluded`. The same id was excluded in all three primary runs, leaving 164 action + 15 no-action. The full runs have 165 + 15 and no exclusion.
- Blocks run, in order, via `rig/rig.sh --prereg ../x7-fusion/PREREGISTRATION-2.md --prereg-run <name>`, all rc 0: x5-kevft, f-kevft, r8, x5-kevft-full, f-kevft-full, r8-full. Logs: `<name>.console.log`, `phase.log`, `<run>/logs/rig.log`. The rig logs contain no DEVIATION or WARN lines, and no row is missing.
- The analysis command ran once, verbatim from §5.6, from `exp/`, rc 0. Its within-run assertions passed. Outputs: `analysis.md` and `analysis.json`.
- **Expectation miss, logged and not fixed:** continuity max |d trie| between K and run-1 C1 is **0.0664 nat**, against the §5.6 expectation of <= 0.05. Everything else in that check matched: picks agree 180/180, gold agrees 180/180, op 135 = 135. No stop rule is attached to this check. The cause is not investigated here; one candidate is the pipeline difference between run 1's `lora-run.ts` and rig step1.
- Disclosure: before any run-2 result existed, this evaluator opened `heldout5-run1/out/categories-h5.json` to copy its category names. Doing so showed some run-1 C1 ids (ids only: no utterance, gold or output). None of them was used.
- `categories_b.py` was written before the first block finished. It imports the rig's `evaluate.decide` rather than re-implementing it, and it was run once, after the analysis, as a read-only reader over `x5-kevft/rows.jsonl`.
- Determinism, excluded run vs full run: x5, f and r8 each share 179 rows, with 0 pick differences, 0 args differences and max |d| 0. The only extra row in each full run is obs5-05.
- The R8 runs record T_kev 1.0. That is the rig's placeholder for a run without Kev, and it does not enter any K metric.

## Part B: primary view (exclusion applied; 164 action, 15 no-action; x9 args)

| Arm | Op one-shot | Wilson 95% | Fully NORM | Fully STRICT | Gold-in-choices | Ask /179 | Wrong | Eff NORM / STRICT | NA TP /15 |
|---|---|---|---|---|---|---|---|---|---|
| A: X5 | 139 (84.8%) | 78.5-89.5 | 125 | 124 | 139 | 0 | 28 | - | 12 |
| B: X5 x Kev-FT | 146 (89.0%) | 83.3-92.9 | 131 | 130 | 146 | 0 | 21 | - | 12 |
| C: B + gate | 146 (89.0%) | 83.3-92.9 | 131 | 130 | **162 (98.8%)** | **34 (19.0%)** | 3 | 142 / 141 | 12 |
| D: F x Kev-FT + gate | 152 (92.7%) | 87.7-95.8 | 142 | 142 | 163 (99.4%) | 31 (17.3%) | 2 | 151 / 151 | 12 |
| K: R8 | 134 (81.7%) | 75.1-86.9 | 113 | 111 | 134 | 0 | 33 | - | 12 |
| F alone (descr.) | 147 (89.6%) | 84.0-93.4 | 138 | 138 | 147 | 0 | 20 | - | 12 |
| F x Kev-FT PoE (descr.) | 152 (92.7%) | 87.7-95.8 | 142 | 142 | 152 | 0 | 15 | - | 12 |
| Kev-FT alone, X5 none rule (descr.) | 145 | | 130 | 129 | | 0 | 22 | - | 12 |
| Kev-FT alone, F none rule (descr.) | 145 | | 135 | 135 | | 0 | 22 | - | 12 |

### Hypotheses (primary)

- **H1, B > A: CONFIRMED.** Op +9/-2, one-sided exact McNemar p = 0.0327 (two-sided 0.0654). On fully NORM, a secondary measure: +8/-2, p 0.0547.
- **H2, B > K: CONFIRMED.** Op +18/-6, p = 0.0113 (two-sided 0.0227). On fully NORM: +24/-6, p 7.2e-04.
- **Holm**, which is reported but is not the decision rule: H2 p 0.0113 < 0.025 and H1 p 0.0327 < 0.05, so both survive.
- **H3, B op one-shot >= 90%: NOT MET.** 146/164 = 89.0%, Wilson 83.3-92.9. The lower bound does not clear 90%.
- **H4, gate C bars: MET.** Gold-in-choices 162/164 (98.8%, bar 92%). Ask 34/179 (19.0%, bar 30%).
  - C makes 3 wrong dispatches. For reference, A makes 28, B 21, K 33 and D 2.
  - C effective NORM is 142 and STRICT 141, against A fully NORM 125. That is +10.37 per 100 action items, paired +17/-0, p 7.6e-06.
- **H5, D vs C (descriptive):**

  | Measure | D | C |
  |---|---|---|
  | Op | 152 | 146 |
  | Fully NORM / STRICT | 142 / 142 | 131 / 130 |
  | Gold-in-choices | 163 | 162 |
  | Ask | 31 | 34 |
  | Wrong | 2 | 3 |
  | Effective NORM / STRICT | 151 / 151 | 142 / 141 |
  | No-action TP | 12 | 12 |

  Paired on op: +7/-1, two-sided p 0.0703. Paired on effective NORM: +10/-1, two-sided p 0.0117. No decision is attached.

**§9 decision rule:** H1 is confirmed and H4 is met, so the winner is **C (X5 x Kev-FT + gate)**, to be confirmed on held-out-6 under a separate registration. H2 is confirmed, so there is no red flag. D is not eligible on run 2.

### Splits (primary; op / fully NORM / gate gio / ask)

| Split | A op | B op | C gio | C ask | D op | K op |
|---|---|---|---|---|---|---|
| plain (66 action + 6 none) | 63 (95.5%) | 64 (97.0%) | 65 | 2/72 | 65 | 64 |
| messy (98 action + 9 none) | 76 (77.6%) | 82 (83.7%) | 97 | 32/107 | 87 | 70 |
| easy (34) | 34 | 34 | 34 | 0/34 | 34 | 34 |
| medium (68) | 62 | 64 | 67 | 7/68 | 67 | 60 |
| hard (62) | 43 (69.4%) | 48 (77.4%) | 61 | 25/62 | 51 | 40 |

Fully NORM: plain A 60, B 61, D 63, K 59. Messy A 65, B 70, D 79, K 54. Hard A 32, B 36, D 44, K 28.

C effective NORM: plain 62, messy 80, hard 44.

Style x difficulty cells are in `analysis.md`; the messy x hard cell has 58 items and dominates the errors. Per-style ask is exploratory under §12; messy ask is 32/107 (29.9%).

### Arm B error categories (primary, ids only; `categories-B.json`)

- Op wrong (dispatched another op), 18: kn5-04, kn5-14, kn5-18, kn5-28, moc5-02, moc5-04, moc5-10, moc5-24, prj5-06, prj5-08, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-11, wbs5-12, vc5-12, src5-04
- Op wrong, dispatched none (false none): 0
- Op right, args wrong under x9 NORMALISED, 15: kn5-12, moc5-07, moc5-08, prj5-12, prj5-13, prj5-21, wbs5-03, wbs5-18, pq5-02, vc5-06, src5-01, rc5-02, obs5-02, ten5-02, der5-05
- Op right, args wrong STRICT but ok NORMALISED, 1: rc5-01
- No-action false positive, 3: none5-09, none5-13, none5-15 (the other 12 no-action items are true positives)

## Part C: secondary view (full set, 165 action + 15 no-action)

| Arm | Op | Fully NORM | Fully STRICT | Gold-in-choices | Ask /180 | Wrong | Eff NORM / STRICT |
|---|---|---|---|---|---|---|---|
| A | 140 (84.8%) | 126 | 125 | 140 | 0 | 28 | - |
| B | 147 (89.1%, 83.4-93.0) | 132 | 131 | 147 | 0 | 21 | - |
| C | 147 | 132 | 131 | 163 (98.8%) | 34 (18.9%) | 3 | 143 / 142 |
| D | 153 (92.7%) | 143 | 143 | 164 | 31 | 2 | 152 / 152 |
| K | 135 (81.8%) | 114 | 112 | 135 | 0 | 33 | - |

Hypotheses on the full set:

- H1: +9/-2, p 0.0327.
- H2: +18/-6, p 0.0113.
- H3: 89.1%, not met.
- H4: met (163/165, 34/180).
- H5: op +7/-1, effective NORM +10/-1.

obs5-05 is op-correct for every arm.

## Continuity vs run 1

K's full-set picks agree with run 1's C1 on 180/180 items, and gold labels agree on 180/180. Op is 135/165 in both runs.

Max |d trie| is 0.0664 nat, which is above the expected 0.05 (Part A). K's fully-correct uses x9 args, so it is not comparable with run 1's base/ship numbers.

## Files

`analysis.md`, `analysis.json`, `categories-B.json` (with `categories_b.py`), `parity-check/`, `PROGRESS.log`, `phase.log`, `driver.sh`, and the per-run dirs, each with `results.md`, `results.json`, `rows.jsonl` and `manifest.json`. The rig's `results.md` for each run follows.


---

## Rig results.md: x5-kevft

# Rig results: x5-kevft

Headline temperatures: **explicit**. Explicit: T_lora 1.63, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

Excluded at run start (1 item(s), dedup normalize + leak_hit, threshold 0.5): rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3 -> obs5-05 (score 0.55)

### explicit (headline): T_lora 1.63, T_kev 4.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 143 / 144

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 139 (84.8%) | 76/98 | 63/66 | 124 / 125 | - | 139 (84.8%) | 0/179 (0.0%) | 28 | 12/15, 12 |
| Kev alone (LoRA none rule) | 145 (88.4%) | 80/98 | 65/66 | 129 / 130 | +14/-8 (0.14) | 145 (88.4%) | 0/179 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 146 (89.0%) | 82/98 | 64/66 | 130 / 131 | +9/-2 (0.033) | 146 (89.0%) | 0/179 (0.0%) | 21 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 146 (89.0%) | 82/98 | 64/66 | 130 / 131 (eff 141 / 142) | +9/-2 (0.033) | 162 (98.8%); messy 97/98, plain 65/66 | 34/179 (19.0%) | 3 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 143 / 144

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 139 (84.8%) | 76/98 | 63/66 | 124 / 125 | - | 139 (84.8%) | 0/179 (0.0%) | 28 | 12/15, 12 |
| Kev alone (LoRA none rule) | 145 (88.4%) | 80/98 | 65/66 | 129 / 130 | +14/-8 (0.14) | 145 (88.4%) | 0/179 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 150 (91.5%) | 85/98 | 65/66 | 133 / 134 | +15/-4 (0.0096) | 150 (91.5%) | 0/179 (0.0%) | 17 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 150 (91.5%) | 85/98 | 65/66 | 133 / 134 (eff 136 / 137) | +15/-4 (0.0096) | 156 (95.1%); messy 91/98, plain 65/66 | 13/179 (7.3%) | 9 | 12/15, 12 |

---

## Rig results.md: f-kevft

# Rig results: f-kevft

Headline temperatures: **explicit**. Explicit: T_lora 2.08, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

Excluded at run start (1 item(s), dedup normalize + leak_hit, threshold 0.5): rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3 -> obs5-05 (score 0.55)

### explicit (headline): T_lora 2.08, T_kev 4.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 151 / 151

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 147 (89.6%) | 81/98 | 66/66 | 138 / 138 | - | 147 (89.6%) | 0/179 (0.0%) | 20 | 12/15, 12 |
| Kev alone (LoRA none rule) | 145 (88.4%) | 80/98 | 65/66 | 135 / 135 | +14/-16 (0.71) | 145 (88.4%) | 0/179 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 152 (92.7%) | 87/98 | 65/66 | 142 / 142 | +11/-6 (0.17) | 152 (92.7%) | 0/179 (0.0%) | 15 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 152 (92.7%) | 87/98 | 65/66 | 142 / 142 (eff 151 / 151) | +11/-6 (0.17) | 163 (99.4%); messy 97/98, plain 66/66 | 31/179 (17.3%) | 2 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 151 / 151

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 147 (89.6%) | 81/98 | 66/66 | 138 / 138 | - | 147 (89.6%) | 0/179 (0.0%) | 20 | 12/15, 12 |
| Kev alone (LoRA none rule) | 145 (88.4%) | 80/98 | 65/66 | 135 / 135 | +14/-16 (0.71) | 145 (88.4%) | 0/179 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 150 (91.5%) | 85/98 | 65/66 | 140 / 140 | +13/-10 (0.34) | 150 (91.5%) | 0/179 (0.0%) | 17 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 150 (91.5%) | 85/98 | 65/66 | 140 / 140 (eff 144 / 144) | +13/-10 (0.34) | 155 (94.5%); messy 90/98, plain 65/66 | 12/179 (6.7%) | 10 | 12/15, 12 |

---

## Rig results.md: r8

# Rig results: r8

Headline temperatures: **explicit**. Explicit: T_lora 2.184, T_kev 1.0.
Missing rows: 0. Floored trie children: 0.

Excluded at run start (1 item(s), dedup normalize + leak_hit, threshold 0.5): rows-kept.jsonl:gen-observation--IMPLEMENT_OBSERVATION-1-3 -> obs5-05 (score 0.55)

### explicit (headline): T_lora 2.184, T_kev 1.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 131 / 133

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 134 (81.7%) | 70/98 | 64/66 | 111 / 113 | - | 134 (81.7%) | 0/179 (0.0%) | 33 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

164 single-action, 15 no-action, 0 multi; fully-correct over 164 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 131 / 133

| Config | Op /164 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 134 (81.7%) | 70/98 | 64/66 | 111 / 113 | - | 134 (81.7%) | 0/179 (0.0%) | 33 | 12/15, 12 |

---

## Rig results.md: x5-kevft-full

# Rig results: x5-kevft-full

Headline temperatures: **explicit**. Explicit: T_lora 1.63, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

### explicit (headline): T_lora 1.63, T_kev 4.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 144 / 145

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 140 (84.8%) | 76/98 | 64/67 | 125 / 126 | - | 140 (84.8%) | 0/180 (0.0%) | 28 | 12/15, 12 |
| Kev alone (LoRA none rule) | 146 (88.5%) | 80/98 | 66/67 | 130 / 131 | +14/-8 (0.14) | 146 (88.5%) | 0/180 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 147 (89.1%) | 82/98 | 65/67 | 131 / 132 | +9/-2 (0.033) | 147 (89.1%) | 0/180 (0.0%) | 21 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 147 (89.1%) | 82/98 | 65/67 | 131 / 132 (eff 142 / 143) | +9/-2 (0.033) | 163 (98.8%); messy 97/98, plain 66/67 | 34/180 (18.9%) | 3 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 144 / 145

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 140 (84.8%) | 76/98 | 64/67 | 125 / 126 | - | 140 (84.8%) | 0/180 (0.0%) | 28 | 12/15, 12 |
| Kev alone (LoRA none rule) | 146 (88.5%) | 80/98 | 66/67 | 130 / 131 | +14/-8 (0.14) | 146 (88.5%) | 0/180 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 151 (91.5%) | 85/98 | 66/67 | 134 / 135 | +15/-4 (0.0096) | 151 (91.5%) | 0/180 (0.0%) | 17 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 151 (91.5%) | 85/98 | 66/67 | 134 / 135 (eff 137 / 138) | +15/-4 (0.0096) | 157 (95.2%); messy 91/98, plain 66/67 | 13/180 (7.2%) | 9 | 12/15, 12 |

---

## Rig results.md: f-kevft-full

# Rig results: f-kevft-full

Headline temperatures: **explicit**. Explicit: T_lora 2.08, T_kev 4.0.
Missing rows: 0. Floored trie children: 0.

### explicit (headline): T_lora 2.08, T_kev 4.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 152 / 152

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 148 (89.7%) | 81/98 | 67/67 | 139 / 139 | - | 148 (89.7%) | 0/180 (0.0%) | 20 | 12/15, 12 |
| Kev alone (LoRA none rule) | 146 (88.5%) | 80/98 | 66/67 | 136 / 136 | +14/-16 (0.71) | 146 (88.5%) | 0/180 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 153 (92.7%) | 87/98 | 66/67 | 143 / 143 | +11/-6 (0.17) | 153 (92.7%) | 0/180 (0.0%) | 15 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 153 (92.7%) | 87/98 | 66/67 | 143 / 143 (eff 152 / 152) | +11/-6 (0.17) | 164 (99.4%); messy 97/98, plain 67/67 | 31/180 (17.2%) | 2 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 152 / 152

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 148 (89.7%) | 81/98 | 67/67 | 139 / 139 | - | 148 (89.7%) | 0/180 (0.0%) | 20 | 12/15, 12 |
| Kev alone (LoRA none rule) | 146 (88.5%) | 80/98 | 66/67 | 136 / 136 | +14/-16 (0.71) | 146 (88.5%) | 0/180 (0.0%) | 22 | 12/15, 12 |
| LoRA x Kev (equal-weight PoE) | 151 (91.5%) | 85/98 | 66/67 | 141 / 141 | +13/-10 (0.34) | 151 (91.5%) | 0/180 (0.0%) | 17 | 12/15, 12 |
| LoRA x Kev + margin gate tau 0.5 | 151 (91.5%) | 85/98 | 66/67 | 141 / 141 (eff 145 / 145) | +13/-10 (0.34) | 156 (94.5%); messy 90/98, plain 66/67 | 12/180 (6.7%) | 10 | 12/15, 12 |

---

## Rig results.md: r8-full

# Rig results: r8-full

Headline temperatures: **explicit**. Explicit: T_lora 2.184, T_kev 1.0.
Missing rows: 0. Floored trie children: 0.

### explicit (headline): T_lora 2.184, T_kev 1.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 132 / 134

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 135 (81.8%) | 70/98 | 65/67 | 112 / 114 | - | 135 (81.8%) | 0/180 (0.0%) | 33 | 12/15, 12 |

### frozen: T_lora 1.8, T_kev 1.0

165 single-action, 15 no-action, 0 multi; fully-correct over 165 items with step-2 labels. Args on the gold op (STRICT / NORM): x9 132 / 134

| Config | Op /165 | op messy | op plain | fully x9 STRICT / NORM | vs LoRA (p) | gold-in-choices | ask | wrong | NA tp / predNone |
|---|---|---|---|---|---|---|---|---|---|
| LoRA alone | 135 (81.8%) | 70/98 | 65/67 | 112 / 114 | - | 135 (81.8%) | 0/180 (0.0%) | 33 | 12/15, 12 |
