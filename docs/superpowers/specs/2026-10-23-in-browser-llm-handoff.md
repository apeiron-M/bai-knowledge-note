# In-Browser LLM: Handoff (2026-10-23)

Branch `explore/in-browser-llm`. Nothing pushed. The coordinator works only through subagents. Never push, and never create branches.

**User goal:** at least 90% accuracy from English to correctly structured, document-model-specific actions. Experiments come first; packaging and generalisation are deferred. Do CPU- and GPU-heavy work on Constantine (`ssh trainbox`). This Mac runs inference only, never training. Several experiments may run at once across both machines.

## Where the files are

- **Experiment reports** (copied into the repo): `docs/superpowers/notes/in-browser-llm/exp-2026-10-23/`. This includes X2/X3/X4/X6/X7 reports, `PREREGISTRATION.md` with its sha256, and `x6-args-ship.patch`.
- **Full experiment outputs** (gitignored backup, about 1.2 GB; models excluded): `training/artifacts/exp-2026-10-23/`. Contents:
  - all code and per-item outputs;
  - `blind/heldout5` and `blind/heldout6`;
  - `x5-paraphrase-data`, which may be partial;
  - `heldout5-run1`, which may be partial.
- **Original scratchpad:** `/private/tmp/claude-501/-Users-benjaminjordan-projects-powerhouse-bai-knowledge-note/244dfd73-afea-4295-86de-08a64fc34f82/scratchpad/exp/`. It is newer if agents kept writing after the backup, and it holds the Kev models in `x4-kev/models/`. Re-sync with `rsync` before relying on the backup.
- **Earlier notes:** `docs/superpowers/notes/in-browser-llm/`, including `pipeline-flows.md`, `decision-models-browser.md` and `reuse-across-apps.md`.

## Blind sets (do not read in experiment agents)

- **held-out-5:** 180 items (165 action, 15 none), styles `plain`/`messy`, sha256 `c472bbae…354e`. Used for selecting among arms.
- **held-out-6:** 200 items plus 20 none, sha256 `85942add…f775`. **Confirmatory: run once, on the final winner only.**
- **Dev:** held-out-3 and held-out-4 (heavily reused) plus the Round 8 teacher val.

## Results so far (dev: held-out-3 and held-out-4, 196 single-action items)

| Experiment | Result |
|---|---|
| Baseline: Round 8 LoRA, R2c | op 164 (84%), fully correct 136 |
| X2: classifier head on gte-small | alone 61%. Fusion gains are at noise level. The pGen<0.9 gate with head alternatives reaches gold-in-choices 91.8% at a 24.5% ask rate |
| X3: LoRA scoring | Rescoring gives no gain; greedy decoding already picks the argmax. The token-trie scorer takes 41 ms vs 625 ms. The old `scoreOptions` was distorted (non-canonical tokens). The LoRA is overconfident |
| X4: Kev-0.8B, zero-shot, with descriptions | about equal to the LoRA (h4 83 vs 84) and better on paraphrases. Julia-1 and Kev-0.6B are out. Fine-tune plus GGUF export is verified feasible. Recipe: `x4-kev/finetune/constantine-recipe.sh`; data: `x4-kev/finetune/data/` |
| X6: argument fixes, no retraining | fully correct 135→142 (in-sample), patch `x6-args-ship.patch`. Turning off scoreRefs helps. Label mismatch: blind writers keep the final "." on spans |
| **X7: LoRA × Kev-0.8B Q4, equal-weight product** | **op 177/196 (90.3%), fully correct 153.** Cross-validated 174–176. The margin gate at τ=0.5 gives gold-in-choices 95.4% at 16% asks. The gte head gets zero weight. With a perfect op choice, the args ceiling would be 165 |

## Pre-registered (sha256 `eac4ad28…765d5`)

- **C1:** LoRA alone, as the control.
- **C2:** LoRA × Kev Q4 with the X6 args fixes.
- **C3:** C2 plus the margin gate, τ=0.5.

Scoring: STRICT is primary and NORMALISED (trailing punctuation) is secondary. The primary test is C2 > C1 on op accuracy (one-sided McNemar).

## In flight at shutdown (agents die with the session; check the outputs on disk)

1. **held-out-5 blind run of C1–C3:** output in `exp/heldout5-run1/` (RESULTS.md). If it is incomplete, rerun from scratch with a new evaluator agent, following the same instructions as before: verify both shas, use the frozen producers, run once.
2. **X1, the LFM2.5-1.2B LoRA on Constantine:** check `ssh trainbox`, the screen sessions and `~/bai-training/`, and read `exp/x1-1p2b/REPORT.md` if it exists. Then merge, export Q4_K_M and copy back to `training/artifacts/x1-1p2b/gguf/`.
3. **X5, human-style paraphrase training rows** (claude -p teacher, on this Mac): check `exp/x5-paraphrase-data/` and the `training/round11-para/` dir. It is resumable, and it leak-filters against both blind sets.

## Next steps

- **Constantine queue:** after X1, run the Kev-0.8B fine-tune (it starts zero-shot at LoRA level), then the 350M LoRA on the X5 rows. Evaluate each on dev first. Then run a pre-registered held-out-5 comparison and fuse the fine-tuned Kev with the LoRA.
- **Pipeline fixes for arguments** (from X6): relative dates need today's date; open-question, list and sort-order candidates are needed.
- **Final step:** a single run of the winner on held-out-6.
- **Browser cost of C2:** Kev Q4 adds 530 MB, and it needs a second wllama instance (WebGPU latency is unverified).

## UPDATE: held-out-5 blind run 1 is DONE (results in `exp-2026-10-23/heldout5-run1-RESULTS.md`)

| held-out-5 (165 single-action + 15 none) | C1 LoRA | C2 LoRA×Kev + ship args | C3 = C2 + gate |
|---|---|---|---|
| Op one-shot | 135 (81.8%) | **146 (88.5%)** | 146 |
| Fully correct, STRICT (base / ship args) | 104 / 111 | 111 / **118** | effective 121 / 128 |
| Gold among choices / ask rate | – | – | **97.0% / 24.4%** |
| Wrong dispatches | 33 | 22 | 6 |

- **Pre-registered hypotheses:**
  - H1 (C2 > C1 on op accuracy) holds: one-sided McNemar p=0.0064, with 14 items fixed and 3 broken.
  - H3 (all three gate bars) holds.
- **Where the gain is:** all of it is on `messy` wording (70 → 81 of 98). On `plain` wording C1 and C2 are identical (65/67).
- **Arguments are now the bottleneck.** Given the right op, args are exact on 124 (base) or 131 (ship) of 165. The ship patch's first out-of-sample test: +10 / −3.
- **Not yet at 90% one-shot.** Remaining levers:
  - a fine-tuned Kev;
  - the X1 1.2B LoRA;
  - X5 paraphrase data;
  - argument pipeline fixes.

  Every later comparison on held-out-5 counts as a further reuse of that set. Keep held-out-6 for the final run.

## UPDATE: X5 stopped on an expired login

The labelling pass stopped when `claude -p` lost its login. The user has since re-logged in.

- **Generation:** finished, 584 requests, with 0 prompt leaks against held-out-5/6.
- **Labelling:** 504 of 584 rows done, in `training/artifacts/round11-para/full/chain/label-results.jsonl.partial.jsonl`.
- **To resume:** re-run the label step; it is resumable. Then run the validation chain, merge with the Round 10 kept rows, and train on Constantine.
- **Uncommitted code:** `training/round11-para/` is untracked. Review it, then commit.

## UPDATE 2 (session resumed, 2026-10-23 afternoon)

- **X1 done.** The 1.2B LoRA is at `training/artifacts/x1-1p2b/gguf/…x1a-20261023-Q4_K_M.gguf` (731 MB, sha 7dd843a0). On training val it gets 95.2% op and 93.3% args.
- **X5 done.** There are 3,615 new human-style rows. The merged training set (7,808 rows) is on Constantine at `round11-para/`, and the code is committed in 8ec83770.
- **X9 done.** `x9-args2.patch` sits on top of x6. Dev args on the gold op go 165→173; fully correct with LoRA picks goes 142→147. Adopt this convention from now on: free text drops its final punctuation, and NORMALISED becomes the primary args metric.
- **Eval rig done** (`exp/rig/rig.sh`). It reproduces X7 and X9 exactly. Dev results with x9 args:

  | Setup | Op | Fully correct |
  |---|---|---|
  | 350M R8 × Kev Q4 | 177 | 159 |
  | 1.2B X1 alone | 173 | 156 |
  | X1 × Kev | 176 | – (Kev adds little on top of X1) |
- **Constantine queue:**
  - Now: the X5 350M LoRA (screen x5-train, about 1.7 h).
  - Then: the Kev-0.8B fine-tune (about 8.3 h; there are no MPS kernels and no checkpoints).
  - Consider training the 1.2B on X5 data before Kev, if X5 helps the 350M.

## UPDATE 3 (2026-10-23 evening)

- **X5 is the best single model.** It's the 350M trained on Round 10 + 3,428 human-style rows: `training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf`, 229 MB, sha 06279654.
  - Dev results, x9 args:

    | Setup | Op | Fully NORM |
    |---|---|---|
    | X5 alone | 175 (89.3%) | 159 |
    | X5 × Kev | 180 | 163 |

  - Against R8 alone it fixes 17 items and breaks 6 (p=0.017).
- **Gate calibration.** The val refit was too sharp, because 140 of the 168 R8-val ids are in the X1/X5 training data. The new rule fits per-expert temperatures on dev by gold NLL, keeps τ=0.5 and equal weights. For X5 that gives T_L 1.63 and T_K 0.75.
  - X5×Kev dev: gold-in-choices 188/216, ask 34, wrong 10, effective fully NORM 169.
  - With these temperatures, X5×Kev vs X5 alone is only +10/−6 (p 0.23).
- **Rig v2** adds `--temps explicit|dev-cv`, `--exclude-match`, and `--prereg <file>` (sha-verified).
  - Leak row to exclude: Round 10 `gen-observation--IMPLEMENT_OBSERVATION-1-3`.
- **Draft pre-registration:** `PREREGISTRATION-2-DRAFT.md`.
  - Arms: A X5, B X5×Kev, C B+gate, D X1, E best×Kev-FT (TBD), F 1.2B on X5 data (TBD).
  - Finalise once E and F land, then run held-out-5 once (its 2nd use).
- **Running:**
  - Kev-0.8B fine-tune on Constantine, screen kev-ft, ETA about 00:25 Oct 24. Export with `x4-kev/finetune/kev-ft-export.sh`.
  - X11, more human-style data plus no-action rows plus contrastive pairs, goes to `training/round12-para/`.
- **Constantine queue after Kev:** F (the 1.2B on round11 data), then the 350M on round11+round12.

## UPDATE 4 (2026-10-26)

- **Both machines slept over the weekend.** Kev-FT had finished on 10-24 at 03:36 anyway. Constantine still has `pmset sleep 1` on AC; the user needs to run `sudo pmset -c sleep 0` there.
- **Kev-FT is exported:** `training/artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`, 530 MB, sha 30b5796e. Its dev-fit T_K is 4.0.
- **Dev results** (x9 args, dev-cv temps):

  | Setup | Op | Fully NORM | Gate (gold-in-choices / ask / wrong / effective) |
  |---|---|---|---|
  | Kev-FT alone | 177 (vs 161 zero-shot; p 0.0004) | – | – |
  | **X5 × Kev-FT** | **183/196 (93.4%)** | 165 | 189 / 30 / 10 / 170 |

  - X5 × Kev-FT vs X5 alone: +10/−2, p 0.019.
- **Running:**
  - F (1.2B on round11 data) on Constantine in screen f-train, ETA about 13:00 CDT 10-26.
  - X11 (round12 data) generation on this Mac.
- **Next:**
  1. Finalise PREREGISTRATION-2: E = X5 × Kev-FT, plus F.
  2. Run held-out-5 once.
  3. Then the 350M on round11 + round12 data.

## UPDATE 5 (2026-10-26): held-out-5 run 2 done (PREREGISTRATION-2, sha 798b289e)

Held-out-5 had 164 action items and 15 no-action items after excluding obs5-05. Date: 2026-10-23.

| Arm | Op one-shot | Fully NORM | Gate (gold-in-choices / ask / wrong / effective NORM) |
|---|---|---|---|
| A: X5 alone (229 MB) | 139 (84.8%) | 125 | – |
| B: X5 × Kev-FT | 146 (89.0%, CI 83.3–92.9) | 131 | – |
| C: B + gate | – | – | 98.8% / 19% / 3 / 142 (86.6%) |
| **D: F (1.2B, round11) × Kev-FT + gate** | **152 (92.7%, CI 87.7–95.8)** | **142 (86.6%)** | 163 / 31 / 2 / 151 (92.1%) |
| K: R8 alone (control) | 134 (81.7%) | 113 | – |

- **Pre-registered hypotheses:**
  - H1 (B > A): p 0.033.
  - H2 (B > K): p 0.011.
  - H3 (B ≥ 90%): not met.
  - H4 (gate bars): met.
- **H5 (descriptive), D vs C:** op +7/−1, effective +10/−1.
- **Decision:** the §9 rule picks C. D is descriptively stronger on blind data, although it tied on dev (182 vs 183). D costs 731 + 530 MB.
- **Next:** pre-register held-out-6, its single confirmatory run, with C and/or D, then run it once.

## UPDATE 6 (2026-10-27): held-out-6 confirmatory run DONE (PREREGISTRATION-3, sha e9733fe2)

There were 200 action items and 20 no-action items, with 0 excluded. Date: 2026-10-23.

| Arm | Op one-shot | Fully one-shot | Gate: gold-in-choices / ask / wrong / effective fully |
|---|---|---|---|
| A: X5 alone | 84.5% | 76.5% | – |
| B / C: X5 × Kev-FT (760 MB) | **93.5%** (CI 89.2–96.2) | 83.5% | 98.0% / 15.9% / 2.7% / **87.5%** |
| D: F 1.2B × Kev-FT (1.26 GB) | **96.0%** (CI 92.3–98.0) | 87.0% | 98.5% / 13.6% / 1.4% / **89.5%** |

- **Hypotheses:** P1 and P2 both pass (point estimate ≥ 90%).
- **D vs C:** effective +2.0 pts, p 0.42. Under the pre-committed rule, **C ships**.
- **Remaining errors** are mostly args: 14 wrong without an ask, 7 wrong after an ask. There are also 3 wrong dispatches and 3 no-action mistakes.
- **Next (not started):**
  1. Port C into the browser chat: two wllama instances, the X6+X9 patches, the gate UI.
  2. Measure WebGPU latency.
  3. Decide where the GGUFs are hosted.
