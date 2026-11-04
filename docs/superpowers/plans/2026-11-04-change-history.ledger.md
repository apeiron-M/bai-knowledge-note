# SDD ledger — plan: docs/superpowers/plans/2026-11-04-change-history.md

Spec: docs/superpowers/specs/2026-11-04-change-history-design.md (binding). Executor: inline (executing-plans). Branch base: b5e2aa95.

Setup: Ruling: ledger kept here (docs/superpowers/plans/2026-11-04-change-history.ledger.md), not in .superpowers/sdd/ — coordinator's instruction; it is committed with the work — cost if wrong: none.

## Pre-flight (shared interfaces)
| Producer → consumer | Produces / consumes | Finding |
|---|---|---|
| T1 → T2 | `graph_operations.document_type`, source op row shape (`<docId>-<index>`, summary) | Consistent; T2 reuses T1's row builder. |
| T1 → T5 | `document_type` column for filtering | Consistent. |
| T3 → T4/T5/T6/T7/T8 | `ChangeDigest`, `ChangeEvent`, `ChangeScope`, `buildChanges`, `parseWindow` | Defined once in T3; consumed by name. |
| T5 → T6/T7 | `changes(window, scope, opts)` | T6/T7 share `resolveChangeScope` (T7 extracts it); T6 written so the helper lands in T6 already. |
| T4 → T7 | `renderChangesMarkdown` | Consistent. |
| T6 → T8 | GraphQL `knowledgeGraphChanges` shape | T8 selects fields from T6's types. |

## Task 1
Task 1: Ruling: only the five source actions the spec names (INGEST_SOURCE, SET_SOURCE_STATUS, ADD/REMOVE_EXTRACTED_CLAIM, RECORD_EXTRACTION_STATS) are recorded; attachment ops stay out — spec §1 lists exactly these — cost if wrong: attachment changes absent from history (one set entry to add).
Task 1: Ruling: the source-op row is written whenever the source is ours, even without resultingState (the source row still needs it) — history is about the op, not the state — cost if wrong: none.
Task 1: Ruling: two existing tests (indexed-kinds "ignores document types outside the indexed set", source-rows "never becomes … activity") asserted sources have NO history rows; updated them to the spec's new rule (history row typed bai/source, still no node, still not in activity()) — spec §1 changes this deliberately — cost if wrong: none.
Task 1: Ruling: the activity/stale filter is `document_type IS NULL OR <> 'bai/source'` (a plain `<>` would drop untyped legacy rows) — cost if wrong: none.
Task 1: Ruling: extracted the row builder to processors/graph-indexer/operation-row.ts (operationRowOf, RECORDED_SOURCE_ACTIONS) so Task 2's backfill writes byte-identical rows; added gitRefOf to summarize.ts (browser-safe, reused by changes.ts) — cost if wrong: none.
Task 1: Ruling: "recent" in the plan's list reads graph_nodes, not graph_operations — no filter needed there — cost if wrong: none.
Task 1: complete (commits b5e2aa9..3567560, tests: bun run test tests/processor/ → 263/263 pass; bun run tsc clean)
## Task 2
Task 2: Ruling: GraphQL `knowledgeGraphBackfillSourceHistory` is write-gated (PRIVILEGED_RESOLVERS), REST `admin/backfill-source-history` is manage-gated — the GraphQL guard only knows read/write and `knowledgeGraphReindex` has the same split; spec's "canManage-gated" holds on REST — cost if wrong: a writer (not manager) can run an idempotent insert-only backfill over GraphQL.
Task 2: Ruling: the route passes the canonical drive id (from canonicalForManage) to the backfill, unlike admin/reindex which passes the raw param — the namespace is keyed on the canonical id — cost if wrong: none.
Task 2: Ruling: added a row to docs/http-api.md for the new route — the route table is the documented surface — cost if wrong: none.
