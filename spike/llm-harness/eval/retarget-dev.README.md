# Retarget and deictic dev set (M0)

File: `retarget-dev.json`. It is a **dev set**: it is committed and not blind. It tests which document the chat should change, as well as the op. It was written for the vault plan's M0 §3.7, and the M2b retarget dev set grows from it.

## How it was written

An isolated writer wrote it under the eval-set rules (`training/docs/NEW-DOCUMENT-MODEL.md` §3).

**Read:**
- `document-models/*/v1/schema.graphql` and `<model>.json`;
- the reducers under `v1/src/reducers/`, for preconditions;
- the field classes in `op-catalog.ts`;
- `vocabularies.ts`;
- the generated `gen/schema/zod.ts`, only through the zod check.

The rules it tests come from:
- the powerhouse-nl overview plan §5.1, rows T and Q1;
- the M2b plan's retarget and deictic bullets;
- this repo's vault plan §3.2, §3.7 and §3.9;
- the held-out-4 README, for the format.

**Not opened:**
- anything under `training/` other than that procedure doc;
- any other file in this directory, except through the overlap script;
- results docs and `op-descriptions.ts`;
- git history;
- any blind set;
- the chat's resolver code (`target-document.ts`, `context-frame.ts`). The frame's shape comes from the plan text, not from the code.

**Domains, all invented:**
- a fermentation lab;
- distributed-systems notes;
- an urban cycling study;
- a choir season;
- coastal erosion fieldwork.

All ids, drive ids and titles are invented.

## Format

The format is the held-out format (`--set file:<path>`), with three additions. Every item, noAction entry and multiAction entry is scoped: it carries `context.model`. `conventions` documents every field, and `conventions.today` is 2026-10-27.

**Item fields:**
- `id`, `category`, `style`, `wording` and `utterance`;
- `context.{docType, model, title, documentId, state, refCandidates, frame}`;
- `expected.{target, op, args, ambiguousArgs, refArgs, argMatch, requiredPresent}`;
- `difficulty`, `tags`, `hardCase.{confusableWith, why}` and `notes`.

**`context` minus `frame`** describes the gold target document, after target resolution. That is the document the models run on, so the op and args can be scored as in the other sets. rt-sn-01's target cannot be known, so its context is the first of the two same-named notes. The op and args are the same on either.

**`context.frame`** is the UI state the resolver sees:
- `drive`: `{id, name}`.
- `target`: the tag. With a document open it is `{kind: "document", id, driveId, title, docType}`; with none open it is `{kind: "drive", id, name}`.
- `documents`: the other documents in the drive, `[{id, title, docType}]`, in no meaningful order.
- `visibleResults` (optional): `{source: "search" | "graph-focus", query, items[]}`, in display order.

**`expected.target`** scores the target:
- `resolution` is what the Q1 rule does before the models run:
  - `keep`: act on the open document;
  - `switch`: act on another document without asking;
  - `ask-two`: ask "change the open document or the named one";
  - `ask-top3`: ask with the top-3 picker.
- `via` says why: `verbatim`, `pointer-plus-name`, `several-names`, `shared-name`, `near-miss`, `drive-level-name`, `ordinal`, `ordinal-ref` or `none`. With `ordinal-ref`, the ordinal picks a ref and the target stays.
- `documentId` is the document the user means to change: what the card should name and Confirm should change, once any ask is answered as the user intends. It is null when no answer can be known; `intendedAmong` then lists the candidates.
- For `keep` and `switch`, `ruleDocumentId` is the document Q1 acts on. `q1Mistarget` is true when that differs from `documentId`.
- For `ask-two`:
  - `options` is `[open id, named id]`;
  - `intentChanges` is `open` or `named`;
  - `intentClear` is false when either answer is a fair reading. Those items list the other answer under `acceptable`, as `{documentId, op, ambiguousArgs, refArgs}`.
- For `ask-top3`, `mustInclude` holds the gold id. The ranking is not prescribed.

**noAction** entries carry `ruleResolution`, so the cost of an ask on a question can be counted. There is also one multiAction entry.

**Field classes** are unchanged from held-out-4:
- App-filled fields never appear.
- Ref ids appear only in `refArgs`, with values from `context.refCandidates`.
- String refs are `args` when the user typed the title. When the user pointed ("this"), the open document's title goes in `ambiguousArgs`, and the field is in `requiredPresent`. The String refs are `noteRef`, `childRef`, `targetRef`, the tension's `ref`, `promotedTo` and `claimRef`.

**`argMatch`** is per field:
- `ci`;
- `fuzzy`, for free text judged on meaning;
- `date`;
- exact, the default.

## Q1 as gold, and one conflict

`resolution` follows the overview's Q1, the resolved decision:
- One other title verbatim with no pointer: switch.
- A pointer at the open document plus one verbatim title: ask which of the two.
- Several names, or two documents sharing a name: keep the open document.
- With nothing open, a pointer has no referent, so the name is the target.
- Otherwise: ask with the top 3.

The vault plan §3.2 and §3.9 instead want **ask with the top 3 when several documents are named**. To keep both readable, `documentId` records the intent separately from the rule. Of the 9 several-name and shared-name items, **4 have `q1Mistarget: true`**: rt-mn-02, rt-mn-03, rt-sn-01 and rt-sn-02. There, keeping the open document changes the wrong document, or a document with no matching op. Those 4 are the evidence for the open choice between the two rules.

Edge cases the rule text settles, each with an item:
- The open document's own title mentioned: not another document.
- A title found only inside a longer mentioned title ("Raft" inside "Raft Leader Election"): does not count.
- An anaphoric "it" after a name: asks (§3.9).
- "this goal" or "this task": not a pointer at the document (rt-sw-13).
- Ordinals resolve before verbatim titles (overview §4).

## Counts

There are **64 items**, plus **6 noAction** and **1 multiAction**, over **30 distinct ops** in all 12 models.

| category | items | natural / paraphrase | plain / messy | easy / medium / hard | resolution |
| --- | --- | --- | --- | --- | --- |
| switch-verbatim | 13 | 8 / 5 | 5 / 8 | 1 / 7 / 5 | switch 13 |
| control (open document, no other title) | 7 | 3 / 4 | 4 / 3 | 3 / 2 / 2 | keep 7 |
| pointer-plus-name | 15 | 4 / 11 | 8 / 7 | 0 / 1 / 14 | ask-two 15 |
| several-names | 5 | 2 / 3 | 3 / 2 | 0 / 0 / 5 | keep 5 |
| shared-name | 4 | 2 / 2 | 4 / 0 | 0 / 0 / 4 | keep 4 |
| near-miss (non-verbatim) | 7 | 4 / 3 | 3 / 4 | 0 / 5 / 2 | ask-top3 7 |
| drive-level (nothing open) | 6 | 4 / 2 | 3 / 3 | 0 / 5 / 1 | switch 5, ask-top3 1 |
| ordinal (visible results) | 7 | 5 / 2 | 3 / 4 | 0 / 3 / 4 | switch 5, keep 2 |
| **total** | **64** | **32 / 32** | **33 / 31** | **4 / 23 / 37** | |

- **Resolution:** switch 23, keep 18, ask-two 15, ask-top3 8. Seven frames have no document open: the 6 drive-level items and rt-or-06.
- **Pointer-plus-name asks (15):**
  - the intent changes the open document in 9 and the named one in 6;
  - the intent is clear in 12 and unclear in 3 (rt-pn-07, rt-pn-11 and rt-pn-15).

  So on 12 of 15 the two-way ask costs a click that the intent did not need.
- **noAction (6):** 3 natural / 3 paraphrase, 3 plain / 3 messy. By `ruleResolution`: keep 3, switch 2, ask-two 1. The ask-two one is a comparison question, where the ask is pure cost.
- **Difficulty:** 37 of 64 are hard (58%), each with a `hardCase` whose `confusableWith` names real ops other than the item's own. By style: natural is 2 easy / 15 medium / 15 hard, and paraphrase is 2 / 8 / 22.
- **Arguments:**
  - 15 items use `refArgs`; the first candidate is the gold in 3 of them;
  - 24 use `ambiguousArgs`, 15 use `requiredPresent` and 30 use `argMatch`;
  - 6 score the op only: they have no args, and their only optional field is the free comment on lifecycle ops (a null `ambiguousArgs`).

**Ops:**

| op | items |
| --- | --- |
| moc:ADD_CORE_IDEA | 8 |
| knowledge-note:ADD_LINK | 8 |
| moc:ADD_OPEN_QUESTION | 4 |
| knowledge-note:ADD_TOPIC | 4 |
| knowledge-note:SET_NOTE_TYPE, wbs:CREATE_GOAL, tension:RESOLVE_TENSION, knowledge-note:APPROVE_NOTE | 3 each |
| observation:IMPLEMENT_OBSERVATION, tension:DISSOLVE_TENSION, project:ADD_KNOWLEDGE_REF, observation:PROMOTE_OBSERVATION, tension:ADD_INVOLVED_REF, project:SET_PROJECT_STATUS | 2 each |
| source:RECORD_EXTRACTION_STATS, wbs:SET_GOAL_STATUS, vault-config:UPDATE_MAINTENANCE_THRESHOLD, health-report:ADD_CHECK, pipeline-queue:FAIL_TASK, moc:UPDATE_ORIENTATION, source:SET_SOURCE_STATUS, research-claim:UPDATE_CLAIM_CONTENT, project:SET_TARGET_DATE, wbs:SET_PROJECT_REF, moc:ADD_CHILD_MOC, moc:REMOVE_CORE_IDEA, research-claim:ADD_RESEARCH_CONNECTION, derivation:ADD_SIGNAL, knowledge-note:ARCHIVE_NOTE, knowledge-note:SUBMIT_FOR_REVIEW | 1 each |

The multiAction entry has two `project:ADD_KNOWLEDGE_REF` steps.

**Models:** knowledge-note 20, moc 15, tension 7, project 5, wbs 5, observation 4, source 2, research-claim 2, and 1 each for vault-config, health-report, pipeline-queue and derivation. This is not an op-coverage set: the ops are the ones a retarget naturally hits. The minimum-distinct-ops assertion of the held-out sets is waived.

## Validation

Helper scripts, kept outside the repo:
- a builder, which is the source of truth for the JSON;
- a validator;
- a zod check;
- an overlap script.

**Validator: 0 errors.** It checks that:
- every op exists, and every item is scoped;
- `args` and `ambiguousArgs` hold only semantic fields;
- every required semantic field is in `args`, `ambiguousArgs` or `requiredPresent`;
- every required ref-id field is in `refArgs`, and every `refArgs` value is among `refCandidates`;
- the style split is within one item;
- hard items are at least 25%, each with a valid `hardCase`;
- the first candidate is correct at most 25% of the time (3 of 15);
- all 12 models appear;
- paraphrase items pass the stem rule. Natural items that use op words get warnings only: there are 31.
- the frame is consistent: the open document is not repeated, the gold document is in the drive and equals `context`, and ordinal targets are visible;
- the set contains no paths, emails or usernames.

The validator also **re-derives each item's resolution from the Q1 text** and asserts that it equals the gold. The re-derivation uses verbatim titles, longest first, case-insensitive. The open document's own title is not counted, and same-named documents count as shared. A pointer is "this", "it" or "here", but not "this goal" and the like.

**Zod: 69 of 69 inputs parse.** Each one goes through the model's `<Op>InputSchema().strict()`, with `args`, `refArgs` and non-null `ambiguousArgs` merged and app-filled placeholders added. That is 64 items, the 3 `acceptable` alternatives and 2 multiAction steps.

**Overlap:** checked against every eval-set file in this directory except the results files, 535 strings in all. The script printed only ids and scores. The final set has a maximum Jaccard of 0.38 and **no shared 4-gram**; 28 pairs share a 3-gram. The first pass found 8 utterances that shared a 4-gram, plus one pair at Jaccard 0.44. All were rewritten without looking at the other text.

**Not checked:** replaying the items through the reducers. The states are partial. They were checked by hand against the reducer preconditions:
- APPROVE needs IN_REVIEW, with an author other than the actor;
- SUBMIT needs DRAFT;
- ARCHIVE needs CANONICAL;
- RESOLVE and DISSOLVE need OPEN;
- there are no duplicate core-idea noteRefs, childRefs, topic names or knowledge refs;
- REMOVE_CORE_IDEA and FAIL_TASK use ids that exist;
- `sortOrder` gold is the next free position.
