# Change History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the vault chat and the plugin answer "what changed in X since Y" — executive summary first, then topic by topic down to before/after — from the operation history the vault already records.

**Architecture:** Source operations join `graph_operations` (new rows + a one-off backfill). A browser-safe pure module condenses a window of operation rows into change events grouped by MoC. The graph-indexer query layer feeds it; a GraphQL query and a REST route expose the digest; a chat tool and plugin docs consume it.

**Tech Stack:** TypeScript (nodenext, `.js` relative imports), kysely on PGlite/Postgres, Powerhouse subgraphs (GraphQL + HTTP routes), vitest, bun.

**Spec:** `docs/superpowers/specs/2026-11-04-change-history-design.md`

## Global Constraints

- bun locally (`bun run tsc`, `bun run lint:fix`, `bun run test`); never npm/pnpm. No `Bun.*` in shipped code.
- `processors/graph-indexer/changes.ts` and `changes-markdown.ts` import nothing from kysely, the processor, or the embedder (the chat bundle may import them).
- Read gate = the drive guard every `knowledgeGraph*` query already uses (not in `PRIVILEGED_RESOLVERS`); REST = `canonicalForRead`. Backfill = `canonicalForManage` / privileged.
- No document-model or reducer change.
- Dates are UTC; date-only `until` covers the whole day; date-only `since` starts 00:00Z.
- `events` page: default 50, max 200; `highlights` ≤ 5 per group; content hunks ≤ 6 per event, each ≤ 400 chars.
- `q=` scope: semantic search via `searchVault(subgraph, driveId, q, "SEMANTIC", 10, false)` + one-hop knowledge-edge neighbours, then `types`.
- Subgraph changes need `bun run build` + Switchboard restart to take effect.
- Significance order: superseded 6 > revised 5 > created 4 > source-revised 3 > archived 2 > approved/restored 1 > reverified 0; within a kind, larger diff first; ties by timestamp desc, then documentId.

## Review Focus

1. A window with tens of thousands of operations (the 2026-11-03 sync had 13,329 in hours) must answer in seconds — the SQL step aggregates before `input_json` is fetched (Task 5 test: 20k rows < 2 s on PGlite).
2. A note revised many times in the window reports ONE `revised` event whose `before` is the pre-window value, not the previous in-window edit (Task 3 test).
3. A note created before any operation was indexed (no baseline row) reports `before: null`, never crashes (Task 3 test).
4. A source re-ingested with identical text (the sync's 89 "unchanged" sources) is `reverified`-like for sources: reported as `source-revised` with `added: 0, removed: 0` and its ref change, ranked last among source events (Task 3 test).
5. An empty window, or a scope matching nothing, returns zero totals and `groups: []` — the chat must say "nothing changed", not invent (Task 3 + Task 8 tests).

---

### Task 1: `graph_operations.document_type` + source operations recorded

**Files:**
- Modify: `processors/graph-indexer/migrations.ts` (operation-history block, ~L126) — idempotent `addColumn("document_type", "varchar(64)")`, index `idx_graph_ops_type_ts (document_type, timestamp)`, backfill `UPDATE graph_operations SET document_type = graph_nodes.document_type FROM graph_nodes WHERE …` for null rows.
- Modify: `processors/graph-indexer/schema.ts` — `GraphOperation.document_type: string | null`.
- Modify: `processors/graph-indexer/index.ts` (source branch ~L272 and op insert ~L423) — write `document_type` on every row; for `bai/source` ops of a source that `isOurs`, insert a `graph_operations` row too (same id scheme `${documentId}-${index}`).
- Modify: `processors/graph-indexer/summarize.ts` — phrases for `INGEST_SOURCE` ("Ingested <title> (<git ref>)"), `SET_SOURCE_STATUS`, `ADD_EXTRACTED_CLAIM`, `RECORD_EXTRACTION_STATS`.
- Modify: `processors/graph-indexer/query.ts` `activity`, `activityByType`, `stale`, `recent` — exclude `document_type = 'bai/source'` so existing views are unchanged.
- Test: `tests/processor/graph-indexer.test.ts` (extend), `processors/graph-indexer/summarize.test.ts` (extend or create).

**Interfaces:** Produces `GraphOperation.document_type`; source rows in `graph_operations`.

- [ ] Write failing tests: migration adds the column and backfills a note row's type; feeding an `INGEST_SOURCE` op for an owned source inserts a row with `document_type: "bai/source"` and a summary containing the git ref from `method`; `activity()` does not return it.
- [ ] Run `bun run test tests/processor/graph-indexer.test.ts` — FAIL.
- [ ] Implement.
- [ ] Run the tests — PASS; `bun run tsc`.
- [ ] Commit `feat(graph-indexer): record source operations with a document_type`.

### Task 2: Source-history backfill

**Files:**
- Create: `processors/graph-indexer/source-history-backfill.ts` — `backfillSourceHistory(reactor: SourceOpReader, db: Kysely<DB>, sourceIds: string[]): Promise<{ sources: number; inserted: number; skipped: number; errors: string[] }>`; `SourceOpReader = { operations(documentId: string): AsyncIterable<{ index: number; type: string; input: unknown; timestampUtcMs: string; signer?: … }> }` over the reactor client's operation paging (global scope).
- Modify: `subgraphs/knowledge-graph/schema.ts` + `resolvers.ts` — mutation `knowledgeGraphBackfillSourceHistory(driveId: String!): SourceHistoryBackfill!`, added to `PRIVILEGED_RESOLVERS`; source ids from `graph_sources`.
- Modify: `subgraphs/http/routes/structure.ts` — kind `"admin/backfill-source-history"` (POST), `canonicalForManage`; register in `subgraphs/http/register.ts`.
- Test: `processors/graph-indexer/source-history-backfill.test.ts`, `subgraphs/http/routes/structure.test.ts` (extend).

- [ ] Failing tests: backfill inserts one row per source op with the Task 1 shape; a second run inserts 0 (`onConflict doNothing`); the route answers 403 to a WRITE-only caller and 200 to a manager.
- [ ] FAIL → implement → PASS → `bun run tsc` → commit `feat: backfill source operation history without a reindex`.

### Task 3: `changes.ts` — the pure digest builder (+ fixture)

**Files:**
- Create: `scripts/record-changes-fixture.mjs` — node script: given `--endpoint --drive --profile --since --until --out`, reads `knowledgeGraphActivity`-shaped rows plus source ops and the context below via read-only GraphQL, writes JSON. Run once against the live vault for 2026-11-03T18:00Z–2026-11-04T00:00Z, scoped to the "Data Processing and CQRS" MoC's members and their sources.
- Create: `tests/fixtures/changes/2026-11-03-processors.json` (output of the script).
- Create: `processors/graph-indexer/changes.ts`.
- Test: `processors/graph-indexer/changes.test.ts`.

**Interfaces (produced, used by Tasks 5–9):**
```ts
export type ChangeKind = "created" | "revised" | "superseded" | "archived" | "restored" | "approved"
  | "reverified" | "source-added" | "source-revised" | "source-archived" | "source-deleted";
export interface OperationRow { documentId: string; documentType: string; operationType: string;
  timestamp: string; index: number; inputJson: string | null; signerAddress: string | null }
export interface FieldChange { before: string | null; after: string }
export interface ContentChange { before: string | null; hunks: string[]; added: number; removed: number }
export interface ChangeEvent { kind: ChangeKind; documentId: string; documentType: string; title: string;
  at: string; by: string | null; significance: number;
  fields?: { title?: FieldChange; description?: FieldChange; content?: ContentChange };
  revisionNotes?: string[]; supersededBy?: { documentId: string; title: string; reason: string | null };
  version?: { before: string | null; after: string }; comment?: string | null;
  source?: { refBefore: string | null; refAfter: string | null; url: string | null; added: number; removed: number; hunks: string[]; noteIds: string[] };
  derivedFrom?: string[]; folded: Record<string, number> }
export interface ChangeTotals { created: number; revised: number; superseded: number; archived: number;
  reverified: number; sourcesRevised: number; sourcesAdded: number; documents: number; operations: number }
export interface ChangeGroup { key: string; kind: "moc" | "topic" | "folder" | "unplaced"; id: string | null;
  title: string; totals: ChangeTotals; highlights: ChangeEvent[] }
export interface ChangeScope { moc?: string; topic?: string; documentIds?: string[]; q?: string; types?: string[] }
export interface ChangeContext {
  nodes: Map<string, { title: string; documentType: string; status: string | null; topics: string[] }>;
  sources: Map<string, { title: string; folder: string | null; claimIds: string[] }>;
  mocsByNote: Map<string, { id: string; title: string; tier: "HUB" | "DOMAIN" | "TOPIC" }[]>;
  derivedFrom: Map<string, string[]>; edgeReason(source: string, target: string, type: string): string | null }
export interface ChangeDigest { window: { since: string; until: string }; scope: ChangeScope; totals: ChangeTotals;
  groups: ChangeGroup[]; events?: ChangeEvent[]; nextCursor?: string | null }
export function parseWindow(since: string, until?: string | null, now?: Date): { since: string; until: string };
export function buildChanges(rows: OperationRow[], baseline: OperationRow[], ctx: ChangeContext,
  window: { since: string; until: string }, opts: { scope: ChangeScope; limit?: number; cursor?: string | null }): ChangeDigest;
```
Rules (spec §2, §7): one event per kind per document; claim change = `SET_TITLE|SET_DESCRIPTION|SET_CONTENT`; `created` swallows in-window edits; `superseded` from an `ADD_RELATIONSHIP` row whose input type is `SUPERSEDES` targeting the document (reason from `edgeReason`, else from the row); git ref = the token after `git:` in `INGEST_SOURCE.method`; `revisionNotes` = `- ` lines under `## Revision history` present after but not before; group = most specific MoC (TOPIC > DOMAIN > HUB) else first topic else source folder else `unplaced`; `events` only when a scope key is set; cursor = base64 of the last `(significance, at, documentId)`. Line diff: LCS over lines, implemented in this file (no dependency exists).

- [ ] Record the fixture (script) and commit it with the script.
- [ ] Failing tests, against the fixture and small hand-built rows:
  - `parseWindow("2026-09-01", "2026-11-03")` → `{ since: "2026-09-01T00:00:00.000Z", until: "2026-11-03T23:59:59.999Z" }`.
  - fixture digest: `groups[0].title === "Data Processing and CQRS"`; `totals.revised` and `totals.created` equal counts computed in the test directly from the fixture rows; every `revised` event on a note with a `## Revision history` line added carries it in `revisionNotes`.
  - the 4 Review Focus cases 2–5 above, each as its own `it(...)`.
  - paging: `limit: 2` returns 2 events and a cursor; following it returns the next 2 with no overlap.
- [ ] FAIL → implement → PASS → commit `feat(graph-indexer): condense operations into a change digest`.

### Task 4: Markdown rendering

**Files:** Create `processors/graph-indexer/changes-markdown.ts` — `renderChangesMarkdown(d: ChangeDigest): string`. Test `processors/graph-indexer/changes-markdown.test.ts`.
Layout: `# Changes <since> → <until>`, a totals line, `## <group title>` per group with its totals and highlight bullets (`[[documentId]] title — kind: one-line before → after or ref change`), then `## Changes` with events when present, and a final `Next page: cursor=<…>` line.
- [ ] Failing snapshot test on the fixture digest from Task 3 → implement → PASS → commit.

### Task 5: Query layer — `changes()`

**Files:** Modify `processors/graph-indexer/query.ts` — `changes(window, scope: ChangeScope & { documentIds?: string[] }, opts): Promise<ChangeDigest>`. Test `tests/processor/graph-changes.test.ts` (PGlite, like `graph-indexer.test.ts`).
SQL: (1) per-document aggregate over `graph_operations` in the window (`document_type`, count, min/max timestamp, `bool_or` per event-making op type) restricted by scope ids when given; (2) fetch `input_json` only for event-making op types of those documents; (3) baseline = last `SET_TITLE|SET_DESCRIPTION|SET_CONTENT|SET_METADATA_FIELD(version)|INGEST_SOURCE` per document/field before `since`; (4) context from `graph_nodes`, `graph_topics`, `graph_sources`, `graph_edges` (CORE_IDEA for `mocsByNote`, DERIVED_FROM, metadata reasons). `moc` scope = that MoC's CORE_IDEA members, recursively through CHILD_MOC, plus their sources.
- [ ] Failing tests: seeded DB returns the same digest as `buildChanges` on the same rows; `moc` scope includes a child MoC's members; Review Focus 1: 20,000 seeded rows answer in < 2 s.
- [ ] FAIL → implement → PASS → commit.

### Task 6: GraphQL `knowledgeGraphChanges`

**Files:** Modify `subgraphs/knowledge-graph/schema.ts`, `resolvers.ts`; tests `schema.test.ts`, `resolvers.test.ts`.
`knowledgeGraphChanges(driveId: String!, since: String!, until: String, moc: String, topic: String, q: String, documentIds: [String!], types: [String!], limit: Int, cursor: String): ChangeDigest!` with GraphQL types mirroring Task 3 (`folded` as `JSON`/String, `fields` as nested types). `q` → `searchVault(subgraph, driveId, q, "SEMANTIC", 10, false)` ids + one-hop knowledge neighbours → `documentIds`. NOT in `PRIVILEGED_RESOLVERS`.
- [ ] Failing tests: a READ-only caller gets a digest; a non-reader is refused by the guard; `q` resolves to ids before `changes()` (mock `searchVault`).
- [ ] FAIL → implement → PASS → commit.

### Task 7: REST `GET changes`

**Files:** Create `subgraphs/http/routes/changes.ts` (`createChangesRoute(deps)`), register in `subgraphs/http/register.ts` (`http.get("changes", { auth: "renown" }, timedRoute("GET changes", …))`); test `subgraphs/http/routes/changes.test.ts`.
Query params as Task 6 (`documentIds` comma-separated); `canonicalForRead`; `Accept: text/markdown` → `renderChangesMarkdown`. Shares the Task 6 `q` resolution (extract it to `subgraphs/knowledge-graph/helpers/changes-scope.ts`, `resolveChangeScope(subgraph, driveId, scope): Promise<ChangeScope>`).
- [ ] Failing tests: 400 without `drive`/`since`; 403 for a non-reader; JSON and markdown bodies; same totals as the GraphQL resolver for the same args.
- [ ] FAIL → implement → PASS → commit.

### Task 8: Chat tool `what_changed`

**Files:** Modify `editors/knowledge-vault/lib/chat/vault-tools.ts` (schema in `VAULT_TOOLS`, `case "what_changed"`, `LIMITS.changes = { default: 30, max: 100 }`), `system-prompt.ts`; tests `vault-tools.test.ts`, `system-prompt.test.ts`.
Tool params: `since` (required ISO), `until`, `moc`, `topic`, `query`, `cursor`; calls `knowledgeGraphChanges` through `gql(graphEndpoint(), …)`; returns the digest with ENS names resolved for `by` (existing `resolveEnsNames`). Description and prompt rule: questions about change over time → `what_changed`, never search; answer = executive summary from `totals` + group highlights, then offer the groups as topics; a topic follow-up → `what_changed` with `moc`; state the dates used; cite `[[documentId]]`; quote before → after; name the replacement of a superseded note; an empty digest → say nothing changed in that window.
- [ ] Failing tests: tool schema present; handler passes `moc`/`query`/`cursor` through; empty digest yields a result the prompt test pins to "nothing changed"; system prompt contains the routing rule.
- [ ] FAIL → implement → PASS → `bun run tsc && bun run lint:fix && bun run test` → commit.

### Task 9: Plugin (`../powerhouse-knowledge`) + end-to-end acceptance

**Files (other repo):** `skills/rest-api/SKILL.md` (route row + params + markdown), `skills/search/SKILL.md` (new section "What changed — time questions" before "Search tiers": summary first via `GET changes?since=`, drill-down with `moc=`/`q=`), `AGENT.md` § Which surface to use (one row); regenerate with `node scripts/build-agent.mjs`.
- [ ] Edit, regenerate, commit in the plugin repo `docs: answer "what changed" from GET changes`.
- [ ] Acceptance (this repo): `bun run build`; restart local `ph vetra`; on a local vault seeded from the Task 3 fixture run spec acceptance 1–5 (chat + `curl …/changes`), record results in the PR description.
- [ ] After deploy to the remote vault (user's action): `POST admin/backfill-source-history?drive=<id>` once, then acceptance 1–2 live.

---
Self-review: spec §1→T1/T2, §2→T3, §3→T3/T5, §4→T6/T7/T4, §5→T8, §6→T9, §7 settled semantics→T3/T5/T6, acceptance→T9. Types defined once (T3) and reused by name.
