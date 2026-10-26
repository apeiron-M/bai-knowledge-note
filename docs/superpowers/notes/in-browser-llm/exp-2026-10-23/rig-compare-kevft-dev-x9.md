# Kev-FT (Kev-0.8B fine-tuned on Round 10, arm E) on dev, x9 args, dev-cv temps, vs zero-shot Kev

Run 2026-10-26 on this Mac (inference only; load average 6–26 from other jobs). Nothing under `exp/blind/` was read and
held-out-5 was not run. Dev only: Kev-FT was trained on Round 10 rows and calibrated on the Round 10 val split, so the
teacher val (`--temps refit`) is contaminated for it and is not used.

## Setup

- **Kev-FT GGUF:** `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`, sha256
  `30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23` (verified; matches the overnight REPORT).
  The rig read servedT **2.7007** from `qwen35.decision.temperature.choice` (`gguf_meta.py`).
- **Zero-shot Kev:** `x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf` (`64f479de…`, servedT 2.3511). Its dev-cv numbers are the
  stored `validation/v2/ev-{r8,x1,x5}-kevq4-dev` evaluations (README re-validation).
- **Option text / prompt:** unchanged from zero-shot Kev, i.e. frozen `decide.mjs --variant desc --wording W3` with
  `catalog.json` (`b257573b…`). This **is** the training format: `x4-kev/code/to_kev_jsonl.py` builds
  `state = "Request: <utterance>"`, the same W3 op instruction, criteria `human(opName): override` in catalog order, and
  `"answer a question"` with the same W3 none description. Checks:
  - The catalog sha is the same file the training data was built from.
  - All 228 dev candidate lists are the docType's **full** op list, as in training. No opName has a repeated `_`/`-` run, so
    Python's `human()` and JS's `human()` give identical names.
  - **One difference:** training records also carried the `noul` "change" question in the same record. The rig's one-stage
    call, which feeds the scores, sends the op choice alone. `decide.mjs` is frozen, so this was left as is.
- **Runs:** `validation/kevft-{x5,r8,x1}-dev`, each with
  `./rig.sh --lora <LoRA> --kev <Kev-FT> --set dev --args x9 --temps dev-cv --out validation/kevft-<m>-dev`.
  - The LoRA producers (`items`, `step1`, `args-x9`) were seeded from the stored `{x5,r8,x1}-kevq4-dev` runs and resumed
    (README v2 validated this path). Kev was scored fresh.
  - `table.py` asserts the LoRA picks, options and trie scores are identical to the zero-shot rows, item for item. The dev-cv
    T_L reproduces 1.63 / 2.184 / 1.711 exactly.
  - All three runs exited 0 with frozen shas OK. llama.cpp is `46ca246`.
- **Kev-FT dev fit:** all-dev **T_K = 4.0** for all three runs, against 0.75 for zero-shot Kev. The fold fits are 3.75
  (test h3) and 4.25 (test h4). This is well inside the 0.25…10 grid, so the fit is not clipped.
  - `logprobsT1` already strips the served T, so both fits act on raw head logits. On human dev wording the FT model is
    **more overconfident than its Round 10 calibration indicated** (dev 4.0 vs the in-distribution 2.70). Zero-shot Kev goes
    the other way (served 2.35, dev 0.75).
  - Skipping the dev fit costs: under the frozen X7 pair (T_K 1.0), X5×Kev-FT's gate asks 11 and makes 17 wrong dispatches
    (eff 167), against 29 / 11 / 170 at dev-cv.

## Comparison (dev-cv block; gate = equal-weight PoE + τ 0.5 margin gate, fused top-3, LoRA none rule, optimistic user)

Op is /196 action items. Ask is /216 single + no-action. "Kev alone" is the argmax over non-none ops with **that LoRA's
none rule**, so it is paired within each LoRA's rows. "vs LoRA" is the rig's one-sided exact McNemar on op one-shot. LOSO =
fit on h3, test h4 and vice versa, summed; it is the honest gate estimate. The all-dev rows are in-sample.

| Run | Op /196 | nat/para | fully x9 STRICT / NORM | gold-in-choices | ask /216 | wrong | eff NORM (STRICT) | vs LoRA alone | NA tp |
|---|---|---|---|---|---|---|---|---|---|
| X5 alone | 175 | 93/82 | 159 / 159 | 175 | 0 | 29 | - | - | 12/20 |
| Kev alone (X5 none rule) | 161 | 86/75 | 150 / 150 | 161 | 0 | 43 | - | +10/-24 (p 1) | 12/20 |
| **Kev-FT alone (X5 none rule)** | **177** | 96/81 | 161 / 161 | 177 | 0 | 27 | - | +12/-10 (p 0.42) | 12/20 |
| X5×Kev PoE (1.63/0.75) | 179 | 95/84 | 164 / 164 | 179 | 0 | 25 | - | +10/-6 (p 0.23) | 12/20 |
| **X5×Kev-FT PoE (1.63/4.0)** | **183** | 95/88 | 165 / 165 | 183 | 0 | 21 | - | +10/-2 (p 0.019) | 12/20 |
| X5×Kev gate | 179 | 95/84 | 164 / 164 | 188 | 33 | 10 | 169 (169) | +10/-6 (p 0.23) | 12/20 |
| **X5×Kev-FT gate** | 183 | 95/88 | 165 / 165 | 189 | 29 | 11 | 170 (170) | +10/-2 (p 0.019) | 12/20 |
| X5×Kev gate LOSO | 179 | 95/84 | 164 / 164 | 188 | 34 | 10 | 169 (169) | +10/-6 (p 0.23) | 12/20 |
| **X5×Kev-FT gate LOSO** | 183 | 95/88 | 165 / 165 | **189** | **30** | **10** | **170 (170)** | +10/-2 (p 0.019) | 12/20 |
| R8 alone | 164 | 92/72 | 148 / 149 | 164 | 0 | 39 | - | - | 13/20 |
| Kev alone (R8 none rule) | 160 | 86/74 | 146 / 147 | 160 | 0 | 43 | - | +15/-19 (p 0.8) | 13/20 |
| Kev-FT alone (R8 none rule) | 176 | 96/80 | 157 / 158 | 176 | 0 | 27 | - | +17/-5 (p 0.0085) | 13/20 |
| R8×Kev PoE (2.184/0.75) | 178 | 95/83 | 160 / 161 | 178 | 0 | 25 | - | +16/-2 (p 0.00066) | 13/20 |
| R8×Kev-FT PoE (2.184/4.0) | 179 | 95/84 | 161 / 162 | 179 | 0 | 24 | - | +15/-0 (p 3.1e-05) | 13/20 |
| R8×Kev gate | 178 | 95/83 | 160 / 161 | 187 | 38 | 12 | 167 (166) | +16/-2 (p 0.00066) | 13/20 |
| R8×Kev-FT gate | 179 | 95/84 | 161 / 162 | 188 | 33 | 13 | 168 (167) | +15/-0 (p 3.1e-05) | 13/20 |
| R8×Kev gate LOSO | 178 | 95/83 | 160 / 161 | 187 | 38 | 12 | 167 (166) | +16/-2 (p 0.00066) | 13/20 |
| R8×Kev-FT gate LOSO | 179 | 95/84 | 161 / 162 | 188 | 32 | 13 | 168 (167) | +15/-0 (p 3.1e-05) | 13/20 |
| X1 alone | 173 | 95/78 | 156 / 157 | 173 | 0 | 28 | - | - | 15/20 |
| Kev alone (X1 none rule) | 159 | 86/73 | 147 / 148 | 159 | 0 | 42 | - | +7/-21 (p 1) | 15/20 |
| Kev-FT alone (X1 none rule) | 175 | 96/79 | 159 / 160 | 175 | 0 | 26 | - | +8/-6 (p 0.4) | 15/20 |
| X1×Kev PoE (1.711/0.75) | 176 | 96/80 | 159 / 160 | 176 | 0 | 25 | - | +7/-4 (p 0.27) | 15/20 |
| X1×Kev-FT PoE (1.711/4.0) | 177 | 96/81 | 161 / 162 | 177 | 0 | 24 | - | +7/-3 (p 0.17) | 15/20 |
| X1×Kev gate | 176 | 96/80 | 159 / 160 | 186 | 29 | 13 | 167 (166) | +7/-4 (p 0.27) | 15/20 |
| X1×Kev-FT gate | 177 | 96/81 | 161 / 162 | 190 | 23 | 10 | 170 (169) | +7/-3 (p 0.17) | 15/20 |
| X1×Kev gate LOSO | 176 | 96/80 | 159 / 160 | 186 | 29 | 13 | 167 (166) | +7/-4 (p 0.27) | 15/20 |
| X1×Kev-FT gate LOSO | 176 | 96/80 | 160 / 161 | 190 | 24 | 10 | 170 (169) | +7/-4 (p 0.27) | 15/20 |

The NA column is identical within each LoRA by construction: the none rule belongs to the LoRA.

Multi-action, gate pick in gold ops: X5×Kev-FT 10/12, R8×Kev-FT 10/12, X1×Kev-FT 12/12. Kev-FT alone gets 11/12 in each run.

## McNemar (one-sided exact, op one-shot, 196 action items; `evaluate.mcnemar`, same as the rig)

- **Kev-FT alone vs zero-shot Kev alone**, paired on X5's rows: **161 → 177, fixed 19 / broken 3, p = 0.00043.**
  - It is +19/−3 on the R8 and X1 rows as well, by construction: the 22 discordant items are identical across the three
    runs (checked), and none of them is a LoRA false-none, so the none rule never touches them.
  - Fixed: kn3-03, kn3-11, moc3-07, src3-02, src3-06, rc3-02, obs3-02, hr3-01, kn4-02, kn4-11, prj4-14, wbs4-07, vc4-06,
    src4-01, src4-02, src4-05, ten4-01, hr4-01, hr4-02.
  - Broken: wbs3-14, vc4-07, vc4-08.
  - Without the LoRA (Kev's own argmax incl. none): action 157 → 178 (+23/−2, p 1e-05), NA true positives 12 → 14/20, and
    false "none" on action items 13 → 0.
- **X5×Kev-FT vs X5 alone** (PoE, and the gate's dispatch): **175 → 183, +10/−2, p = 0.019**. With zero-shot Kev it was
  +10/−6, p = 0.23.
  - X5×Kev-FT PoE vs X5×Kev PoE: +5/−1, p = 0.11.
  - R8: +4/−3 (p 0.5). X1: +4/−3 (p 0.5).

## Latency (native llama-server Metal, `-c 8192` as in the rig, back-to-back on this Mac)

Method: 228 dev items through `decide.mjs`, alternating ZS, FT, ZS, FT. One warm-up call is not timed. The load average
rose from 9.5 to 26 during the runs because of other jobs.

| Run | one-stage ms median / p90 / max | two-stage ms median / p90 |
|---|---|---|
| Kev ZS #1 | 124 / 167 / 219 | 142 / 189 |
| Kev-FT #1 | 129 / 179 / 263 | 160 / 206 |
| Kev ZS #2 | 134 / 181 / 378 | 159 / 219 |
| Kev-FT #2 | 136 / 178 / 319 | 162 / 216 |

- **The two are at parity: about 130 ms per one-stage decision.** They have the same architecture and quant; the GGUFs are
  529.6 MB vs 529.6 MB.
- In the rig runs the one-stage median was 128.5 ms for FT vs 130 ms for ZS.
- The FT latency re-runs reproduce the rig's Kev-FT scores exactly (228/228 picks, max |Δp| 0).

## Reading

- **Kev-FT alone is now as good as the best LoRA alone.** It gets 177 vs X5's 175 (p 0.42 between them), against 161 for
  zero-shot Kev. That gain is large and significant.
- **Fusion:** X5×Kev-FT reaches op 183 and fully 165 (+4 op over X5×Kev), with fewer asks (LOSO 30 vs 34) and the same
  wrong count (10). LOSO gate eff NORM is 170 vs 169.
- With X1, the FT gate cuts wrong dispatches 13 → 10 and asks 29 → 24 (LOSO); eff is 167 → 170.
- R8 changes ≤ 1–2 items.
- Gate-level differences of 1–3 items are noise at n = 196. The robust findings are Kev-FT alone (+16 op) and X5×Kev-FT
  vs X5 becoming significant.
- **Caveats:**
  - Kev-FT and X1 share the Round 10 training rows. Those rows passed the Round 10 eval-leak filter against held-out-1..4,
    but no separate near-duplicate check of dev vs Kev-FT's `train.jsonl` was run here.
  - T_K 4.0 is fit on dev itself, so the all-dev rows are in-sample; use the LOSO rows. Fold fits are 3.75 / 4.25.
  - The noul-packing difference above is untested.
  - For a blind run, freeze T_L per LoRA (as before) and **T_K = 4.0** for Kev-FT, and run with `--temps explicit`.

Artifacts: `validation/kevft-{x5,r8,x1}-dev/` (rows, results, manifest, console logs);
`validation/kevft-compare/table.py` → `table.out`; `validation/kevft-compare/latency/` (`summ.py`, `summ.out`, raw jsonl,
`load.txt`).
