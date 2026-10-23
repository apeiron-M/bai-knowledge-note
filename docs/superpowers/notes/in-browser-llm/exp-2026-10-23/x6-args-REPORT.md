# X6: step-2 arguments, Round 8 LoRA: why fully-correct trails op choice, and inference-only fixes

2026-10-23. Inference only, on this Mac: native llama-server b11364 (Metal, `--no-jinja -np 1`, n_ctx 4096, temperature 0) through X2's `native-llm.mts`. Model `round8/gguf/LFM2.5-350M-vault-r8a-20261022-Q4_K_M.gguf`. Dev only: held-out-3 + held-out-4 (196 action items) plus the Round 8 teacher-val step-2 rows (107). Nothing under `exp/blind/` was read. The repo is untouched: fixes are in `patch/`.

## Setup and parity

- `run.ts` runs step 2 on the GOLD op for each item through local copies of `args-step.ts` / `args-grammar.ts` with X6 switches (all off = shipped code). Variants are in `variants.ts`, and per-item rows are in `out/<variant>.json` (prompt, raw output, args, refLps, mustHave, lexFixed, score).
- Scoring: dev uses the harness's own `scoreArgRow` (r6/r5: `exact` = every gold `args` path matches under its `argMatch` (`ci`, `unordered`, `date`, else JSON-exact) and there are no extra semantic fields; `refExact` for refs). An item is OK when `exact !== false && refExact !== false`. Val compares the teacher's args exactly (key order ignored, nulls dropped).
- End to end: step 2 at temperature 0 depends only on the op, so fully-correct = (LoRA's op right) AND (args right given the gold op). The op picks are the stored browser R2c (held-out-3) / E8 (held-out-4) rows, `loraPick`. X2's native picks are shown as a cross-check.
- **Parity:** the base run's dev args are byte-identical to X2's gold-op step 2 on 196/196 items. It reproduces 163 op / **135 fully** (browser picks) and 164 / 136 (native picks). On val, base gives 95/107, not val-native's 99/107. The 4-item gap is the ref scoring, explained below: val-native generated the ref label freely, while v1 scores the labels.

## Task 1: classification of every args miss (base, gold op forced)

Per item: `out/misses-classified.json` (`classify.py`, hand-labelled after reading the prompt signature, raw output and gold for each item; `show.py` prints them).

| Category | Dev (39) | of which op right (28) | Val (12) |
|---|---|---|---|
| Optional field dropped by the safe gate although meant | 10 | 9 | – |
| Context-dependent: gold needs document state or today's date | 8 | 5 | – |
| Wrong enum value | 6 | 2 | – |
| Multi-field confusion (text in the wrong field / split) | 5 | 4 | 2 |
| Wrong ref | 4 | 3 | 6 |
| Span edge / punctuation | 2 | 1 | 2 |
| Optional field offered, mentioned, omitted by the model | 2 | 2 | – |
| Scorer strictness / debatable label | 1 | 1 | 1 |
| Vocabulary gap | 1 | 1 | – |
| Spurious optional field | – | – | 1 |

Dev details:
- **Gate dropped (10):**
  - SET_METADATA_FIELD `value` ×3 (kn3-09, kn4-06, moc4-14): `field` is a required enum, `value` is optional and never named, so the gate removes the very value being set.
  - INGEST_SOURCE `url`/`author` ×3 (src3-01, src4-01, src4-02): never named as "url" or "author".
  - `owner` (prj3-01): "owns" stems to `own`, which does not match `owner`.
  - `role`, `assignee`, `extractionSelectivity`: never named.
- **Context (8):** REMOVE_OPEN_QUESTION ×2, where the gold is the stored question text, which the utterance only paraphrases. `childRef` gold is a PHID with no candidates. "At the end of the list" needs the list length. SET_REFERENCES ×2 must keep the existing references from state. Two dates need today's date ("end of next month", "third of March" with no year).
- **Enum (6):** handoff.phase "create" although the utterance says "reflect is done" ×2; `taskType`, `key`; two `status` values on items whose op is wrong anyway.
- **Multi-field (5):** ADD_CHECK ×3 splits the list between `message` and `affectedItems`; INGEST_SOURCE title/content; CREATE_CLAIM fills its required lists with copies.
- **Refs (4):**
  - Calibrated scoring picks the wrong label ×2 (prj4-15, wbs3-05).
  - A paraphrased tension ×1 (moc4-11).
  - A list ref ×1 (moc4-07): REORDER needs the full order, and list refs are never scored.
- **Span edge:** kn4-02 / prj4-01 is a **grammar bug**. `TRAIL_QUOTE` strips `)"` as one block, so a title ending in `(Mostly)"` can only be copied as `(Mostly)"` or `(Mostly`, never `(Mostly)`.
- **Offered but omitted:** vc4-03 `depth`, prj4-08 `kind`, prj4-01 `status`.
- No number-formatting miss reached the scorer. vc3-04's "5%" → 0.05 sits behind a gate drop.

Val: 4 of the 6 ref misses are calibration; 2 are REORDER_CORE_IDEAS list refs. Also in val: REORDER `parentId` vs `insertBefore` ×2, "summaries on" swallowing the boolean, a short `comment` span, an optional `sessionId` ref filled although the user said "no session attached", and a debatable label (UPDATE_PROJECT_INFO name vs description).

## Task 2: fixes, measured on dev

Base: dev args given the gold op 157/196, val 95/107, e2e 135/196.

| Variant | Dev args, gold op | Val | Args, op right | E2E fully (nat / para) | Fixed / broken vs base |
|---|---|---|---|---|---|
| base | 157 | 95 | 135/163 | 135 (77/58) | – |
| **refgen**: no ref scoring, constrained generation picks the label | 158 | **99** | 136 | 136 | +5 (1 dev, 4 val) / 0 |
| refmean: likelihood, uncalibrated | 158 | 99 | 136 | 136 | identical args to refgen |
| refsum: calibrated sum | 157 | 95 | 135 | 135 | 0 / 0 |
| **edge**: span edges cut anywhere in punctuation runs | 158 | 95 | 135 | 135 | kn4-02 / 0 |
| **selector**: gate keeps the free fields of an all-enum-required op | 160 | 95 | 138 | 138 | 3 / 0 |
| reqm (loose: any name token): mentioned optional → required | 159 | 94 | 137 | 137 | 2 / 1 val ("extraction setup" → `extractionSelectivity: 0`) |
| **reqm2** (strict: all name tokens, or an enum value) | 158 | 95 | 136 | 136 | prj4-08 / 0 |
| **lex**: enum fixed when exactly one value is named | 158 | 95 | 136 | 136 | pq4-04 / 0 |
| senum: calibrated enum scoring (existing `scoreEnums`) | 157 | 94 | 134 | 134 | vc3-02 / kn3-11 + 1 val |
| senumRaw: uncalibrated enum scoring | 158 | 99 | 136 | 136 | = refgen (no enum change) |
| detect (URL, "by Name", digits → numeric field) | 156 | 95 | 135 | 135 | 0 / moc4-05 (the digit detector offered `sortOrder: 300`, and that disabled the safe gate's restore) |
| detectUrl (no digit rule) | 157 | 95 | 135 | 135 | 0 / 0 (fields offered, model omits them; works only with reqm) |
| stem1 (utterance token is a prefix of the field token) | 157 | 95 | 135 | 135 | 0 / 0 (changes 1 prompt, prj3-01) |
| dates (years 2026–2029 in the date grammar) | 158 | 95 | 136 | 136 | prj4-06 / 0 |
| shipCore = refgen + edge + selector | 162 | 99 | 139 | 139 (79/60) | 9 / 0 |
| **shipPatch** = shipCore + reqm2 + lex (+ negation guard, selector narrowed to `value`) | **165** | **99** | **142** | **142 (81/61)** | 12 / 0 |
| best = shipPatch rules + detectUrl + stem1 | 168 | 99 | 145 | 145 (84/61) | 15 / 0 |
| bestNarrow = best + dates | **169** | 99 | **146** | **146 (85/61)** | 16 / 0 |

Native-pick e2e is +1 throughout (shipPatch 143, bestNarrow 147). By set, shipPatch is held-out-3 74/92 and held-out-4 91/104 (base 73 / 84). The rules were written after reading misses from both sets, so this split is not a holdout.

**Ref selection** (offline over the saved per-label prefix logprobs, 130 dev+val items with a scored ref; `refs.py`):

| Selection | Right |
|---|---|
| mean, calibrated (v1) | 123 |
| sum, calibrated | 123 |
| **mean, uncalibrated** | **129** |
| sum, uncalibrated | 129 |
| gte-small cosine (utterance vs label) | 124 |
| mean + w·gte (w 2–10) | 129 |
| lexical overlap | 118 |
| lexical + calibrated | 126 |

- Uncalibrated scoring picks exactly what constrained generation picks (args identical on all 303 items). So ref scoring buys nothing for the LoRA.
- Content-free calibration costs 6/130, as Round 8 found for op choice.
- Dropping scoring saves the per-label requests: native utterance-pass median 233 ms, p90 395 ms per ref item, plus the content-free pass. Step-2 median over all items falls from 129 to 45 ms natively, and the true saving is larger: the 129 ms leaves out the content-free pass.
- The one item every likelihood mode misses (moc4-11) is a paraphrased tension that lexical overlap gets right. Fusing with gte does not recover it.

**Lexical enum fixing, precision:** it fired on 40 dev+val fields; 38 agree with gold (35 of those the model already had right). The two wrong ones were on items already failing:
- vc4-03 "thorough depth rather than standard" → `standard`. The negation/contrast guard (3-word window: not, rather, than, instead, …) removes it.
- vc3-02 "revisit old notes" → key `notes` (the gold is reweave), still forced. Vocabulary keys that are everyday words are its weak spot.

**Selector rule side effects:** the general form touches 4 ops (kn/moc SET_METADATA_FIELD, ADD_LINK `targetTitle`, SET_GOAL_STATUS `blockReason`/`outcome`). It filled `blockReason: "we decided that"` unasked on wbs3-05 (already failing). Narrowed to a field named `value`, it keeps the same 3 fixes with no side effect. That narrowed form is what the patch ships.

## Task 3: what to ship, and what remains

> **Caveat: in-sample.** Every rule was written after reading these same 39 dev misses, so the dev gains are an optimistic, in-sample estimate. The only independent evidence is teacher val, which was used to derive no rule: 95 → 99 with zero regressions on all 303 items under every shipped variant. That is a no-harm check, not a gain estimate. Validate on the blind set before merging. Expect the dev gain to shrink most for `requireNamed` / `fixNamedEnums` (3 dev items of evidence) and least for `scoreRefs: false` and the `)"` span fix (mechanical, and confirmed on val).

**Best combination vs baseline (dev):**
- Args given the gold op: 157 → 165 (ship patch) / 169 (all rules), out of 196.
- Args given a right op: 135/163 (82.8%) → 142 (87.1%) / 146 (89.6%).
- E2E fully-correct: **135 → 142 / 146 of 196** (+7 / +11), natural 77 → 81 / 85, paraphrase 58 → 61.
- Val: 95 → 99/107 for both. Nothing broke on any of the 303 items.

**Ship (general, grammar-only or gate-only, no retrain): `patch/x6-args-ship.patch`.** It applies cleanly with `git apply --check`. It type-checks (repo tsconfig, after prettier; the only error is the copied tree's vendor path, which baseline shows too); 55/55 of `chat-args-grammar` / `chat-round6` / `chat-scorer` pass against the patched files, with one test expectation updated for the new span forms. Re-running the patched files reproduces shipPatch's args exactly on all 303 items.
1. `V1_ARGS.scoreRefs: false`: +1 dev, +4 val, about 230 ms less per ref item natively.
2. `wordForms`: span edges may cut anywhere inside a leading or trailing punctuation run. This fixes the `)"` bug and changes no prompt bytes.
3. Safe gate keeps `value` for selector ops (all required fields are enums). This changes the step-2 prompt for SET_METADATA_FIELD when "value" is not said, so future training renders change for those rows too.
4. `requireNamed`: optional root fields the utterance names strictly become required in the grammar only (prompt unchanged, order unchanged via new `mustHave`).
5. `fixNamedEnums`: an enum narrowed to the single value the utterance names, with a negation/contrast guard; grammar only.

Not run on the patch: oxlint, the full test suite, a browser run. 4 and 5 rest on 2 and 1 dev items of evidence alone (prj4-08 and prj4-01; pq4-04). In the shipped configuration they fire on 14 items (requireNamed) and 39 fields in 37 items (fixNamedEnums) with no regression. Unobserved edge case: `fixNamed` recurses into nested objects with no skip list, so a nested ref path whose label is fully named would be lex-fixed. No dev/val op has a nested ref.

**Prototype only, do not ship as is (evidence is one item or one op):**
- URL + "by Name" author detectors (src3-01 and src4-01, both INGEST_SOURCE; they need reqm2 + lex to land).
- The stem-prefix mention (`own` ~ `owner`; derived from prj3-01 alone).
- The date-year window (prj4-06 alone; it needs the runtime's current year, and "end of next month" still comes out wrong).

The digit → numeric-field detector is harmful. Calibrated enum scoring is net −1.

**Left after all rules (17 dev misses on op-right items):**
- **Training:** multi-field confusion ×4 (ADD_CHECK list vs message ×3, CREATE_CLAIM); unnamed person/role fields ×3 (`role`, `assignee`, an author without "by"; R9 showed offering them at inference invents values); a paraphrased ref; REORDER full-list refs (moc4-07 plus 2 val); "chain … automatically" → `autoChain` omitted; `filesModified` span choice. Val adds REORDER `parentId` vs `insertBefore` ×2 and boolean-swallowing spans.
- **Not training: pipeline/data design (4 op-right, 8 overall).** These need state at step 2:
  - REMOVE_OPEN_QUESTION should take refCandidates (the questions) instead of a free span.
  - `childRef` PHIDs need candidates.
  - sortOrder "at the end" needs the list length.
  - SET_REFERENCES needs the existing list.
  - Relative dates need today's date (a deterministic date resolver, or a dated prompt plus retrain).

**Label-review candidates (not relabelled):**
- **Trailing period:** kn3-02 (and src3-01 before the fixes). Held-out writers keep the sentence-final "." on 17/17 multi-word spans; teacher rows drop it 223/244. Pick one convention, or make `ci` ignore a final ".".
- **der3-02 `influencedDimensions`:** the gold uses VAULT_DIMENSIONS, but the field is a free list, and teacher rows use free strings ("methodology", "robustness"). This is a vocabulary decision; constraining it would conflict with the teacher data.
- **rc3-01:** `methodology: []` is exact-scored while `description`/`content`/`sources` are only ambiguous.
- **hr3-01:** `affectedItems: []`.
- **val UPDATE_PROJECT_INFO-1-7:** name vs description.
- **val REJECT_NOTE-0-4:** comment span length.

## Files
- **Code:**
  - `run.ts`, `variants.ts`, `data.ts`: the driver.
  - `args-step.ts`, `args-grammar.ts`: prototype copies with X6 switches.
  - `orig/`: the repo copies the patch is diffed from.
  - `ship/`: the patched files.
  - `ship-run/` + `run-ship.ts`: the patch re-run.
  - `refs.py`: ref modes and gte; `compare.py`, `table.py`, `show.py`, `classify.py`; `selector-ops.ts`; `tsc-check/`: type and test check of the patch.
- **Outputs:**
  - `out/*.json`: per-item rows per variant.
  - `out/misses-classified.json`.
  - `out/table.md`.
  - `out/ref-emb.f32`, `out/ref-texts.json`: gte embeddings.
- **Patch:** `patch/x6-args-ship.patch`.
