# Held-out chat-to-operation eval set

File: `heldout-eval.json`. I wrote it without looking at the existing eval set, its results, the spike results doc, `op-descriptions.ts`, or the branch history. I derived the items only from `document-models/*/v1/schema.graphql`, `<model>.json`, the reducers, and the field-classification rules in `editors/knowledge-vault/chat/core/op-catalog.ts`.

## Format

Top level: `{ name, version, createdAt, conventions, items[], noAction[] }`.

Each `items[]` entry:

| key | meaning |
| --- | --- |
| `id` | stable id with a model prefix (`kn-`, `moc-`, `src-`, `prj-`, `wbs-`, `rc-`, `obs-`, `ten-`, `pq-`, `vc-`, `der-`, `hr-`). Gaps in the numbering are intentional. |
| `utterance` | chat text as a user would type it |
| `context.docType` / `context.model` | the document the chat is scoped to (`bai/wbs` maps to `wbs`) |
| `context.state` | partial snapshot of the document. It satisfies the reducer preconditions, e.g. APPROVE needs `IN_REVIEW` and RESOLVE needs `OPEN`. |
| `context.refCandidates` | `{dottedPath: [{id,label}]}` for ref-id fields. These are the same keys `buildModelSchema({refCandidates})` and the envelope `refIds` use. |
| `expected.op` | catalog key `<model>:<OP>`, e.g. `wbs:SET_GOAL_STATUS` |
| `expected.args` | **exact-match** semantic (model-filled) fields |
| `expected.ambiguousArgs` | semantic fields whose wording or value is open. These are reference values only and are **excluded from exact match**. |
| `expected.refArgs` | ref-id values the model must pick from `refCandidates`. Score these separately. |
| `expected.argMatch` | optional comparator per field: `ci`, `date` (compare the YYYY-MM-DD prefix), `unordered`, `ci-unordered`. Nested paths are dotted, e.g. `handoff.filesModified`. |
| `requiredPresent` | dotted paths of `ambiguousArgs` fields that must still be present and non-empty. The list is generated from the schema: every required semantic field whose value is ambiguous. One field is required by the reducer rather than the schema: wbs-05 `blockReason`, because the status is BLOCKED. 23 items carry this list. |
| `difficulty` | `easy` / `medium` / `hard` |
| `tags`, `hardCase.{confusableWith,why}`, `notes` | annotations |

`noAction[]` entries have `{id, utterance, context, reason}`. The correct output for these is no operation. I put them in a separate array because the catalog and envelope code has no no-action sentinel.

### Assumptions I made from op-catalog.ts

- **App-filled fields never appear in expected args.** These are: every `DateTime`, any field named `actor` or ending in `By`, `id: OID` on `ADD_*`/`CREATE_*` ops and on nested objects, and the `DEFAULT_FIELD_OVERRIDES`.
- **Ref-id fields** are OID/PHID fields, fields ending in `Id`, and `id` on non-create ops. They appear only in `refArgs`.
- **Some fields that look like references are semantic** and stay in `args`: String-typed `noteRef`, `targetRef`, `claimRef`, `childRef`, `ref` (tension), `promotedTo`. So are `assignee`, `assignedTo`, `owner` and `author`.
- **Optional semantic fields** that are in neither `args` nor `ambiguousArgs` should be omitted or null.
- **`project:SET_TARGET_DATE.targetDate`** is model-filled (it is a `Date`, not a `DateTime`). Zod validates it as an ISO **datetime**, so the expected value is `2026-12-15T00:00:00Z`, compared by date.
- **Literal vocabularies enforced by the reducers** are used verbatim: `rootCause` and `alternatives` (knowledge-note metadata), `staleNoteDays`, `topicMap`, `granularity`, and the pipeline-queue phases `create/reflect/reweave/verify`.

### Validation

- `validate_heldout.py` checks every item:
  - the op key exists;
  - every field is in the correct class;
  - every required semantic field is in `args` or `ambiguousArgs`;
  - enum, Int, Float, Boolean, URL and Date shapes are valid;
  - every `refArgs` value is among the candidates;
  - no utterance contains the non-trivial words of its op name.
- `zodcheck.mts` runs each item through the real generated `<Op>InputSchema()`. The input is args, ambiguousArgs and refArgs merged, plus placeholder ids and timestamps. **All 68 items pass.**

## Coverage

68 items, 66 distinct ops, all 12 models, plus 6 no-action items. Of the 68 items:

- 22 use `refArgs`.
- 29 have at least one `ambiguousArgs` field.
- 8 are decided by the op choice alone: no args and no refs.

| model | items | ops covered |
| --- | --- | --- |
| knowledge-note | 13 | SET_TITLE, SET_DESCRIPTION, SET_CONTENT, SET_NOTE_TYPE, SET_METADATA_FIELD, SET_METADATA_LIST_FIELD, ADD_TOPIC, ADD_LINK, UPDATE_LINK_TYPE, REMOVE_TOPIC, SUBMIT_FOR_REVIEW, REJECT_NOTE, ARCHIVE_NOTE |
| project | 11 | CREATE_PROJECT, UPDATE_PROJECT_INFO, SET_PROJECT_STATUS, SET_OWNER, SET_TARGET_DATE, ADD_MEMBER, UPDATE_MEMBER, REMOVE_MEMBER, ADD_DELIVERABLE, SET_DELIVERABLE_STATUS, SET_REFERENCES |
| wbs | 10 | CREATE_GOAL, UPDATE_GOAL_DESCRIPTION, DELETE_GOAL, SET_GOAL_STATUS (x2: WONT_DO, BLOCKED), ASSIGN_GOAL, SET_OWNER, SET_OUTCOME, ADD_DEPENDENCIES, ADD_NOTE |
| moc | 8 | CREATE_MOC, UPDATE_ORIENTATION, UPDATE_DESCRIPTION, ADD_CORE_IDEA, UPDATE_CORE_IDEA, ADD_OPEN_QUESTION, REMOVE_OPEN_QUESTION, ADD_TENSION |
| pipeline-queue | 5 | ADD_TASK, ASSIGN_TASK, BLOCK_TASK, FAIL_TASK, ADVANCE_PHASE (nested handoff) |
| vault-config | 5 | UPDATE_MAINTENANCE_THRESHOLD, UPDATE_VOCABULARY, UPDATE_PIPELINE_CONFIG, UPDATE_DIMENSION, TOGGLE_EXTRACTION_CATEGORY |
| source | 4 | INGEST_SOURCE, SET_SOURCE_STATUS (x2: EXTRACTING, ARCHIVED), RECORD_EXTRACTION_STATS |
| research-claim | 4 | CREATE_CLAIM, ADD_RESEARCH_CONNECTION, REMOVE_RESEARCH_CONNECTION, UPDATE_CLAIM_CONTENT |
| observation | 3 | CREATE_OBSERVATION, PROMOTE_OBSERVATION, IMPLEMENT_OBSERVATION |
| tension | 3 | CREATE_TENSION, RESOLVE_TENSION, DISSOLVE_TENSION |
| derivation | 1 | ADD_SIGNAL |
| health-report | 1 | ADD_CHECK |

I deliberately left out PATCH_CONTENT, GENERATE_REPORT and UPDATE_DIMENSION_RATIONALE. Their arguments (character offsets, or 6 to 8 required numeric or list fields) cannot be exact-matched from a chat sentence.

## Hard cases

There are 14 items with `difficulty: "hard"`:

| id | expected | easy to confuse with |
| --- | --- | --- |
| kn-06 | SET_METADATA_LIST_FIELD (`alternatives`) | SET_METADATA_FIELD |
| kn-08 | ADD_LINK (BUILDS_ON) | ADD_TOPIC |
| kn-09 | UPDATE_LINK_TYPE | ADD_LINK |
| kn-13 | REJECT_NOTE ("sending this back") | ARCHIVE_NOTE |
| moc-02 | UPDATE_ORIENTATION ("reframe the intro") | UPDATE_DESCRIPTION, REORDER_CORE_IDEAS |
| moc-05 | UPDATE_CORE_IDEA | ADD_CORE_IDEA, UPDATE_DESCRIPTION |
| prj-03 | UPDATE_PROJECT_INFO (rename) | CREATE_PROJECT (would throw AlreadyInitialized) |
| prj-11 | SET_DELIVERABLE_STATUS CANCELLED | REMOVE_DELIVERABLE |
| wbs-02 | UPDATE_GOAL_DESCRIPTION | CREATE_GOAL |
| wbs-04 | SET_GOAL_STATUS WONT_DO ("leave it on the list") | DELETE_GOAL (contrast wbs-03) |
| wbs-05 | SET_GOAL_STATUS BLOCKED + blockReason | ADD_DEPENDENCIES, ADD_NOTE |
| wbs-07 | ASSIGN_GOAL | wbs SET_OWNER (contrast wbs-08) |
| wbs-09 | SET_OUTCOME (item already COMPLETED) | SET_GOAL_STATUS, ADD_NOTE |
| ten-03 | DISSOLVE_TENSION ("never a real conflict") | RESOLVE_TENSION (contrast ten-02) |

13 more medium items carry `hardCase` notes, mostly as the other half of a contrast pair:

- kn-02, moc-03, src-03 (ARCHIVED vs EXTRACTED), prj-09, wbs-08, wbs-10, obs-03, ten-02, pq-03 and pq-04 (BLOCK vs FAIL), pq-06 (ADVANCE_PHASE vs COMPLETE_TASK), vc-03.
- moc-10 is a cross-model confusion between moc ADD_TENSION and tension CREATE_TENSION. It only matters in unscoped mode.

## No-action items

| id | context | utterance (gist) | tempting false positive |
| --- | --- | --- | --- |
| none-01 | knowledge-note, IN_REVIEW | "what does canonical mean?" | APPROVE_NOTE |
| none-02 | moc | "thanks, that's perfect" | none |
| none-03 | wbs | "how many are still open?" | SET_GOAL_STATUS |
| none-04 | project | "who's on the team?" | ADD_MEMBER |
| none-05 | tension, OPEN | "not sure this conflict is real, let me think" | RESOLVE / DISSOLVE |
| none-06 | source | "explain the skip rate" | RECORD_EXTRACTION_STATS |
