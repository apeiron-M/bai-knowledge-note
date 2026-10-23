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
