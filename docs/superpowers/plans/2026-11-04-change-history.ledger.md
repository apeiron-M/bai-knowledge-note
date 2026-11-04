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
Task 3: complete (commits a203be1..9fe4ae1, tests: bun run test processors/graph-indexer/changes.test.ts → 22/22 pass; tsc clean)
## Task 4
Task 4: Ruling: an empty digest renders "Nothing changed in this window." under the heading (no totals line, no groups) — Review Focus 5 — cost if wrong: none.
Task 4: Ruling: content/source hunks are rendered under each event in `## Changes` as indented ```diff blocks; highlight bullets carry one-line details only — cost if wrong: layout only.
Task 4: complete (commits 9fe4ae1..52ed0ba, tests: bun run test processors/graph-indexer/changes-markdown.test.ts → 2/2 pass; tsc clean)
## Task 5
Task 5: Ruling: implementation lives in processors/graph-indexer/changes-query.ts (`loadChanges`); query.ts exposes it as `changes(window, scope, opts)` — keeps query.ts from growing — cost if wrong: none.
Task 5: Ruling: SQL shape = one pass over the window selecting every row's columns but `input_json` only via CASE for event-making ops (SUPERSEDES links and version stamps matched by LIKE); baseline = row_number() per (document, operation type) before `since`, plus all pre-window PATCH_CONTENT rows; plus one extra query for in-window SUPERSEDES rows outside the scope (they live on the replacing note). Measured: 20k rows well under 2 s on PGlite — cost if wrong: LIKE patterns assume JSON.stringify's compact `"key":"value"` spelling (true for every writer here).
Task 5: Ruling: `moc` scope = the map + CHILD_MOC descendants + their CORE_IDEA notes + those notes' sources (DERIVED_FROM targets that are sources, or sources whose claimIds include a note); `topic` = notes with that topic + their sources; both intersect explicit `documentIds`. The query layer passes resolved ids to buildChanges and echoes the caller's scope — cost if wrong: none.
Task 5: Ruling: source folder is null in the live context (graph_sources keeps no parent folder), so a source with no grouped claim notes lands in "Unplaced" — cost if wrong: such sources are grouped less usefully; fix would add a folder lookup.
Task 5: Ruling: fixed an existing id collision found while recording the fixture — document-scope ops (CREATE_DOCUMENT idx 0, UPGRADE_DOCUMENT idx 1) shared `<doc>-<index>` ids with the first global ops, so `onConflict doNothing` silently dropped a note's first global operations (its first SET_TITLE etc., i.e. baselines). Non-global rows now use `<doc>-<scope>-<index>` (the scheme link rows already use); test "graph_operations ids by scope" RED→GREEN. Existing rows are untouched; a reindex fills the lost ones — cost if wrong: none for global ids.
Task 5: complete (commits 52ed0ba..8603796, tests: bun run test tests/processor processors subgraphs → 730/730 pass; tsc clean)
## Task 6
Task 6: Ruling: the shared `q` resolution (planned for Task 7) lands now in subgraphs/knowledge-graph/helpers/changes-scope.ts — `resolveChangeScope` plus `loadDriveChanges` (window parse, q, scope echo) — so GraphQL and REST share one code path from the start — cost if wrong: none.
Task 6: Ruling: GraphQL types are prefixed `KnowledgeGraphChange*` (gateway-wide type namespace); `folded` is `[KnowledgeGraphChangeCount!]!` (operationType, count) — the subgraph SDL has no JSON scalar — cost if wrong: clients read a list instead of a map.
Task 6: Ruling: `q` neighbours = endpoints of knowledge-typed edges (KNOWLEDGE_LINK_TYPES, which include DERIVED_FROM/CORE_IDEA — so a hit's sources and maps join the scope); derived edges (INVOLVES, CITES…) do not — spec §7 "one-hop knowledge-edge neighbours" — cost if wrong: scope slightly wider/narrower.
Task 6: Ruling: the digest exposes `by` (signer address) and claim text diffs to READ callers, while knowledgeGraphActivity/History stay write-gated as "an audit log and an address book" — this is the spec's explicit coordinator call (§4: read-gated at the drive); flagged for the user, not changed — cost if wrong: contributor addresses visible to drive readers.
Task 6: Ruling: a malformed since/until is a GraphQL BAD_USER_INPUT (REST: 400) — cost if wrong: none.
Task 6: complete (commits 8603796..885a012, tests: bun run test subgraphs/knowledge-graph/ → 50/50 pass; tsc clean)
## Task 7
Task 7: Ruling: the route takes a `loadChanges(driveId, args)` dep (live: `loadDriveChanges(subgraph, …)`, the same function the resolver calls) instead of re-implementing scope resolution; the "same totals" test runs both surfaces over one real PGlite index — cost if wrong: none.
Task 7: Ruling: `since` is required on REST (400 without it), matching GraphQL's `since: String!` — cost if wrong: none.
Task 7: Ruling: documented the route in docs/http-api.md's table — cost if wrong: none.
Task 7: complete (commits 885a012..91c51c8, tests: bun run test subgraphs/http/routes/changes.test.ts → 6/6 pass; tsc clean)
## Task 8
Task 8: Ruling: the prompt's old rule sent "anything about time" to recent_changes; it now sends change over a period to what_changed (never search) and keeps recent_changes for "the latest edits as a list" — both tools coexist — cost if wrong: the model picks recent_changes for a period question (prompt test pins the routing).
Task 8: Ruling: what_changed takes a `limit` too (LIMITS.changes 30/100) beside the plan's since/until/moc/topic/query/cursor; `query` maps to GraphQL `q`; the tool summary for an empty digest starts "nothing changed between <since> and <until>" and the prompt says "When totals.documents is 0, say nothing changed in that window" — cost if wrong: none.
Task 8: Ruling: ENS names are resolved for every `by` in highlights and events (byName beside by) — cost if wrong: none.
Task 8: Ruling: tool-count assertions updated (VAULT_TOOLS 19→20, use-chat's offered tools 24→25); lint errors in Task 2/6/7 tests (unbound-method, import() type annotations) fixed in this commit — cost if wrong: none.
Task 8: complete (commits 91c51c8..ac9ad29, tests: bun run test → 3424 passed / 6 skipped (332 files); bun run tsc clean; bun run lint:fix exit 0 (warnings only))
## Task 9
Task 9: plugin repo /home/beast/Documents/Powerhouse/powerhouse-knowledge (main), local commit f83e35d `docs: answer "what changed" from GET changes` — not pushed.
Task 9: Ruling: AGENT.md gets both the plan's one row in § Which surface to use AND the spec's "short changes section" (§ What changed, 8 lines); rest-api also lists `admin/backfill-source-history` — spec §6 asks for a section — cost if wrong: none.
Task 9: Ruling: local acceptance PENDING — `ph vetra` is not running in this session and the brief forbids starting long-running servers. `bun run build` was run (exit 0; server-build check ok; `knowledgeGraphChanges` and `admin/backfill-source-history` present in dist/node). The spec's "local vault seeded from the Task 3 fixture" has no seeding path (the fixture is operation rows, not documents); the pure/DB equality on the fixture is covered by tests/processor/graph-changes.test.ts. Commands for the user:
  1. `bun run build` (done) then restart the Switchboard: `ph vetra`
  2. `BASE=http://localhost:4001/api/@powerhousedao/knowledge-note; AUTH="Authorization: Bearer $(switchboard auth token)"; DRIVE=<local vault drive id>`
  3. `curl -s -H "$AUTH" -X POST "$BASE/admin/backfill-source-history?drive=$DRIVE"` (manager) → `{ sources, inserted, skipped, errors }`; run again → `inserted: 0`
  4. Acceptance 1: `curl -s -H "$AUTH" "$BASE/changes?drive=$DRIVE&since=2026-09-01" | jq '{totals, groups: [.groups[] | {title, id, totals}]}'`; chat: "What changed in the Powerhouse stack since 2026-09-01?" → same totals (acceptance 5)
  5. Acceptance 2: `curl -s -H "$AUTH" -H 'accept: text/markdown' "$BASE/changes?drive=$DRIVE&since=2026-09-01&moc=<Data Processing and CQRS id>"`
  6. Acceptance 3: a `superseded` event in step 5's events carries `supersededBy.reason`
  7. Acceptance 4: a read-only token gets 200; a non-reader gets 403 (`code: FORBIDDEN`)
Task 9: Ruling: "after deploy to the remote vault" (POST admin/backfill-source-history once, then acceptance 1–2 live) is the user's action — skipped here — cost if wrong: n/a.
Final review: not dispatched by the implementer — coordinator runs the whole-branch review (coordinator's instruction).
