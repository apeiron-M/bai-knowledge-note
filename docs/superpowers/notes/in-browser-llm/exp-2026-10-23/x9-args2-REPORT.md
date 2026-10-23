# X9: step-2 arguments, pipeline fixes (dates, state candidates, list completion, X6 rule promotion, trailing period)

2026-10-23. Inference only, on this Mac: native llama-server b11364 (Metal, `--no-jinja -np 1`, n_ctx 4096, temperature 0) through X2's `native-llm.mts`, Round 8 GGUF (`LFM2.5-350M-vault-r8a-20261022-Q4_K_M`), the same model and server as X6 and the held-out-5 ship run. Step 2 runs on the GOLD op. Nothing under `exp/blind/` was opened, and neither were held-out-5 per-item outputs. From `heldout5-run1/RESULTS.md` I used only the aggregates (args on the gold op: 124 baseline / 131 ship out of 165). The repo is untouched. All changes are in `patch/x9-args2.patch`, which applies on top of `x6-args/patch/x6-args-ship.patch`.

## Data and setup

- **Dev (196):** held-out-3 (92) + held-out-4 (104) action items, scored with the harness's `scoreArgRow`. STRICT ok = `exact !== false && refExact !== false`.
- **R8 val (107):** Round 8 teacher-val step-2 rows, compared exactly with the teacher's args (X6's definition).
- **R10u val (38):** the Round 10 val step-2 rows that the Round 8 LoRA never trained on. That is 149 rows, minus 105 that are in R8 train, minus 6 that are in R8 val. The other 111 are R8 training rows, so they are not usable.
- **Document state:** h3/h4 use `context.state`. Teacher rows use their `fixture`, replayed with `training/gen/replay.ts`.
- **Eval clock, fixed per set:**
  - h3/h4: `conventions.today` = 2026-10-22.
  - Teacher rows: the fixture replay clock `REPLAY_NOW` = 2026-10-20.
  - A blind run should pass the set's own `conventions.today`.
- **NORMALISED scoring:** pre-registration §4, i.e. string leaves trimmed, spaces collapsed, one trailing `[.!?,;:]` run stripped.
- **E2E fully-correct:** (LoRA's op right) AND (args right on the gold op). It uses X6's browser R2c/E8 `loraPick` rows; native picks are shown after the slash. E2E covers dev only; val has no picks.
- **Mirror:** `mirror/` is a copy of the repo with the X6 ship patch applied plus the X9 changes. `run.ts` imports core from it.
- **Parity:** the `ship` variant (all X9 options off) reproduces `x6-args/out/ship-v1.json` byte for byte (args, prompt, raw) on 303/303 rows: dev 165, val 99. R10u's baseline is 33/38.

## Results (each change alone, then combined; vs the X6 ship patch)

| Variant | Dev args STRICT (NORM) | R8 val | R10u | Args when op right | E2E fully (browser / native) | Fixed / broken vs ship | Prompts / grammars changed (of 341) |
|---|---|---|---|---|---|---|---|
| ship (X6 patch) | 165 (166) | 99 | 33 | 142/163 | 142 / 143 | – | – |
| **1 dates** (resolver in code) | 167 (168) | 99 | 33 | 144 | 144 / 145 | +2 prj3-05, prj4-06 / 0 | 0 / 2 |
| 1 dated prompt (LLM fills) | 164 (165) | 98 | 33 | 141 | 141 / 142 | 0 / −2 (wbs4-05, a val SET_PROVENANCE) | 332 / 0 |
| 1 year window (X6 rule) | 166 (167) | 99 | 33 | 143 | 143 / 144 | +1 prj4-06 / 0 | 0 / 332 |
| 1 dated prompt + year window | 164 (165) | 98 | 33 | 141 | 141 / 142 | 0 / −2 | 332 / 332 |
| **2a state choices** (question, childRef) | 168 (169) | 99 | 33 | 144 | 144 / 145 | +3 moc3-08, moc4-10, moc3-11 / 0 | 4 / 4 |
| **2b list completion, order** | 166 (167) | 100 | 33 | 143 | 143 / 144 | +2 moc4-07, val REORDER_CORE_IDEAS-1-6 / 0 | 0 / 0 |
| **2c list completion, keep** | 167 (168) | 99 | 33 | 142 | 142 / 143 | +2 prj3-15, prj4-18 / 0 | 0 / 0 |
| 2b+2c | 168 (169) | 100 | 33 | 143 | 143 / 144 | +4 / 0 | 0 / 0 |
| 2d sortOrder "at the end" (prototype) | 166 (167) | 99 | 33 | 143 | 143 / 144 | +1 moc4-04 / 0 | 0 / 0 |
| 3 URL detector | 165 (166) | 99 | 33 | 142 | 142 / 143 | 0 / 0 | 2 / 4 |
| 3 "by Name" author | 165 (166) | 99 | 33 | 142 | 142 / 143 | 0 / 0 | 2 / 2 |
| 3 stem prefix (own ~ owner) | 166 (167) | 99 | 33 | 143 | 143 / 144 | +1 prj3-01 / 0 | 6 / 6 |
| 3 all three | 168 (169) | 99 | 33 | 145 | 145 / 146 | +3 prj3-01, src3-01, src4-01 / 0 | 8 / 10 |
| 4 restore final punctuation | 164 (166) | 92 (99) | 32 (33) | 141 | 141 / 142 | +1 kn3-02 / −10 (2 dev, 7 val, 1 R10u) | 0 / 0 |
| 4 restore, narrow (≥4 words, "." only) | 166 (166) | 98 (99) | 32 (33) | 143 | 143 / 144 | +1 kn3-02 / −2 (1 val, 1 R10u) | 0 / 0 |
| **combo = 1 dates + 2a + 2b + 2c (the patch)** | **173 (174)** | **100** | **33** | **147/163** | **147 / 148** | **+9 / 0** | 4 / 6 |
| combo + 2d | 174 (175) | 100 | 33 | 148 | 148 / 149 | +10 / 0 | 4 / 6 |
| combo + 3 all | 176 (177) | 100 | 33 | 150 | 150 / 151 | +12 / 0 | 12 / 16 |

- By set, combo vs ship:
  - Args: held-out-3 74 → 78 / 92, held-out-4 91 → 95 / 104.
  - E2E: held-out-3 68 → 70, held-out-4 74 → 77.
- The patched files (`detect` code stripped) reproduce the proto runs exactly (args, prompt and grammar) for ship, dates, choices, lists and combo on all 341 rows (`out/*.patched.json`).
- Full table: `out/table.md`. Every item a variant touches, with before → after: `python3 fired.py <variant>`.

**Caveat (in-sample):** every X9 rule targets misses that X6 already classified on these same dev items. The dev gains are an upper bound. The independent checks are no-harm checks, not gain estimates:
- R8 val and R10u: 0 breaks under any shipped option; +1 on val from order completion.
- The resolver's 28 unit cases: 26 written from the convention, plus the 2 dev utterances.

Expect blind gains only where held-out-5 has the same op patterns: SET_TARGET_DATE, REMOVE_OPEN_QUESTION / REMOVE_CHILD_MOC with state, REORDER_CORE_IDEAS, and additive SET_REFERENCES.

## 1. Today's date

- **Only one semantic date field exists in the catalog:** `project:SET_TARGET_DATE.targetDate`.
- **The LoRA has never been trained on a date.** There are 0 SET_TARGET_DATE step-2 rows in the Round 8 train/val splits and 0 in Round 10's (filtered on `meta.step == 2`). That is why the ship patch writes 2023-10-31 and 3033-01-01.
- **Letting the LLM fill the date fails:**
  - A `Today: 2026-10-22` prompt line fixes neither date item.
  - It changes all 332 prompts and breaks 2 items.
  - The year window fixes only the "third of March" year.
- **Shipped: `core/date-resolve.ts`, a deterministic resolver.**
  - Conventions are documented in the file header and unit-tested in 28 cases.
  - When the op has exactly one date field and the request names exactly one date, `fillArgsStep({ today })` narrows that field's grammar to the literal `YYYY-MM-DDT00:00:00Z` and requires it.
  - When the request names no date, or two different dates, nothing changes.
  - The prompt bytes do not change.
  - `runV1` takes `today`, and the hook passes the user's local date.
  - Motivated by prj3-05 ("end of next month") and prj4-06 ("third of March", no year). Both are fixed, and nothing else changed.
- **Weak spot:** "you may 3 times" parses as May 3. It only matters when the op has a date field.

## 2. Ref candidates and lists from document state

- **2a. `STATE_CHOICES` in `ref-candidates.ts`:**
  - `moc:REMOVE_OPEN_QUESTION.question` comes from `state.openQuestions`.
  - `moc:REMOVE_CHILD_MOC.childRef` comes from `state.childRefs`. The label is the drive document title when known: `driveRefContext` now lists `bai/moc` documents as kind `moc`. Otherwise the label is the raw value.
  - `buildModelSchema` turns a semantic field that has candidates into an enum, so the field renders as `choice`, exactly like a ref.
  - An empty list is left out, so the field stays a free span. Teacher rows have no such state, so their prompts are unchanged.
  - Motivated by moc3-08 and moc4-10 (paraphrased questions; the reducer removes the exact string) and moc3-11 (the PHID `moc/enriched-doughs`). All 3 are fixed. moc4-13 also got choices and stayed right.
  - It stays separate from `REF_EXTRACTORS`, because the ref-candidates test pins those to the training recipes and to ref-id fields.
- **2b. `CURRENT_LISTS` + `core/list-completion.ts`, `order` mode (`moc:REORDER_CORE_IDEAS.ids`):**
  - The reducer sets `coreIdeas = reordered`, so a partial list deletes the ideas it leaves out. This is a data-loss fix, not just a scoring one.
  - Ids the model left out are appended in their current state order (not the shuffled candidate order); duplicates are dropped.
  - Fixes moc4-07 and val REORDER_CORE_IDEAS-1-6. Val 0-1 stays wrong because the model's order is wrong.
- **2c. `keep` mode (project and wbs `SET_REFERENCES.references`):**
  - The current URLs are kept only when the request adds to the list ("also", "too", "alongside", "don't lose", …) and has no replace cue ("only", "just", "swap", "replace", "instead", …).
  - Fixes prj3-15 and prj4-18. It correctly does not fire on wbs4-15 ("swap"). wbs3-14 has an empty state list.
  - **Evidence is thin:** 2 items, one field name on two models, and the cue lists were written with those items in view.
  - It belongs to the same class as 2b: SET_REFERENCES replaces the list, so today "also cite X" silently drops every existing reference. The rule errs toward not deleting user data.
  - URLs are removed before cue matching, so a path like `/add/` is not a cue.
- **Plumbing:** `runV1({ currentLists })`, with the hook passing `currentListsFor(entry.key, doc.state)`.
- **Left as a prototype (not in the patch), 2d:** "at the end" → `sortOrder` = list length. It has only one item (moc4-04).
- **Not done:** REMOVE_CHILD_MOC labels on teacher rows (none have state).

## 3. X6 prototype rules: none promoted

Bar: helps on at least 2 dev items across at least 2 ops, and breaks none. Prompt changes count as touches.
- **URL detector:** fires on 4 dev items. Two are INGEST_SOURCE prompt changes, two are UPDATE_DELIVERABLE grammar-only and were already right. Alone it fixes 0.
- **"by Name" author:** fires only on src3-01 and src4-01 (INGEST_SOURCE). Alone it fixes 0. Together with URL it fixes both, but that is still 1 op.
- **Stem prefix:** fixes prj3-01 (CREATE_PROJECT owner) only. It changes 5 other prompts (UPDATE_MEMBER, UPDATE_DELIVERABLE) with no score change.
- **Year window:** superseded by 1.
- **Verdict:** none fires on any val or R10u row, so none clears the bar. Combining them would add +3 dev (176), but on 2 ops, 3 items, all in-sample. The code is kept in `proto/` only.

## 4. Trailing period

- **Convention counts** (multi-word gold spans that are followed by `.`, `!` or `?` in the request):

  | Source | Keep | Drop |
  |---|---|---|
  | Held-out writers, exact-scored `args` | 6 | 2 |
  | Held-out writers, `ambiguousArgs` | 0 | 5 |
  | Teacher rows (val + R10u) | 3 | 10 |

  X6 counted 223/244 drops over all teacher rows. The writers are therefore not consistent either; they keep it mostly on sentence-type fields.
- **The model follows the teacher** and drops the period.
- **Restoring the final punctuation in code:**
  - STRICT: +1 dev (kn3-02), −2 dev, −7 val, −1 R10u. It puts periods on names and list items ("Santiago Herrera.", "sleep inertia.").
  - The narrow form (≥4 words, "." only): +1 dev / −2 teacher.
  - Under NORMALISED, every variant scores the same as ship, so the period accounts for only 1 dev item.
- **Recommendation:**
  - Convention: free-text spans drop the final sentence punctuation. Strip one trailing `[.!?]` run from multi-word span labels (internal punctuation stays).
  - Keep the model as is. Do not relabel teacher data broadly; only normalise the ~9% of teacher rows that keep a final "." (a mechanical pass, which also changes the train set's step-2 completions for those rows).
  - Make NORMALISED the primary args metric, or give the scorer's `ci` / exact string match the same trailing-run fold. Do not relabel the frozen blind golds; score them normalised instead.
  - Add no runtime rule.

## What remains (combo, 23 dev misses, 16 with the op right)

- ADD_CHECK list vs message ×3 (hr3-01, hr3-02, hr4-01).
- INGEST_SOURCE author/url/span ×3 (src3-01, src4-01, src4-02).
- Unnamed role, assignee and owner (prj3-07, wbs4-01, prj3-01).
- pq3-03 multi-field.
- vc4-03 `autoChain`.
- moc4-11, a paraphrased tension ref.
- moc4-04 sortOrder (2d).
- rc3-01, der3-02 and kn3-02, which are scorer or label questions.

These remain training or label issues, as X6 classified them.

## Patch: `patch/x9-args2.patch` (on top of `x6-args-ship.patch`)

sha256 `1173738261b17bb135db8b5c2517bad50653a339b44415c299960d8bfbc00529`; it is rebuilt by `make-patch.sh`.

- **New:**
  - `chat/core/date-resolve.ts`
  - `chat/core/list-completion.ts`
  - `tests/unit/chat-date-resolve.test.ts` (31 tests)
  - `tests/unit/chat-list-completion.test.ts` (9 tests)
- **Changed:**
  - `args-step.ts`: the `today` / `currentLists` options, `dateFields`, and the `dateFixed` / `listsCompleted` results.
  - `op-catalog.ts`: a semantic field with candidates becomes an enum.
  - `ref-candidates.ts`: `STATE_CHOICES`, `CURRENT_LISTS`, `currentListsFor`, and the `bai/moc` context kind.
  - `v1-pipeline.ts`: `V1Options.today` / `currentLists`.
  - `hooks/use-chat-llm.ts`: passes the local date and current lists.
- **Prompt bytes:**
  - Unchanged, except REMOVE_OPEN_QUESTION / REMOVE_CHILD_MOC when the document has items. These now render `Choices for …`, which the LoRA has not seen for these ops; it chose right on 4/4.
  - The training renderer does not call `refCandidatesFor`, so training renders and `PROMPT_FORMAT_VERSION` are unaffected.
  - Next round: render these two ops with state choices (they need fixtures with openQuestions / childRefs).
- **Checks** (`fresh/` = new repo copy + `git apply` X6 patch + `git apply --check` / apply X9):
  - The applied files are byte-identical to `mirror/`.
  - `tsc` (repo tsconfig, narrowed to `editors/knowledge-vault`, `tests/unit/chat-*`, `training/gen`, `document-models`) reports no errors outside `document-models/*/v1/tests/*`. That zod-typing noise is pre-existing: the unmodified repo gives the same 28 errors on `document-models/moc`.
  - All 17 `tests/unit/chat-*.test.ts` files pass (211 tests), including ref-candidates, v1-pipeline, prompt-format, round6/9, args-grammar and scorer.
  - Not run: oxlint (not installed in node_modules), a browser run, the blind sets.

## Files

- **Code:**
  - Driver: `run.ts`, `variants.ts`, `data.ts`, `picks.ts`.
  - Analysis: `compare.py` (table) and `fired.py` (touched items).
  - Patch tooling: `make-patch.sh` and `list-ops.ts` (catalog scan).
- **Trees:**
  - `mirror/`: patched tree, i.e. repo + X6 + X9.
  - `x6base/`: the X6-applied base the patch is diffed from.
  - `proto/`: core with the `detect` prototype.
  - `fresh/`: the apply/test check.
- **Outputs:**
  - `out/<variant>.json`: per-item rows with prompt, raw, args, `dateFixed`, `listsCompleted`, STRICT `ok`, NORMALISED `okN` and grammar hash.
  - `out/*.patched.json`: the re-runs on the stripped tree.
  - `out/table.md`, `out/picks.json`.
