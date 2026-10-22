# Held-out chat-to-operation eval set 2

File: `heldout2-eval.json`. It was written blind to prior results. I did not open anything under `spike/llm-harness/eval/`, the spike results doc, `op-descriptions.ts`, git history, or any scratchpad file other than the set-1 format reference (`heldout-eval.README.md`, `heldout-eval.json`, read for schema only) and its two validator helpers. Items come only from these repo files: `document-models/*/v1/schema.graphql`, `<model>.json`, the reducers, and the field classes in `op-catalog.ts`. No utterance from set 1 is reused or paraphrased. The domain is different too: storage engines, observability, and a search-relevance project.

Source of truth: `build_heldout2.py` writes the JSON and derives `requiredPresent` from the schema. Regenerate with `python3 build_heldout2.py`.

Ids have gaps on purpose: prj2-03 and der2-02 were dropped while balancing the set.

This set has its own helper files, separate from set 1's (which are untouched):

- `build_heldout2.py`
- `validate_heldout2.py`
- `zodcheck2.mts`
- `heldout2-full-inputs.json` (generated)

## Format: set 1's format plus these changes

The item shape is identical to set 1: `id`, `utterance`, `context.{docType,model,state,refCandidates}`, and `expected.{op,args,ambiguousArgs,refArgs,argMatch,requiredPresent}`, plus `difficulty`, `tags`, `hardCase.{confusableWith,why}` and `notes`. All the field-class rules carry over unchanged: app-filled fields never appear, ref-ids appear only in `refArgs`, and so on. The changes:

| change | meaning |
| --- | --- |
| `style` on every item, noAction and multiAction entry | `natural`: how a user would really type it, and it may reuse the op's own words ("add a topic", "archive this observation"). `paraphrase`: indirect wording. **The validator rejects a paraphrase that contains any non-trivial word of its op name** (STOP list: ADD/SET/UPDATE/REMOVE/CREATE/DELETE/TO/FOR/OF/IN/THE). For natural items the same check only warns (43 warnings, as intended). |
| `refCandidates` labels | Every candidate is `{id, label}`. The label is human-readable, e.g. a title or `Lena (data engineer)`. |
| `argMatch` on refArgs | `argMatch` may name a `refArgs` field, e.g. `dependencies: unordered` on wbs2-08. `moc:REORDER_CORE_IDEAS.ids` has no comparator, so it is compared **in order**. |
| `multiAction[]` (new top-level array) | `{id, style, utterance, context, expected: [step, step], orderSensitive, notes}`. Each step has the same shape as `items[].expected`. `orderSensitive: true` means the reducers only accept the given order. Otherwise the utterance order is the reference and any order should pass. |
| `noAction[]` | As in set 1, plus `style`. |

`context.state` is a partial snapshot that satisfies each reducer's preconditions:

- APPROVE needs `IN_REVIEW` with `provenance.author` set to someone other than `ben`.
- ARCHIVE needs `CANONICAL`, and RESTORE needs `ARCHIVED`.
- RESOLVE and DISSOLVE need `OPEN`.
- UNBLOCK needs `BLOCKED`.
- CREATE_PROJECT and CREATE_MOC start from an empty state.
- ADD_DEPENDENCIES only uses goals that exist and never the goal itself.
- ADD_CHILD_MOC and ADD_TOPIC never duplicate an existing entry.

Literal vocabularies enforced by the reducers are used verbatim:

- knowledge-note metadata fields `confidence` and `consequences`;
- moc metadata `version`;
- vault-config `mocOversize`, vocabulary key `inbox`, and the dimension names in ADD_SIGNAL.

`project:SET_TARGET_DATE` expects `2027-03-31T00:00:00Z` with `argMatch: date`. Today is 2026-10-20, so "March 31" means 2027.

## Validation

- `validate_heldout2.py`, a copy of set 1's validator adapted for this file, finds **0 errors**. It also covers `multiAction` steps, `style`, labels, `requiredPresent` non-emptiness and `argMatch` targets, and it prints the tallies below.
- `zodcheck2.mts` (run from the repo root with `npx --no-install tsx <path>`) parses every expected input with the generated `<Op>InputSchema()`. That is 91 items plus 14 multiAction steps: **105/105 ok**.
- Both helpers write and read `heldout2-full-inputs.json`. Set 1's files are untouched.
- Not checked: replaying the items through the reducers. The states are partial, so the preconditions above were checked by hand against the reducer code.

## Coverage

There are **91 items** (the target was ~80; I kept the extra items for coverage) over **79 distinct ops** in all 12 models, plus **8 noAction** and **7 multiAction** entries.

- **Style:** 46 natural / 45 paraphrase. noAction is 4/4 and multiAction is 4/3.
- **Difficulty:** 31 easy, 47 medium, 13 hard.
- **Args:**
  - 32 items use `refArgs`, 28 have `ambiguousArgs`, and 22 carry `requiredPresent`.
  - 3 items are decided by the op choice alone: kn2-12, obs2-04 and obs2-05.
  - wbs2-07 expects an ASSIGN_GOAL with `assignee` omitted or null, which unassigns the goal.
- **Which candidate is correct** in `refArgs` (0-based index, counting each value of a list ref): index 0 = 10, index 1 = 18, index 2 = 13, index 3 = 2, out of 43. The first candidate is correct only 23% of the time.

Style and difficulty are correlated:

| | easy | medium | hard |
| --- | --- | --- | --- |
| natural | 31 | 9 | 6 |
| paraphrase | 0 | 38 | 7 |

Paraphrases are inherently never "easy". Report results per style, and per style within the hard tier, rather than reading the style gap as a pure wording effect.

Per model (n = natural, p = paraphrase, in item order):

| model | items | n / p | ops (styles) |
| --- | --- | --- | --- |
| knowledge-note | 15 | 8 / 7 | SET_TITLE (n), SET_DESCRIPTION (p), SET_NOTE_TYPE (n), SET_CONTENT (p), ADD_TOPIC (n), ADD_LINK (p), UPDATE_LINK_TYPE (n), REMOVE_LINK (p), REMOVE_TOPIC (n), SET_METADATA_FIELD (p), SET_METADATA_LIST_FIELD (n), SUBMIT_FOR_REVIEW (n), APPROVE_NOTE (p), RESTORE_NOTE (p), ARCHIVE_NOTE (n) |
| project | 15 | 7 / 8 | CREATE_PROJECT (n), UPDATE_PROJECT_INFO (p), SET_PROJECT_STATUS (p), SET_OWNER (p), SET_TARGET_DATE (n), ADD_MEMBER (np), UPDATE_MEMBER (p), REMOVE_MEMBER (n), ADD_DELIVERABLE (n), SET_DELIVERABLE_STATUS (pn), REMOVE_DELIVERABLE (p), UPDATE_DELIVERABLE (n), SET_REFERENCES (p) |
| wbs | 14 | 7 / 7 | CREATE_GOAL (np), SET_GOAL_STATUS (npp), ASSIGN_GOAL (np), ADD_DEPENDENCIES (p), REMOVE_DEPENDENCIES (n), ADD_NOTE (n), DELETE_GOAL (p), REORDER (p), SET_OWNER (n), SET_OUTCOME (n) |
| moc | 12 | 7 / 5 | CREATE_MOC (n), UPDATE_ORIENTATION (p), UPDATE_DESCRIPTION (n), ADD_CORE_IDEA (n), UPDATE_CORE_IDEA (p), REMOVE_CORE_IDEA (n), REORDER_CORE_IDEAS (p), ADD_OPEN_QUESTION (n), ADD_CHILD_MOC (p), REMOVE_TENSION (p), SET_METADATA_FIELD (n), ADD_TENSION (n) |
| source | 6 | 3 / 3 | INGEST_SOURCE (np), SET_SOURCE_STATUS (np), ADD_EXTRACTED_CLAIM (n), RECORD_EXTRACTION_STATS (p) |
| pipeline-queue | 6 | 3 / 3 | ADD_TASK (n), ASSIGN_TASK (p), UNBLOCK_TASK (n), COMPLETE_TASK (p), FAIL_TASK (p), BLOCK_TASK (n) |
| research-claim | 6 | 3 / 3 | CREATE_CLAIM (n), ADD_RESEARCH_CONNECTION (np), REMOVE_RESEARCH_CONNECTION (p), UPDATE_CLAIM_CONTENT (np) |
| observation | 5 | 2 / 3 | CREATE_OBSERVATION (np), PROMOTE_OBSERVATION (p), IMPLEMENT_OBSERVATION (p), ARCHIVE_OBSERVATION (n) |
| vault-config | 5 | 2 / 3 | TOGGLE_FEATURE (n), UPDATE_MAINTENANCE_THRESHOLD (p), UPDATE_VOCABULARY (n), ADD_EXTRACTION_CATEGORY (p), UPDATE_PIPELINE_CONFIG (p) |
| tension | 4 | 2 / 2 | CREATE_TENSION (n), RESOLVE_TENSION (p), DISSOLVE_TENSION (n), ADD_INVOLVED_REF (p) |
| health-report | 2 | 1 / 1 | ADD_CHECK (np) |
| derivation | 1 | 1 / 0 | ADD_SIGNAL (n) |

The multiAction steps add REMOVE_OPEN_QUESTION, which is not tested as a single item.

**Left out on purpose:**

- PATCH_CONTENT and GENERATE_REPORT: their arguments are character offsets or 6 to 8 required numbers, which can't be exact-matched from a chat sentence.
- UPDATE_DIMENSION_RATIONALE and ADD_RESEED_ENTRY: almost every argument would be ambiguous, which gives little signal.
- SET_PROVENANCE, SET_LAST_VIEWED and INITIALIZE_*: system-driven, not chat-driven.

## Hard cases

13 items are marked `difficulty: "hard"`, 6 natural and 7 paraphrase:

| id | style | expected | confusable with | why |
| --- | --- | --- | --- | --- |
| kn2-06 | paraphrase | ADD_LINK (CONTRADICTS) | ADD_TOPIC, UPDATE_LINK_TYPE | a new relation to another note, with linkType inferred from "arguing the opposite" |
| kn2-07 | natural | UPDATE_LINK_TYPE | ADD_LINK | the link already exists; only its type changes |
| kn2-08 | paraphrase | REMOVE_LINK | REMOVE_TOPIC | a "postgres" topic also exists; the user means the link |
| kn2-11 | natural | SET_METADATA_LIST_FIELD | SET_METADATA_FIELD | `consequences` is a list: two items, not one string |
| moc2-02 | paraphrase | UPDATE_ORIENTATION | UPDATE_DESCRIPTION | the reading-path text is the orientation (contrast moc2-03) |
| moc2-09 | paraphrase | ADD_CHILD_MOC | ADD_CORE_IDEA | another map nested below this one is a child MOC |
| moc2-12 | natural | moc ADD_TENSION | tension CREATE_TENSION, ADD_OPEN_QUESTION | scoped to a MOC, so it is an entry on the map |
| prj2-05 | paraphrase | SET_OWNER | UPDATE_MEMBER, ADD_MEMBER | "taking over running this" means ownership (contrast prj2-09) |
| prj2-13 | paraphrase | REMOVE_DELIVERABLE | SET_DELIVERABLE_STATUS (CANCELLED) | "don't want it listed at all" means remove it |
| prj2-16 | natural | SET_DELIVERABLE_STATUS (CANCELLED) | REMOVE_DELIVERABLE | "cancel" is a status; the item stays listed (contrast prj2-13) |
| wbs2-08 | paraphrase | ADD_DEPENDENCIES | SET_GOAL_STATUS (BLOCKED), ADD_NOTE | an ordering constraint, not a block |
| wbs2-14 | natural | SET_OUTCOME | SET_GOAL_STATUS, ADD_NOTE | the goal is already COMPLETED (contrast wbs2-04) |
| pq2-06 | natural | BLOCK_TASK | FAIL_TASK | waiting on an input is recoverable (contrast pq2-05) |

23 medium items also carry `hardCase` notes, mostly as the other half of a contrast pair:

- kn2-04: SET_CONTENT vs PATCH_CONTENT.
- kn2-14: RESTORE_NOTE.
- moc2-05: UPDATE_CORE_IDEA vs ADD_CORE_IDEA.
- moc2-10: REMOVE_TENSION vs REMOVE_OPEN_QUESTION.
- src2-04: EXTRACTING vs ADD_EXTRACTED_CLAIM.
- prj2-04: COMPLETED vs ARCHIVED.
- prj2-09, prj2-12, prj2-15: SET_REFERENCES vs ADD_KNOWLEDGE_REF.
- wbs2-02, wbs2-04, wbs2-05: IN_REVIEW vs COMPLETED.
- wbs2-11: DELETE_GOAL vs WONT_DO.
- wbs2-12: REORDER.
- rc2-03.
- obs2-03 and obs2-04: PROMOTE vs IMPLEMENT.
- ten2-02 and ten2-04: RESOLVE vs DISSOLVE.
- pq2-04: COMPLETE_TASK vs ADVANCE_PHASE.
- pq2-05.
- vc2-02: mapping onto the `mocOversize` literal.
- vc2-04: ADD vs TOGGLE extraction category.

## No-action items

| id | style | context | utterance (gist) | tempting false positive |
| --- | --- | --- | --- | --- |
| none2-01 | natural | knowledge-note | "difference between builds-on and derived-from?" | ADD_LINK |
| none2-02 | natural | moc | "how many core ideas does this map have now?" | ADD_CORE_IDEA / REORDER_CORE_IDEAS |
| none2-03 | natural | project | "when's the target date again?" | SET_TARGET_DATE |
| none2-04 | natural | wbs | "which of these are blocked right now?" | SET_GOAL_STATUS (BLOCKED) |
| none2-05 | paraphrase | source | "same paper Sam sent around last week?" | INGEST_SOURCE / SET_SOURCE_STATUS |
| none2-06 | paraphrase | research-claim | "not convinced by this yet" | UPDATE_CLAIM_CONTENT |
| none2-07 | paraphrase | pipeline-queue | "things are moving a lot faster today" | COMPLETE_TASK / ADVANCE_PHASE |
| none2-08 | paraphrase | tension | "settle this or call it a non-issue? what do you think?" | RESOLVE / DISSOLVE |

## Multi-action items

The set 1 format allows one op per item, so each of these requests needs two actions:

| id | style | model | expected (in order) | orderSensitive |
| --- | --- | --- | --- | --- |
| ma2-01 | natural | knowledge-note | SET_TITLE, then SUBMIT_FOR_REVIEW | no |
| ma2-02 | paraphrase | wbs | SET_GOAL_STATUS (COMPLETED, eval set), then ASSIGN_GOAL (Sam, fusion weights) | no |
| ma2-03 | natural | project | ADD_MEMBER (Ines, designer), then SET_OWNER (Ines) | no |
| ma2-04 | paraphrase | source | RECORD_EXTRACTION_STATS (8/0/0), then SET_SOURCE_STATUS (EXTRACTED) | no |
| ma2-05 | natural | moc | ADD_OPEN_QUESTION, then REMOVE_OPEN_QUESTION (the exact string from state) | no |
| ma2-06 | paraphrase | pipeline-queue | UNBLOCK_TASK, then ASSIGN_TASK (same task) | **yes**: assigning first sets IN_PROGRESS, and UNBLOCK then throws |
| ma2-07 | natural | knowledge-note | ADD_TOPIC (consensus), then ADD_LINK (RELATES_TO, Raft) | no |

**Suggested scoring:**

- **Strict:** the full step list matches. Ops match, in order when `orderSensitive`, and each step's args and refArgs match by the item rules.
- **Partial:** count how many expected steps a single-op system recovers. Its one op should match one of the steps.
