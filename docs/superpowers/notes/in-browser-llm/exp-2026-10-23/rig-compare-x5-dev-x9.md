# X5 350M (Round 10 + 3,428 paraphrase rows) on dev, x9 args, vs R8 350M and X1 1.2B

Run 2026-10-23, `validation/x5-kevq4-dev` (exit 0; frozen shas OK):

```bash
./rig.sh --lora ~/projects/powerhouse/bai-knowledge-note/training/artifacts/x5-350m/gguf/LFM2.5-350M-vault-x5a-20261023-Q4_K_M.gguf \
         --kev ../x4-kev/export/Kev-0.8B-local-Q4_K_M.gguf --set dev --args x9 --out validation/x5-kevq4-dev
```

- LoRA sha256 `062796543208889530edfd70cecd0cb6912d3d3b832ed671894d89307000aaba` (matches 06279654…0aaba).
- Kev sha `64f479de…`, repo rev `5e9c39046dcd`, llama.cpp `46ca246`. These are the same as the R8 and X1 runs.
- Val for the temperature refit was scored into `x5-kevq4-dev/val/`. The refit T_K is 1.25 for all three runs, so the Kev side is identical.
- X5 refits to **T_L = 0.437**, against 1.797 for R8 and 0.747 for X1. The model is much sharper.
- Rows are from `python3 src/compare.py --level x9 --block refit …`. The R8 and X1 rows are the existing `r8-kevq4-dev` and `x1-kevq4-dev` runs.
- The gate's wrong-dispatch count assumes the optimistic user.

## Headline (refit temps)

| Model | Config | temps T_L / T_K | Op | natural | paraphrase | fully x9 STRICT | fully x9 NORM | eff (gate) STRICT / NORM | vs alone | gold-in-choices | ask | wrong |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R8 350M | alone | 1.797 / 1.25 (refit) | 164/196 (83.7%) | 92/97 | 72/99 | 148 | 149 | - | - | 164 (83.7%) | 0/216 | 39 |
| R8 350M | Kev alone | 1.797 / 1.25 (refit) | 160/196 (81.6%) | 86/97 | 74/99 | 146 | 147 | - | +15/-19 (p 0.8) | 160 (81.6%) | 0/216 | 43 |
| R8 350M | x Kev (PoE) | 1.797 / 1.25 (refit) | 176/196 (89.8%) | 95/97 | 81/99 | 158 | 159 | - | +13/-1 (p 0.00092) | 176 (89.8%) | 0/216 | 27 |
| R8 350M | x Kev + gate tau 0.5 | 1.797 / 1.25 (refit) | 176/196 (89.8%) | 95/97 | 81/99 | 158 | 159 | 166 / 167 | +13/-1 (p 0.00092) | 187 (95.4%) | 38/216 | 12 |
| R8 350M | args on gold op | | | | | 173 | 174 | | | | | |
| X1 1.2B | alone | 0.747 / 1.25 (refit) | 173/196 (88.3%) | 95/97 | 78/99 | 156 | 157 | - | - | 173 (88.3%) | 0/216 | 28 |
| X1 1.2B | x Kev (PoE) | 0.747 / 1.25 (refit) | 176/196 (89.8%) | 95/97 | 81/99 | 158 | 159 | - | +5/-2 (p 0.23) | 176 (89.8%) | 0/216 | 25 |
| X1 1.2B | x Kev + gate tau 0.5 | 0.747 / 1.25 (refit) | 176/196 (89.8%) | 95/97 | 81/99 | 158 | 159 | 168 / 169 | +5/-2 (p 0.23) | 188 (95.9%) | 23/216 | 12 |
| X1 1.2B | args on gold op | | | | | 173 | 174 | | | | | |
| X5 350M | alone | 0.437 / 1.25 (refit) | 175/196 (89.3%) | 93/97 | 82/99 | 159 | 159 | - | - | 175 (89.3%) | 0/216 | 29 |
| X5 350M | x Kev (PoE) | 0.437 / 1.25 (refit) | 180/196 (91.8%) | 94/97 | 86/99 | 163 | 163 | - | +6/-1 (p 0.062) | 180 (91.8%) | 0/216 | 24 |
| X5 350M | x Kev + gate tau 0.5 | 0.437 / 1.25 (refit) | 180/196 (91.8%) | 94/97 | 86/99 | 163 | 163 | 166 / 166 | +6/-1 (p 0.062) | 183 (93.4%) | 15/216 | 19 |
| X5 350M | args on gold op | | | | | 175 | 175 | | | | | |

**No-action (LoRA none rule):**

| Model | NA true positives | predNone |
|---|---|---|
| R8 | 13/20 | 15 |
| X1 | 15/20 | 18 |
| X5 | 12/20 | 13 |

**Multi-action, gate pick in gold ops:**

| Model | gate pick in gold ops |
|---|---|
| R8 | 9/12 |
| X1 | 10/12 |
| X5 | 11/12 |

## Gate under the X7-frozen pair (T_L 1.8 / T_K 1.0), for reference

| Model | Op | nat / para | fully x9 STRICT / NORM | eff STRICT / NORM | gold-in-choices | ask | wrong |
|---|---|---|---|---|---|---|---|
| R8 350M | 177 | 95 / 82 | 159 / 160 | 166 / 167 | 187 | 35/216 | 12 |
| X1 1.2B | 177 | 96 / 81 | 159 / 160 | 169 / 170 | 190 | 41/216 | 9 |
| X5 350M | 180 | 96 / 84 | 165 / 165 | 169 / 169 | 188 | 42/216 | 10 |

**Temperature caveat.** The refit makes X5's LoRA very sharp (T_L 0.437). Under the equal-weight product that shrinks Kev's
share, and the τ = 0.5 margin gate asks far less often: 15 asks against 42 under the frozen temps. Gold-in-choices then drops
from 188 to 183, and wrong dispatches rise from 10 to 19. PoE op is 180 in both blocks.

So with refit temps, X5's gate is *worse* than R8 and X1 on wrong dispatches (19 vs 12 / 12), despite the best op and fully
scores. With frozen temps it is at par with X1 (eff 169 vs 169, wrong 10 vs 9). τ = 0.5 was registered in X7 together with the frozen pair 1.80 / 1.00. A sharper LoRA
needs τ re-tuned on val, or the frozen T_L, before the gate's ask/wrong trade-off can be compared fairly.

## McNemar: X5 alone vs R8 alone (op one-shot, `loraPick == gold`, 196 action items)

R8 164 → X5 175. **Fixed 17, broken 6**, one-sided exact McNemar p = 0.017 (X5 > R8). 15 of the 17 fixes are paraphrase items.

| | ids |
|---|---|
| Fixed (17) | moc3-05, moc3-08, prj3-03, prj3-12, wbs3-05, src3-02, kn4-07 (natural), kn4-08, kn4-16, moc4-05, moc4-12, prj4-18, wbs4-15, vc4-08 (natural), obs4-03, ten4-03 (R8 said none), der4-02 |
| Broken (6) | prj3-11 (UPDATE_DELIVERABLE→SET_DELIVERABLE_STATUS), kn4-06 (SET_METADATA_FIELD→…LIST_FIELD), kn4-14 natural (SUBMIT_FOR_REVIEW→ADD_LINK), moc4-02 (UPDATE_ORIENTATION→UPDATE_CORE_IDEA), moc4-03 (UPDATE_DESCRIPTION→UPDATE_ORIENTATION), pq4-08 (UNBLOCK_TASK→COMPLETE_TASK) |
| No-action (20) | R8 13 → X5 12. Fixed none4-04; broken none3-03 (→moc:UPDATE_DESCRIPTION) and none4-01 (→knowledge-note:UPDATE_LINK_TYPE) |

X5 vs X1 alone, for reference: action 173 → 175, +14 / −12, p = 0.42. No-action is 15 → 12 (+0 / −3).
X5 alone roughly matches the 1.2B model on op and beats it on fully-correct (159 vs 156). It is weaker on no-action.

## Near-duplicate check: dev vs X5's new rows

- **Method.** All 228 dev utterances (held-out-3/4 items, noAction and multiAction) were scored against all 3,615 rows of `training/artifacts/round11-para/full/chain/agreed.jsonl`.
  - This is a superset of the 3,428 rows trained on. `merged/split/split.json` dropped 187 val-source rows.
  - The score is `training/py/dedup.py`'s own leak score: `normalize()`, then max(char-trigram Jaccard, word-trigram Jaccard). The leak threshold is 0.5.
  - The score is supplemented by word-4-gram containment: the fraction of the dev utterance's 4-grams that appear in the row.
  - "trained" is a proxy: the row's utterance appears as a substring in `train-split.jsonl` prompts.
- **Filter check.** The leak filter was confirmed on these rows: `merged/new-final/dedup-report.json` shows 0 of 3,615 rejected against the 476 default eval utterances (held-out-1..4 + dev/seed).
- **Result. No dev item is a near-duplicate by the filter's definition.** The max score is 0.412. 0 pairs are ≥ 0.5, 1 is ≥ 0.4 and 6 are ≥ 0.3. The median per-item max is 0.182.
- **4-gram containment.** 1 item is ≥ 0.5 (wbs3-15, 0.50: shares "set the project ref to the"). 3 items are ≥ 0.25.

**Top pairs by leak score:**

| dev id (gold) | score (char / word J3) | dev utterance | nearest X5 row (op, trained?) |
|---|---|---|---|
| vc3-05 (vault-config:UPDATE_MAINTENANCE_THRESHOLD) | 0.412 (0.412 / 0.150) | set the stale note threshold to 60 days | "hey yusuf wants the stale note threshold bumped up to 60 days can you just" (same op, same value; trained) |
| none3-05 (no-action, bai/wbs, ambiguous goal) | 0.375 (0.375 / 0.000) | set the goal status to done | "cert goal status: done asap" (wbs:SET_GOAL_STATUS; trained) |
| src3-03 (source:SET_SOURCE_STATUS) | 0.364 | set status to extracting | "Freya, source status: extracting now." (same op; trained) |
| prj3-04 (project:SET_OWNER) | 0.350 | make Dario the owner | "make hyun-jung lee the owner now" (same op; not in train split) |
| kn3-13 (knowledge-note:APPROVE_NOTE) | 0.343 | Mira's write-up checks out, sign off on it and make it official | "Make bjorn's write-up official." (same op; trained) |
| kn3-12 (knowledge-note:SUBMIT_FOR_REVIEW) | 0.309 | ok I'm happy with it, submit it for review | "submit for rafael ortiz's review" (same op; trained) |
| wbs3-15 (wbs:SET_PROJECT_REF) | 0.299, cont4 0.50 | set the project ref to the Riverside greenway study | "can u set the project ref to coral reef ecology thesis?" (same op; trained) |

**Effect on the result: none.**
- None of these seven items changed outcome between R8 and X5. vc3-05, src3-03, prj3-04, kn3-13, kn3-12 and wbs3-15 are correct in both. none3-05 is wrong in both.
- The 17 fixed items have overlap scores at background level: max 0.211 (prj3-03), max 4-gram containment 0.06.
- The closest semantic neighbour is vc3-05: same op and same slot value (60 days), but different wording. It scores below threshold and is not a gain.
- none3-05 is a no-action item whose nearest row is an action for the plausible op. X5 dispatches on it, as R8 did.
- The X5 gain is therefore not attributable to dev near-duplicates.

Artifacts: `validation/x5-kevq4-dev/` (rows, results, manifest, val/). Overlap and McNemar scripts and outputs are in the session scratchpad `x5-overlap/`.
