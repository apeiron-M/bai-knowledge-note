# X7 pre-registration: op decider + gate, one blind run on held-out-5

Frozen 2026-10-23, before anything under `exp/blind/` was read or run. X7 has not opened or listed held-out-5. Every parameter below was fixed from dev data: held-out-3, held-out-4 and the Round 8 teacher val. The sha256 of this file is in `PREREGISTRATION.sha256` next to it. Any edit after the blind run starts voids the registration.

## 1. The three configurations

All three share one set of model calls per item. They differ only in how the outputs are combined, and in which args pipeline is primary.

| | C1: control | C2: PoE one-shot | C3: PoE + margin gate |
|---|---|---|---|
| Op decision | LoRA R8 generated R2c pick | argmax over non-none ops of 0.5·log softmax(LoRA exact_sum / 1.80) + 0.5·log softmax(Kev logprobsT1 / 1.00) | same as C2 |
| No-action | the LoRA's `{"ops": []}`, never asked | identical to C1. If the LoRA says none, the dispatch is none and the fusion is skipped | identical to C1 |
| Ask | never | never | ask iff p₁ − p₂ < **0.50**, where p = softmax of the fused score over all options (scoped ops + none) and p₁, p₂ are the two best non-none ops |
| Offered when asked | – | – | fused top-3 non-none ops, by p, ties broken by catalog order; the user may also say "none of these" |
| Args (primary) | **baseline** v1 step 2 | **X6 ship patch** | **X6 ship patch** |
| Args (secondary) | ship patch | baseline | baseline |

The weights, both temperatures, τ, k = 3 and the none rule are frozen. Kev runs at **Q4_K_M**. The head (gte-small LR) is not used by any configuration.

## 2. Frozen artifacts

| Item | Value |
|---|---|
| LoRA | `training/artifacts/round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf`, sha256 `6930e31eefea9b27cafa5674f7be2679d3773a6819acf4ae4e56fbebcd510e00` |
| Kev | `exp/x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf`, sha256 `64f479de0a9ac921e2f5b941ff4549fff4b88588e0a31bf11462c552364746b1` (529,597,984 B) |
| Runtime | native `~/.cache/bai-training/llama.cpp/build/bin/llama-server`, llama.cpp commit `46ca246` (wllama 3.8.1 pin), Metal |
| LoRA server | `--no-jinja -np 1 -c 4096` |
| Kev server | `-c 8192` |
| Repo (step 1 + baseline step 2) | `5e9c39046dcd8f08951a308e66c610dbd4c55c73`: `scoringMessages`, `step1Grammar`, `fillArgsStep(V1_ARGS)`, `scoreArgRow` |
| LoRA trie scorer | `exp/x3-lora-scoring/lib.ts` `trieScore`, **exact** mode (every internal node, `n_probs` 64); sha256 `b48ff64f60d8e783039fc94646782e2a711011838e47fa180cb8273c217bd8de` |
| Kev decider | `exp/x4-kev/node/decide.mjs` (sha256 `feed74fe27548db6ab10b5fd5bc98f1b5fe6319d6edd1fa600696bb5e3df6004`) with `--runtime server --decider kev08q4 --variant desc --wording W3 --servedT 2.3510959148406982`. Uses `descField` override, `oneStage.logprobsT1` and catalog `exp/x4-kev/data/catalog.json` (sha256 `b257573b739778d14b3fabf1f7eb037164dc0390cd26abb272feba1e79135b70`) |
| Ship args | `exp/x6-args/patch/x6-args-ship.patch`, sha256 `8d29e48af703df3ac7a024d6d2df05ef8328c242c5abd491434fc1f03b84877f`, applied to the repo commit above |
| Evaluator | `exp/x7-fusion/code/prereg_eval.py`, sha256 `f981613b16001a1d080489b0f1feb78b55fa61092c164d567c49fb466ff61e3f` (stdlib only) |

**Candidates.** Each item gets its R2c scoped op list for the docType, in catalog order, plus `none`. The LoRA scores every option. Kev gets the same list, in the same order, with `__none__` last. The runner renames `__none__` to `none` when it writes the row. `prereg_eval.py` asserts that the LoRA scores, the Kev scores and `opts` all have the same key set, that `none` is last, and that `loraPick` is one of `opts`.

## 3. Run procedure (one run, no re-tuning)

For every held-out-5 item:
1. **LoRA step 1:** greedy R2c generation gives `loraPick`. The trie exact scores of every option give `loraExact`. Branch-only scores are also logged (exploratory).
2. **Kev:** the one-stage choice gives `kev_q4`.
3. **Step 2:** for every single-action item, step 2 runs on the **gold** op at temperature 0, once under the baseline pipeline and once under the ship patch.
   - Step 2 at T=0 depends only on the op. So fully-correct for any configuration = [dispatched op == gold] ∧ args_ok(gold op).
   - For a non-gold op, fully-correct is false.
4. Write the rows in the `prereg_eval.py` schema and run it once. Report every number it prints. Deviations (crashes, retries, missing items) get logged, never silently fixed.

**Item handling.**
- Single-action items are the denominator for op accuracy, fully-correct and gold-in-choices.
- No-action items count in the ask denominator and are reported as no-action TP / predicted none.
- Multi-action items are excluded from every primary metric. They are reported only as "pick ∈ expected ops".
- Natural and paraphrase are split by the set's own `style` label.

## 4. Metrics and scorer (decided now)

- **Primary: one-shot op accuracy.** Dispatched op == gold, over single-action items.
- **Secondary: fully-correct.** Op right ∧ args exact.
  - **STRICT is primary:** the harness `scoreArgRow`, ok = `exact !== false && refExact !== false`.
  - **NORMALISED is secondary:** for every string leaf of the predicted `args` and the gold `args`, trim, collapse internal whitespace to one space, and strip one trailing run of `[.!?,;:]`. Then apply the strict scorer unchanged. Only the `args` are normalised. `refArgs`, `ambiguousArgs` and `argMatch` are left as they are. This addresses the convention mismatch: blind writers keep the final "." (17/17), teacher rows drop it (223/244).
- **Tertiary (C3): gated metrics.**
  - Gold-in-choices: if asked, gold ∈ offered; if not asked, dispatch == gold.
  - Ask rate, over **all single-action + no-action items**.
  - Optimistic effective fully-correct: the simulated user picks gold whenever it is offered, otherwise "none of these", which is not correct and not a wrong dispatch.
  - Wrong dispatches.
- **Fixed / broken vs C1** for C2 and C3 (op, one-shot), with a one-sided exact McNemar p.

## 5. Hypotheses and decision rules

- **H1 (primary):** C2 op accuracy > C1. Confirmed iff fixed > broken and the one-sided exact McNemar p < 0.05.
- **H2 (secondary):** C2 fully-correct (ship, STRICT) > C1 fully-correct (baseline, STRICT), i.e. the end-to-end change. Also reported at equal args state, to separate the op effect from the args effect.
- **H3 (tertiary):** C3 meets the Exp-1 bars. Gold-in-choices ≥ 92%, ask ≤ 30%, and effective fully (ship) − C1 fully (ship) ≥ +8 per 100 single-action items. The baseline-args equivalent is also reported.
- **No-action guard:** C2 and C3 must equal C1 on no-action TP and on predicted-none, which holds by construction. Any difference means a pipeline bug.
- **Shipping rule:**
  - If H1 holds and C2 breaks ≤ ⅓ as many items as it fixes, recommend C2 as the op decider.
  - If H3 also holds, recommend C3 for Flow 4.
  - If H1 fails, keep the LoRA (C1) and treat the dev gain as selection noise.

## 6. Expected numbers (dev)

C2 has **no parameter fitted on held-out-3/4**. Its weights are fixed at equal, and both temperatures come from val. It was, however, *selected* among about 15 fusion families on dev. Its expert was also selected on held-out-3/4: X4 picked Kev-0.8B with desc/W3 as the best zero-shot decider by its h3/h4 results, and added Q4_K_M after seeing Q8's held-out numbers. The fitted L+K fusion under leave-one-set-out gives 176/196 against the PoE's 177. C3's τ = 0.50 sits between the LOSO choices (0.6 trained on h3 → tested on h4; 0.4 trained on h4 → tested on h3). The LOSO totals equal the τ = 0.5 numbers. Expect some shrinkage on held-out-5. At n ≈ 100, ±5 items is noise.

| Dev (196 action / 216 single + none) | C1 | C2 | C3 |
|---|---|---|---|
| Op one-shot | 164 (83.7%) | 177 (90.3%) | 177 |
| Op natural / paraphrase | 92/97, 72/99 | 95/97, 82/99 | same as C2 |
| Fixed / broken vs C1 | – | +14 / −1 (p 0.0005) | +14 / −1 |
| Fully STRICT (baseline / ship) | **136** / 143 | 146 / **153** | 146 / 153 |
| Fully NORMALISED (baseline / ship) | 137 / 144 | 147 / 154 | 147 / 154 |
| Gold-in-choices | – | – | 187 (95.4%): natural 97/97, paraphrase 90/99 |
| Ask | 0 | 0 | 35/216 (16.2%) |
| Effective fully (baseline / ship) | 136 / 143 | 146 / 153 | 152 / **160** (+8.2 / +8.7 per 100 vs C1 at equal args) |
| Wrong dispatches | 39 | 26 | 12 |
| By set, h3 / h4 (op) | 79/92, 85/104 | 84, 93 | gio 88, 99; ask 16/102, 19/114 |
| Teacher val (150 action) | op 134; fully ship 92/107 | 135 (+5/−4); 90/107 | gio 142; ask 25/168; eff ship 95/107 |

**Ceilings (dev).** A perfect op decider reaches fully 157 (baseline) or 165 (ship). Asking on every item with fused top-3 gives gold-in-choices 189/196.

## 7. Known risks, stated in advance

- **Kev Q4_K_M vs Q8_0.**
  - On dev, Q4 is equal or better as a fusion partner: PoE 177 vs 178, gate gold-in-choices 187 vs 186.
  - Alone on teacher val, Q4 is weaker: 70 vs 80 of 150 (Round 8 val), and 118 vs 136 (Round 10 val).
  - A blind drop in C2 relative to dev is the first thing to check against Q8, which is logged as exploratory.
- **Teacher val shows no op gain** (135 vs 134, with 2 fewer fully-correct). The dev gain comes from the paraphrase-heavy held-out style, which is where Kev is strongest.
- **The ship args patch rules were written from dev misses** (in-sample, per X6). The baseline-vs-ship comparison on held-out-5 is its first out-of-sample test.
- **The gated metrics use an optimistic simulated user.**

## 8. Exploratory, logged but not used for any decision

Kev Q8_0 in place of Q4. L+K+H with the head (`x7-fusion/out/head-lr.json`). Fusion allowed to override the LoRA's none. Disagreement gate (LoRA ≠ Kev). pGen gate. Branch-only LoRA scores.
