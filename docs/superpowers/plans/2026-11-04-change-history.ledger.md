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
Task 2: complete (commits 3567560..a203be1, tests: bun run test subgraphs/ processors/ tests/processor → 702/702 pass; tsc clean)
## Task 3
Task 3: Ruling: the fixture script reads each scoped document's log with `documentOperations` (global + document scope), not `knowledgeGraphActivity` — activity is write-gated, unscoped and capped, and the deployed index has no source rows yet; rows are converted to the same graph_operations shape — cost if wrong: fixture rows differ from the index's in ways the index would drop (e.g. the id collision noted under Task 5).
Task 3: Ruling: fixture = window 2026-11-03T18:00Z–2026-11-04T00:00Z, MoC "Data Processing and CQRS" + its CHILD_MOC maps + CORE_IDEA members + notes superseding a member + the members' DERIVED_FROM sources; 1713 window rows, 305 baseline rows; 2.7 MB because INGEST_SOURCE inputs carry the source text the diff needs — cost if wrong: repo weight.
Task 3: Ruling: claim change = SET_TITLE, SET_DESCRIPTION/UPDATE_DESCRIPTION (MoC), SET_CONTENT/UPDATE_CLAIM_CONTENT and PATCH_CONTENT (replayed onto the running content) — the live window has PATCH_CONTENT and MoC UPDATE_DESCRIPTION ops that are claim edits; spec names only the SET_* trio — cost if wrong: a MoC description edit counts as "revised".
Task 3: Ruling: significance: source-added = 3 (spec/plan omit it; ranked with source-revised); a source re-ingested with identical text keeps kind source-revised (added 0/removed 0, ref change) but significance 0 so it ranks last among source events (Review Focus 4) — cost if wrong: ordering only.
Task 3: Ruling: a re-ingest is "source-revised" when an earlier INGEST row exists, OR the source row's addedAt < since (optional `addedAt` added to ChangeContext.sources), OR the window holds >1 ingestion — so an index not yet backfilled still tells revisions from additions — cost if wrong: refBefore null on such sources until backfill.
Task 3: Ruling: a created document may also carry `superseded` (not its own edit); all its other in-window ops are its creation — spec §7 — cost if wrong: none.
Task 3: Ruling: `folded` counts go on the document's most significant event only (no double counting); archived/restored = the last of the two in the window; approved `by` = input.actor, else signer — cost if wrong: display only.
Task 3: Ruling: event order = significance desc, diff size desc, at desc, documentId, kind; cursor = base64 JSON of those five (plan said three; diff size and kind are needed for a total order) — cost if wrong: none (opaque).
Task 3: Ruling: group order = unplaced last, then the group's top significance, then document count, then title; fixture puts "Data Processing and CQRS" first as the plan's test expects — cost if wrong: summary ordering.
Task 3: Ruling: `source-deleted` is implemented but only reachable when a DELETE_DOCUMENT/PURGE row is present; the live indexer's deleteNode prunes a deleted document's history rows, so live digests will not show it — not changed (deletion pruning is existing, deliberate behaviour) — cost if wrong: deleted sources invisible in the digest.
Task 3: Ruling: fixture loader lives in tests/fixtures/changes/load.ts (shared by Tasks 3–5 tests) — cost if wrong: none.
Task 3: Ruling (process): changes.ts was written before its test file in this task (TDD order not kept); the tests then ran and one failed (the test's own re-derivation missed UPDATE_DESCRIPTION), fixed in the test — cost if wrong: weaker evidence that each test can fail; the review-focus tests exercise distinct branches.
