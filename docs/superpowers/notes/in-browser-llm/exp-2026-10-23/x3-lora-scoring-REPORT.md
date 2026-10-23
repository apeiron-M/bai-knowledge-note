# X3: the Round 8 LoRA as a calibrated decision model

Status: done, 2026-10-23. Inference only, on this Mac. The run used native llama-server b11364 (commit 46ca246, the one wllama 3.8.1 pins) with Metal, `--no-jinja`, `-np 1` and `-c 4096`. Model: `LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf`, sha256 `6930e31e…510e00`, checked. The R2c pipeline is the repo code: `scoringMessages`, `step1Grammar`, `scoreOptions`, `fillArgsStep` + `V1_ARGS` and `scoreArgRow`. My code only adds a llama-server `CompleteJson`/`ScoreText` and the trie scorer.

**Data.** Dev only:
- held-out-3: 92 action, 10 no-action, 6 multi-action;
- held-out-4: 104 action, 10 no-action, 6 multi-action;
- Round 8 teacher val: the 168 full-list step-1 rows (150 action, 18 none). Fully-right on val counts only the 112 action rows that have a trainable step 2.

`exp/blind/` was not read. Every number below is a dev number. Any τ chosen here still needs a blind set.

**Numerics check vs the stored WebGPU runs.**
- Per-item picks agree on 108/108 (held-out-3) and 119/120 (held-out-4). The one differing item is pq4-06: WebGPU picked BLOCK_TASK, native picked FAIL_TASK, which is gold.
- Args-ok agrees on every item where both runs have the right op.
- So native K0 is held-out-3 79/92 op, 67/92 fully right (= R9 R2c), and held-out-4 85/104, 69/104 (E8 was 84 and 68). **K0 below is the native run's own pick.**

## 1. Fast scoring

Code: `lib.ts` (`trieScore`). Scored per item:
- every answer (each scoped op key plus `{"ops": []}`), as canonical token ids plus `<|im_end|>`;
- the prompt as **token ids**: BOS plus `/apply-template`, then `/tokenize`. These are byte-identical to the val `input_ids`;
- per trie node, one `/completion` request with `n_predict` 1 and `n_probs` 64 (a retry with 8192 was never needed: 0 floored).

| Method | Requests/item | Native latency, median / p90 | Agreement with exact (384 single-op items) |
|---|---|---|---|
| slow `scoreOptions` (spec S1) | 15 (one per answer) | 625 / 1025 ms (42 ms per answer) | top-1 383/384; top-2 ordered 348/384; top-3 set 295/384; Spearman median 0.86 |
| **trie, exact** (every internal node) | 103 | 327 / 629 ms | reference |
| **trie, branch-only** (nodes with ≥ 2 children) | 6 (max 10) | **41 / 69 ms** | top-1 383/384; top-2 ordered 369/384; top-3 set 348/384; Spearman median 0.999; prob-margin r = 0.9995 |
| free (top_logprobs=20 on the R2c generation) | 0 extra | 0 ms (generation 63 ms) | top-1 384/384; top-2 ordered 264/384; prob-margin r = 0.96 |

**Finding: the slow scorer is distorted.** The forced-literal grammar decodes greedily, so when the model dislikes an option it takes **non-canonical token splits**. This happens for 1,933 of 4,983 option scores, and those score a median of 13.5 nats lower than the canonical sequence. It touches an exact top-2 option in 39 cases.

Where the slow path *is* canonical, slow and trie agree to a max |Δ| of 4.6e-5 nats (bar: 1e-3). This is the token-id-prefix check, and it passes. **Recommend the canonical trie score (exact, or branch-only) as the product score.**

## 2. Rescore and normalisation (one-shot op)

Argmax of the full-list scores vs the generated pick:

| Set | K0 gen pick | exact sum | exact mean | slow sum | slow mean | branch | free |
|---|---|---|---|---|---|---|---|
| held-out-3 (natural / paraphrase) | 79/92 (44/45, 35/47) | 79 | 78 | 79 | 78 | 78 | 79 |
| held-out-4 (natural / paraphrase) | 85/104 (48/52, 37/52) | 85 | 85 | 85 | 85 | 85 | 85 |
| val | 134/150 | 135 | 135 | 134 | 134 | 135 | 135 |

- **Rescoring gives no gain.** Greedy generation already returns the sequence argmax on 383 of 384 items. Fully right is unchanged too (held-out-3 67, held-out-4 69, val 91 → 92 of 112).
- Length normalisation (mean) costs 1 item on held-out-3. As a calibration signal, mean is worse: it needs T≈0.2 and has a larger NLL. Its margin is not a probability.
- Gold within the exact top-3: held-out-3 89/92, held-out-4 99/104, val 148/150. Gold within the top-2: 87, 97 and 144.

## 3. Calibration

Softmax over the scoped answers of the exact sums:
- **Overconfident.** Items with p(pick) ≥ 0.99 are right only 93% of the time on held-out-3 (n=69) and held-out-4 (n=62), and 98% on val.
- Temperature fitted on one set and applied to the other: T = 2.18 (fitted on held-out-3 or held-out-4) or 1.80 (fitted on val).
  - NLL held-out-3→held-out-4 falls from 0.97 to 0.68, and ECE from 0.136 to 0.053.
  - held-out-4→held-out-3: NLL 0.83 → 0.59, ECE 0.100 → 0.071.
- A temperature barely changes how the gate ranks items. The ask-vs-coverage curves at T = 1 and T = 2.18 are the same within 1 item.
- **Errors no margin gate can catch** (pick p ≥ 0.99 and wrong): 2 on held-out-3, 2 on held-out-4, 3 on val. One more miss per held-out set has the pick `{"ops": []}`, which is never asked.

## 4. Margin gate and top-3 choice

The gate asks when the generated pick is not the top score, or when the margin is below τ. The choices are the pick plus the 2 best-scored ops from the shortlist. The shortlist is either the frame neighbours (`frames.json`: same verb or same entity, median 6) or all scoped ops. "Eff. fully right" assumes the user picks gold whenever it is offered, so it is **optimistic**.

**K1 as pre-registered** (slow mean margin, frame neighbours, τ = 0.2):

| Set | Gold in choices | Ask rate | Eff. fully right (optimistic) | Δ vs K0 per 100 | Wrong dispatches |
|---|---|---|---|---|---|
| held-out-3 | 83/92 (90.2%) | 23.9% | 70/92 | +3.3 | 3 |
| held-out-4 | 92/104 (88.5%) | 26.9% | 75/104 | +5.8 | 7 |
| val | 142/150 (94.7%) | 14.0% | 98/112 | +6.2 | 4 |

- Natural vs paraphrase: held-out-3 gold in choices is 97.8% vs 83.0%, ask rate 6.7% vs 40.4%. held-out-4: 98.1% vs 78.8%, ask rate 19.2% vs 34.6%.
- **K1 fails the gold-in-choices (≥ 92%) and +8 bars on both held-out sets.** It meets the ask bar (≤ 30%).
- Even when every item is asked (K3), the frame shortlist caps gold in choices at 91.3% on held-out-3 and 89.4% on held-out-4.

**Best variant: exact trie sum, probability margin, all-scoped shortlist** (`curve.py`; the oracle τ per set, as an upper bound). Each cell is gold in choices; the ≤ 30% row also gives Δ fully right per 100.

| Ask budget | held-out-3 | held-out-4 | val |
|---|---|---|---|
| ≤ 10% | 90.2% | 86.5% | 94.7% |
| ≤ 20% | 91.3% | 90.4% | 96.0% |
| ≤ 30% | 93.5% (+3.3) | 92.3% (+9.6) | 97.3% (+8.0) |

- Branch-only matches exact at every budget.
- Spec S1 (slow mean) with the all-scoped shortlist reaches 92.4% / 91.3% / 96.0% at ≤ 30%.
- The free variant reaches 91.3% / 88.5% / 96.7% at ≤ 30%.

**Cross-validated τ** (tuned on one set, reported on the other):
- held-out-3→held-out-4 (τ = 0.94): 92.3% gold in choices, but a **34.6%** ask rate; +9.6.
- held-out-4→held-out-3 (τ = 0.86): 91.3% gold in choices, 19.6% ask rate; +3.3.
- **No configuration meets all three K1 bars on both sets.** held-out-4 alone meets them in-sample (τ = 0.9: 92.3% / 29.8% / +9.6).

**Why held-out-3 caps at +3.3.** Only 6 of its 13 op misses get exact args even with the gold op. The +8 bar is unreachable there through op choice alone, so step 2 sets the ceiling. On held-out-4, 15 of 19 misses get exact args with the gold op.

Gold rank among K0 misses (exact sum):
- held-out-3: rank 2 ×8, 3 ×2, 4 ×3;
- held-out-4: rank 2 ×12, 3 ×2, then ranks 4–11.

## 5. Export for fusion

`out/scores.jsonl` has one line per item (396). Fields:
- id, group, set, style, difficulty, docType;
- gold, goldOps, pick, candidates (including `none`);
- nTokens;
- `scores.{exact_sum, branch_sum, slow_sum, slow_mean, free_sum}` as op → logprob;
- argsOkIfGold.

**Use `exact_sum` or `branch_sum`.** Raw per-item rows (gen logprobs, per-token scores, step-2 results) are in `out/items.jsonl`.

## Files

- `lib.ts`, `run.ts`: native client, trie scorer and runner.
- `analyze.py`, `tables.py`, `curve.py`: analysis.
- `out/metrics.json`: every metric.
- `out/tables.md`: every sweep, including τ ∈ {0 … ∞} for each config.
- `out/curve.json`, `run.log`.

## Caveats

- Latency is native Metal, not the browser. Per answer, slow scoring took 42 ms here against 123–160 ms on WebGPU, so expect about 3× in the browser: roughly 120–200 ms for branch-only.
- Whether wllama `createCompletion` accepts token-id prompts is still unverified.
- The simulated user is optimistic.
- n is small: 13–19 misses per set.
