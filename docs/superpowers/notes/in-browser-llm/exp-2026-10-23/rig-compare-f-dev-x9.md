# Arm F (LFM2.5-1.2B LoRA on Round 11 paraphrase data) on dev, x9 args, dev-cv temps, alone and × Kev-FT

Run 2026-10-26 on this Mac (inference only). Nothing under `exp/blind/` was read and held-out-5 was not run. Dev only.

## F: training, merge, export

- **Training** (Constantine, screen `f-train`, 08:45:40–12:47:46 CDT, `EXIT 0`, 0 resumes, no Traceback, no watchdog LIMIT):
  X1's command verbatim with the round11-para data (13,547 seq, sha `1c4718d3…`; val 377, `1aa6b1c5…`), base
  LFM2.5-1.2B-Instruct, 2 epochs / 848 steps, b8×ga4, r16/α32, LR 2e-4, bf16, seed 42. Code shas identical to X1's
  `run-code.sha`. 241.2 min train wall (X1: 132.6 min for 450 steps). Watchdog peak footprint 23 GiB (cap 32 GiB);
  mpsDriverPeakSampledGB 20.3. Loss 1.524 → 0.000163. Val loss 0.0596@25 → **0.00787@848 (final = min)**; X1 final 0.00932, X5 0.01371.
- **Merge** (Constantine, `merge.py --base training/models/LFM2.5-1.2B-Instruct --check round11-para/val.jsonl --check-rows 16`):
  35.2 s; 16 rows / 4,120 tokens, max |Δ logit| 4.8e-4, argmax agrees on every token (X1: 7.7e-4).
  Adapter sha256 `4e32e6d58fe6660530a6a8965b83f4c62c6e4efaeed6f007772053f9f26040ef`.
- **Copy-back:** `training/artifacts/f-1p2b-r11/remote/` (adapter, merged, train stats/log, merge log, watchdog slice,
  run-code.sha; checkpoints left on Constantine). `SHA256SUMS` 18/18 OK.
- **Export** (`training/scripts/export-gguf.sh`, llama.cpp 46ca246 = tag b11364): chat template byte-identical to X1's.
  - `training/artifacts/f-1p2b-r11/gguf/LFM2.5-1.2B-Instruct-vault-fa-20261026-Q4_K_M.gguf`: **730,896,096 B**, sha256
    `59a5da2055e5fd2c2643a7f536a46edc2194356d56fac19724a5d86028376269`
  - `…-BF16.gguf`: 2,343,327,456 B, sha256 `ee70f55e05d09e47debf2e4e89e0be113ca6ab153a862df82b7b73926fd259e9`

## Native val check (Round 10 val, 377 steps; `smoke_infer.py`, llama-server b11364, temp 0, runtime grammars)

| GGUF | Step 1 exact | Step 2 exact | Median wall (all steps) |
|---|---|---|---|
| **F Q4_K_M** | **222/228 (97.4%)** | **140/149 (94.0%)** | 132 ms |
| X1 Q4_K_M (stored) | 217/228 (95.2%) | 139/149 (93.3%) | 280 ms (other load) |
| X5 Q4_K_M (stored) | 214/228 (93.9%) | 136/149 (91.3%) | 52 ms |

F vs X1: step 1 +6/−1, step 2 +3/−2. F vs X5: step 1 +9/−1, step 2 +9/−5. This val split is in-distribution
teacher wording (the training split's held-out rows), not human wording. Files: `exp/f-1p2b/val-native-f.{json,log}`, `exp/f-1p2b/valcmp.py`.

## Dev run

`./rig.sh --lora <F Q4_K_M> --kev training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf --set dev --args x9 --temps dev-cv --out validation/f-kevft-dev`
(fresh inference, all producers; exit 0, frozen shas OK, load average 5–7). Kev-FT sha `30b5796e…` verified; servedT 2.7007.
X5/X1 rows are the stored `kevft-x5-dev` / `kevft-x1-dev` runs (same Kev-FT GGUF; Kev-FT scores are identical across
the three runs, max |Δ| 0). F's dev-cv fit: **T_L 2.08**, T_K 4.0; folds test h3 2.08/3.75, test h4 1.981/4.25.

## Comparison (dev-cv block; gate = equal-weight PoE + τ 0.5 margin gate, fused top-3, LoRA none rule, optimistic user)

Op is /196 action items; ask /216 single + no-action. LOSO = fit on h3 test h4 and vice versa, summed (the honest gate
estimate). "vs LoRA alone" is the rig's one-sided exact McNemar on op.

| Run | Op /196 | nat/para | fully x9 STRICT / NORM | gold-in-choices | ask /216 | wrong | eff NORM (STRICT) | vs LoRA alone | NA tp |
|---|---|---|---|---|---|---|---|---|---|
| **F alone** | **176** | 95/81 | 160 / 160 | 176 | 0 | 26 | - | - | 14/20 |
| Kev-FT alone (F none rule) | 176 | 96/80 | 158 / 158 | 176 | 0 | 26 | - | +9/-9 (p 0.59) | 14/20 |
| F×Kev-FT PoE (2.08/4.0) | 182 | 96/86 | 163 / 163 | 182 | 0 | 20 | - | +8/-2 (p 0.055) | 14/20 |
| F×Kev-FT gate | 182 | 96/86 | 163 / 163 | 190 | 24 | 10 | 169 (169) | +8/-2 (p 0.055) | 14/20 |
| **F×Kev-FT gate LOSO** | 182 | 96/86 | 163 / 163 | **190** | **25** | **10** | **169 (169)** | +8/-2 (p 0.055) | 14/20 |
| X5 alone | 175 | 93/82 | 159 / 159 | 175 | 0 | 29 | - | - | 12/20 |
| Kev-FT alone (X5 none rule) | 177 | 96/81 | 161 / 161 | 177 | 0 | 27 | - | +12/-10 (p 0.42) | 12/20 |
| X5×Kev-FT PoE (1.63/4.0) | 183 | 95/88 | 165 / 165 | 183 | 0 | 21 | - | +10/-2 (p 0.019) | 12/20 |
| X5×Kev-FT gate | 183 | 95/88 | 165 / 165 | 189 | 29 | 11 | 170 (170) | +10/-2 (p 0.019) | 12/20 |
| X5×Kev-FT gate LOSO | 183 | 95/88 | 165 / 165 | 189 | 30 | 10 | 170 (170) | +10/-2 (p 0.019) | 12/20 |
| X1 alone | 173 | 95/78 | 156 / 157 | 173 | 0 | 28 | - | - | 15/20 |
| Kev-FT alone (X1 none rule) | 175 | 96/79 | 159 / 160 | 175 | 0 | 26 | - | +8/-6 (p 0.4) | 15/20 |
| X1×Kev-FT PoE (1.711/4.0) | 177 | 96/81 | 161 / 162 | 177 | 0 | 24 | - | +7/-3 (p 0.17) | 15/20 |
| X1×Kev-FT gate | 177 | 96/81 | 161 / 162 | 190 | 23 | 10 | 170 (169) | +7/-3 (p 0.17) | 15/20 |
| X1×Kev-FT gate LOSO | 176 | 96/80 | 160 / 161 | 190 | 24 | 10 | 170 (169) | +7/-4 (p 0.27) | 15/20 |

Args on the gold op (x9, STRICT / NORM): F 175 / 175, X5 175 / 175, X1 173 / 174.
LoRA false "none" on action items: F 2, X5 1, X1 3. Multi-action gate pick in gold ops: F 11/12, X5 10/12, X1 12/12.

## McNemar (exact, op one-shot, 196 action items, paired on item id; `evaluate.mcnemar`; gold/multi asserted equal)

| Comparison | op | F fixes / breaks | one-sided p (F better) | (F worse) |
|---|---|---|---|---|
| **F alone vs X5 alone** | 175 → 176 | +10 / −9 | 0.50 | 0.68 |
| **F×Kev-FT vs X5×Kev-FT** (PoE = gate dispatch) | 183 → 182 | +2 / −3 | 0.81 | 0.50 |
| F alone vs X1 alone | 173 → 176 | +11 / −8 | 0.32 | 0.82 |
| F×Kev-FT vs X1×Kev-FT | 177 → 182 | +6 / −1 | 0.063 | 0.99 |

- F vs X5 alone, F fixes: kn4-02, kn4-14, moc4-03, pq4-02, pq4-08, prj3-15, prj4-03, vc3-04, vc3-08, wbs4-04; breaks:
  der3-02, der4-02, kn3-08, moc3-01, moc3-08, prj3-05, prj4-18, ten4-03, wbs3-05.
- F×Kev-FT vs X5×Kev-FT, fixes kn3-16, vc3-08; breaks moc3-08, ten4-03, wbs3-05.

## Native latency (rig step timings, LoRA-only runs back to back on this Mac, 13:04–13:11, load average 5.6–9.2)

`validation/latency-b2b2-{f,x1,x5}` (`--temps frozen`, LoRA only); each reproduces its model's stored picks 228/228 and
trie scores exactly.

| Model | step-1 gen ms med / p90 | exact trie ms med / p90 | step 1 total med | step-2 wall ms med / p90 |
|---|---|---|---|---|
| F 1.2B | 140 / 185 | 468 / 593 | 620 | 106 / 175 |
| X1 1.2B | 138 / 177 | 460 / 588 | 608 | 107 / 175 |
| X5 350M | 58 / 69 | 272 / 337 | 334 | 50 / 83 |

F = X1 in latency (same architecture and quant, 730.9 MB each); both are ~1.9× X5 on step 1 and ~2.1× on step 2.
Kev-FT adds ~130 ms per decision (compare-kevft-dev-x9.md). In the main rig run F measured 146 / 483 / 630 / 128.

## Reading

- **Round 11 data lifts the 1.2B on teacher val but barely on dev, the reverse of the 350M.** On teacher val X1 → F is
  217 → 222 step 1 (+6/−1); on dev F alone (176) is only +3 over X1 (173, p 0.32) and +1 over X5 (175, p 0.5), with large,
  balanced discordant sets (+10/−9 vs X5). For the 350M, r10a → X5 was a wash on teacher val (214 → 214, +10/−11) and the
  gain showed on dev (R8 164 → X5 175; that spans Round 8 → Round 11, since r10a has no dev run). Most of F's dev gain over X1
  is paraphrase wording (81 vs 78).
- **Fused, F×Kev-FT is not better than X5×Kev-FT:** op 182 vs 183 (+2/−3), fully 163 vs 165, LOSO gate eff NORM 169 vs
  170, ask 25 vs 30, wrong 10 vs 10, gold-in-choices 190 vs 189. All within 1–5 items, i.e. noise at n = 196.
- F has the best native val (97.4% step 1), ties X5 on args-on-gold (175), and has the highest dev-cv T_L (2.08, i.e. most
  overconfident on human wording) of the three LoRAs.
- **At ~1.9× X5's latency and 3.2× its size (731 vs 229 MB) with no dev gain, F does not displace X5.** For a blind run,
  freeze T_L 2.08 / T_K 4.0 for F×Kev-FT if it is kept as an arm.
- Caveats: dev is the tuning set (T fits are in-sample except LOSO); n = 196; no near-duplicate check of dev against
  round11 beyond the round11 build's own leak filter.

Artifacts: `validation/f-kevft-dev/` (+ `.console.log`, `.load.txt`), `validation/f-compare/table.py` → `table.out`,
`mcnemar.json`; `validation/latency-b2b2-{f,x1,x5}/` (+ `latency-b2b2.load.txt`).

## Addendum: X12 (LFM2.5-350M on Round 12 data), added 2026-10-26 15:30 CDT

Launched at the coordinator's request once F had exited and F's merge had finished (no overlap with F's merge).
- **Training** (Constantine, screen `x12-train`, 12:55:02–15:20:45, `EXIT 0`, 0 resumes, no Traceback/LIMIT): X5's command
  verbatim (`launch.sh … --epochs 2 --batch 8 --grad-accum 4 --save-steps 50 --save-limit 2`, default 350M base, r16/α32,
  LR 2e-4, bf16, seed 42; code shas identical to X5's) on `round12-para/train-split.jsonl` (19,916 seq, sha `525da1d6…`,
  verified) with val `1aa6b1c5…` (verified). 1,246 steps, 145.3 min. Peak footprint 17 GiB. Val loss 0.1098@25 → min
  0.01174@1150, final 0.01193 (X5 final 0.01371).
- **Merge** on Constantine (deviation: X5 merged on this Mac; same `merge.py`, pre-armed under caffeinate so the box could
  not sleep): 16.7 s, 16 rows / 4,120 tokens, max |Δ logit| 4.3e-4, argmax agrees. Adapter `bd2644ae…4b14`.
  `training/artifacts/x12-350m/remote/`, SHA256SUMS 18/18 OK.
- **GGUF:** `training/artifacts/x12-350m/gguf/LFM2.5-350M-vault-x12a-20261026-Q4_K_M.gguf` **229,312,224 B**, sha256
  `9209b318e72974342da133ee1988747dd029fd5940efd37d33dc14d6e09b6e6d` (BF16 `9393605b…f439`); template identical to X5's.
- **Native val:** step 1 **215/228 (94.3%)**, step 2 **138/149 (92.6%)** (X5 214 / 136: +3/−2 and +5/−3).
- **Dev** (`validation/x12-kevft-dev`, same rig command; load average 16–24 from other jobs). dev-cv T_L **1.797**, T_K 4.0;
  folds test h3 1.981/3.75, test h4 1.63/4.25. Args on gold op 171 / 172.

| Run | Op /196 | nat/para | fully x9 STRICT / NORM | gold-in-choices | ask /216 | wrong | eff NORM (STRICT) | vs LoRA alone | NA tp |
|---|---|---|---|---|---|---|---|---|---|
| X12 alone | 174 | 90/84 | 153 / 154 | 174 | 0 | 27 | - | - | 15/20 |
| Kev-FT alone (X12 none rule) | 177 | 96/81 | 156 / 157 | 177 | 0 | 24 | - | +11/-8 (p 0.32) | 15/20 |
| X12×Kev-FT PoE (1.797/4.0) | 180 | 94/86 | 159 / 160 | 180 | 0 | 21 | - | +8/-2 (p 0.055) | 15/20 |
| X12×Kev-FT gate | 180 | 94/86 | 159 / 160 | 188 | 25 | 10 | 166 (165) | +8/-2 (p 0.055) | 15/20 |
| X12×Kev-FT gate LOSO | 180 | 94/86 | 159 / 160 | 188 | 24 | 10 | 166 (165) | +8/-2 (p 0.055) | 15/20 |

| Comparison (exact McNemar, op, paired on id) | op | X12 fixes / breaks | one-sided p (X12 better) | (X12 worse) |
|---|---|---|---|---|
| **X12 alone vs X5 alone** | 175 → 174 | +7 / −8 | 0.70 | 0.50 |
| **X12×Kev-FT vs X5×Kev-FT** | 183 → 180 | +1 / −4 | 0.97 | 0.19 |
| X12 alone vs F alone | 176 → 174 | +11 / −13 | 0.73 | 0.42 |
| X12×Kev-FT vs F×Kev-FT | 182 → 180 | +2 / −4 | 0.89 | 0.34 |

- X12 vs X5 alone, fixes: kn4-02, kn4-06, moc4-02, pq4-08, prj3-11, prj4-03, vc3-04; breaks: kn3-04, kn4-12, moc3-10,
  moc4-12, prj3-12, prj4-11, prj4-18, vc4-08.
- **Reading:** Round 12 data does not improve the 350M on dev. Op is flat (174 vs 175). Paraphrase wording is up (84 vs 82),
  but natural is down (90 vs 93) and args on the gold op are down (171 vs 175). Fused, it is 3 items worse than X5×Kev-FT
  (180 vs 183; LOSO eff NORM 166 vs 170). Native val is marginally up. All differences are within noise at n = 196; the
  direction does not favour X12.
- Latency: X12 has the same architecture, quant and size as X5 (229.3 MB), so its latency is X5's. No separate latency run
  was made: load average was 16–24 at the time.
