# Change history: "what changed in X since Y"

Status: approved 2026-11-04 · 2026-11-04 · Scope: endpoint, chat, plugin (the vault-app screen is phase 2)

## Why

A vault is updated continuously — sources re-ingested at a new version, notes revised, superseded, archived. Every one
of those changes is already recorded as a signed operation. But nobody can ask the vault what changed: search ranks by
meaning and ignores time, and the two history tools the chat has (`recent_changes`, `document_history`) answer "what
was touched last" and "what happened to this one document", one document at a time, with a content edit described as
"Content updated (N chars)".

The trigger: after syncing the Powerhouse monorepo from v6.2.2-dev.74 to v6.2.3-dev.91+e0f277d (304 sources, several
hundred notes revised, created or superseded), the question "what changed in the Powerhouse stack since summer?"
returned generic overview notes. The history was all there; nothing could read it as a collection.

**Goal:** any reader — in the vault chat, or through an agent using the plugin — can ask what changed in a
collection of notes and sources over a period, and gets an **executive summary first**, then can **explore topic by
topic**, down to the before/after of individual claims, every statement cited.

**Non-goals (now):** the vault-app history screen (phase 2, built on this endpoint); server-side LLM summarisation
(the endpoint is deterministic; the chat model writes the prose); cross-drive history; changing any document model.

**Anti-goals:** a hand-written or per-sync summary document (does not survive the next update); answering from raw
operations (13,329 operations on 985 documents on 2026-11-03 alone — mostly metadata stamps and link writes).

## What exists (checked 2026-11-04)

- `graph_operations` (graph indexer): one row per operation for every **indexed** type (notes, MoCs, research claims,
  tensions, observations, scopes, WBS) and every relationship op — `document_id, operation_type, timestamp, index,
  scope, summary, input_json, signer_*`. `input_json` holds the full action input, so a `SET_CONTENT` row carries the
  whole new body (682 of 684 on 2026-11-03). Indexed on `timestamp`.
- **Sources are excluded on purpose** (`index.ts`: "a source is kept only as its row — no edges, no activity"); only
  their latest state lives in `graph_sources`. Their revisions — each `INGEST_SOURCE` with text, `method`
  (`sha256:… git:<ref>`), `url`, `publishedAt` — exist only in the reactor's operation log.
- `knowledgeGraphHistory` / `knowledgeGraphActivity` expose `graph_operations`, write-gated.
- Chat `document_history` reads one document's reactor operations; `recent_changes` lists the latest change per document.
- `source-timeline.ts`: a pure function shared by subgraph, HTTP route and editor — the pattern to copy.

## Design

### 1. Sources join the operation history
Record source operations (`INGEST_SOURCE`, `SET_SOURCE_STATUS`, `ADD_EXTRACTED_CLAIM`, `REMOVE_EXTRACTED_CLAIM`,
`RECORD_EXTRACTION_STATS`) in `graph_operations`, still without making sources graph nodes. Add a `document_type`
column (migration; backfilled from `graph_nodes` / `graph_sources`) so queries can tell kinds apart without a join that
sources would fail. Views that assume node rows (`activity`, `recent`) keep their current behaviour by filtering on it.
Backfill *(coordinator's call — the user approved the design without choosing; this one does not disturb the live
index)*: a dedicated, idempotent backfill — a `knowledgeGraphBackfillSourceHistory(driveId)` mutation and matching
`POST admin/backfill-source-history` route, `canManage`-gated — reads each source's operation log from the reactor and
inserts the missing `graph_operations` rows (`onConflict doNothing` on the existing `<documentId>-<index>` id). No
reindex, no window in which search reads a half-built index. A future full reindex fills the same rows naturally.
*(Review fix, 2026-11-04.)* An index written before this feature also lost each document's first two **global**
operations: document-scope `CREATE_DOCUMENT`/`UPGRADE_DOCUMENT` (indices 0 and 1) were stored under the same
`<doc>-<index>` ids. A migration moves non-global rows to `<doc>-<scope>-<index>` (idempotent; a duplicate of an
already-scoped row is deleted), and the backfill takes `all: true` / `?scope=all` to write every global operation of
every indexed document as well, filling the freed ids. Both surfaces check `canManage` (the GraphQL resolver asks it
itself, beyond the guard's write check).

### 2. Change events — one pure module
`processors/graph-indexer/changes.ts` (no kysely, no embedder — importable by the browser like `summarize.ts`):

```
buildChanges(ops: OperationRow[], baseline: Map<docId, Snapshot>, context: {nodes, sources, memberships, edges}, window)
  → ChangeDigest
```

Per document in the window, operations collapse into **events** (one per kind, the window's net effect):

| Event | From | Carries |
|---|---|---|
| `created` | `CREATE_DOCUMENT` in window | title, type, source it derives from |
| `revised` | `SET_TITLE` / `SET_DESCRIPTION` / `SET_CONTENT` | per field: before (baseline) → after; content as diff hunks (capped) plus the text of any `## Revision history` entries added in the window |
| `superseded` | `SUPERSEDES` edge added into the doc | by whom (the replacing note), the edge's reason |
| `archived` / `restored` / `approved` | lifecycle ops | actor, comment |
| `reverified` | `SET_METADATA_FIELD version` with no claim change | version before → after |
| `source-revised` | `INGEST_SOURCE` on an existing source | ref before → after (from `method`/`url`), text diff stats + hunks, notes derived from it |
| `source-added` / `source-archived` | first `INGEST_SOURCE` / status `ARCHIVED` | title, origin |

Everything else (topics, other metadata, link writes) is counted on the event it belongs to, never listed.
**Baseline** = each field's last value before `since` (last `SET_*` / `INGEST_SOURCE` row before the window).
**Significance** for ordering: superseded > revised (by diff size) > created > source-revised > archived > reverified.

### 3. The digest — grouped for an executive summary
```
ChangeDigest {
  window: {since, until}, scope,
  totals: {created, revised, superseded, archived, reverified, sourcesRevised, sourcesAdded, documents, operations},
  groups: [ { moc: {id, title} | {topic} | "unplaced",
              totals, highlights: Event[≤5] } ],     // the summary layer
  events?: Event[], nextCursor?                        // only when scope narrows to one group or a doc set
}
```
Grouping: a note goes to the MoCs holding it as `CORE_IDEA` (most specific tier first), else its first topic, else
"unplaced"; a map's own changes group under the map itself; a source goes where most of its `extractedClaims` go, else
its `/sources` folder (read from the drive tree per digest, as the source timeline does — `graph_sources` keeps no
folder).
**Scope** (all optional, combinable): `moc`, `topic`, `documentIds`, `q` (semantic search → the hit set plus its
one-hop neighbourhood, so "what changed in processors" works without knowing a MoC id), `types`.

### 4. Surfaces
- GraphQL: `knowledgeGraphChanges(driveId, since, until, moc, topic, q, documentIds, limit, cursor): ChangeDigest`.
- REST: `GET changes?drive=&since=&until=&moc=&topic=&q=&limit=&cursor=`; `Accept: text/markdown` renders the digest
  as a readable report (for the plugin and `llms`-style consumers).
- **Read-gated at the drive**, exactly like every other `knowledgeGraph*` query: the subgraph's drive guard
  (`assertCanRead` on the drive, `resolvers.ts`) and `canonicalForRead(drive)` on the route — one check, 403 for a
  non-reader, no per-document filtering. A drive grant inherits to every document beneath it, and the graph index has
  never honoured per-document protection below the drive; this feature does not change that. *(Coordinator's call.)*
  `knowledgeGraphHistory`/`Activity` keep their write gate.

### 5. Chat
New tool `what_changed {since, until?, moc?, topic?, query?}` (ISO dates; the model resolves "since summer" and says
which date it used). System-prompt rule: questions about change over time go to `what_changed`, never search; answer
with an executive summary from `totals` + group `highlights`, then offer the groups as topics to explore; a follow-up
on a topic calls `what_changed` scoped to it and walks through its events, citing `[[documentId]]`, quoting
before → after for revised claims and naming the replacement for superseded ones.

### 6. Plugin (`../powerhouse-knowledge`)
`skills/rest-api` documents the route; `skills/search` routes temporal questions to it (summary first, then
`moc=`/`q=` drill-down); a short `changes` section in AGENT.md.

### 7. Settled semantics *(coordinator's calls, from the builder check)*
- **Scope of an index:** one graph-indexer namespace per vault drive; `graph_operations` needs no drive column.
  Source ops whose document has no `graph_sources` row (deleted sources) are typed `bai/source` from the op itself
  (`INGEST_SOURCE` and friends are source-only actions) and reported as `source-deleted` when a delete op exists.
- **Baseline:** the last value of each field before `since`. A field with no earlier value has `before: null`
  (rendered "not set before"). A document created in the window reports `created` only — its in-window edits are its
  creation. A document may carry several events (e.g. `revised` + `superseded`); `totals.<kind>` counts events,
  `totals.documents` counts distinct documents.
- **Claim change** = `SET_TITLE`, `SET_DESCRIPTION` or `SET_CONTENT`. `reverified` = a `version` change in a window
  with no claim change.
- **Supersession** comes from the `ADD_RELATIONSHIP` rows already in `graph_operations` (`input_json` holds
  `sourceId`, `targetId`, `relationshipType`, `metadata.reason`), timed by the row; the current reason is read from
  `graph_edges.metadata`. **Derived from** = the note's `DERIVED_FROM` edges; a source's notes = its
  `extractedClaims` (`graph_sources`).
- **`## Revision history`** is a content convention introduced by the 2026-11-03 sync (one bullet per revision:
  `- <version> (<date>): <what changed and why>`). It is optional enrichment: lines added in the window are attached
  to the `revised` event; nothing depends on it.
- **Paging:** `groups` are never paged (every group with ≥ 1 event, `highlights` ≤ 5). `events` are returned whenever a
  scope is given (`moc`, `topic`, `documentIds`, `q`) and paged by `limit` (default 50, max 200) with an opaque cursor
  over the deterministic order (significance, timestamp, documentId).
- **`q=`:** semantic search, top 10 hits, plus their one-hop knowledge-edge neighbours, then the `types` filter. Same
  code path for GraphQL and REST, so chat and plugin totals match.
- **Dates:** UTC. A date-only `until` includes that whole day; a date-only `since` starts at 00:00Z; a timestamp
  without an offset is UTC. History timestamps are stored in `toISOString()` form (writers normalise, a migration
  rewrites older rows) so that string order is time order; a row whose timestamp is not ISO is skipped.
- **Cursor:** carries the window's end, so paging without `until` stays on one window; an unreadable cursor is
  `BAD_USER_INPUT` / 400.
- **Payload caps:** a revised body's `before` is its first 400 characters (the hunks carry the diff); a source event
  names its first 20 notes plus `noteCount`; a source whose earlier text was never recorded reports `added`/`removed`
  as null ("earlier version not recorded"), not 0. Line counts are linear (a moved line is not counted); hunks are
  computed only for the events shown (highlights and the current page).
- **Chat transport:** `what_changed` calls `knowledgeGraphChanges` over GraphQL (like the other vault tools) and gets
  JSON; the markdown rendering is for REST consumers. `changes.ts` stays browser-safe for import hygiene and so the
  editor can fall back to it against an older server, as `source-timeline.ts` does.
- **Fixtures:** record op rows from the live vault (the 2026-11-03 sync window) into a test fixture; the numbers in the
  acceptance list are re-derived from that fixture at build time, not hard-coded.

## Constraints
- Subgraph changes reach the Switchboard only after `bun run build` + restart (CLAUDE.md).
- `changes.ts` must stay browser-safe (the chat runs in the browser): no processor/kysely imports.
- No document-model change; no reducer change; the remote-first chat path must keep working in Connect's replicating mode.
- Size: windows can hold tens of thousands of ops — aggregate in SQL by document first, fetch `input_json` only for the
  fields that become events; cap diff hunks and events per page.

## Acceptance (against the live vault)
1. "What changed in the Powerhouse stack since 2026-09-01?" → summary naming the new workflow engine, hosts/runners,
   erasure, undo v3, client read/write split, delegated signers, custom scalars; totals match a SQL count.
2. Drill into "Data Processing and CQRS" → the 13 revised processor notes with before/after, 20 created, the 7 source
   revisions with refs `v6.2.2-dev.74 → v6.2.3-dev.91+e0f277d`.
3. A superseded note is reported with its replacement and the SUPERSEDES reason.
4. A reader without write access gets the digest; a non-reader gets 403.
5. The same question through the plugin's REST route returns the same totals as the chat.

## Left to the builder
Diff algorithm and hunk caps; SQL shape; cursor format; exact markdown layout; test fixtures (pure-function tests on
recorded op rows from today's sync, route tests, chat-tool tests).

---

## Addendum A — the knowledge story (approved 2026-11-04, after local testing)

**Why.** Testing the first build in the vault chat showed the answer led with documents and operations ("33 created,
338 revised, 5 superseded — 371 documents, 7,205 operations"). That is the plumbing. The reader — think of a CEO — wants
to know **what the vault knows now that it did not before**: how it grew, what new knowledge arrived and how it relates
to the main themes, and what the vault now understands *differently* ("in the summer the reactor did X; now it does Y,
because Z"). Counts and ids stay in the digest for the plugin and for drill-downs; they never lead the answer.

**Main topics** are the hub's top-level areas: the MoCs that are `CHILD_MOC` of the single HUB. Every note belongs to
the area(s) whose subtree holds it as a `CORE_IDEA` (descendant MoCs included); a note in no area is "elsewhere".

### A1. The digest gains a `story` (semantic layer), computed by the same pure module
```
story: {
  growth: { notesThen: number, notesNow: number, newAreas: {id,title}[], newMaps: {id,title,area}[] },
  areas: [ {                                   // hub top-level areas with any change, most changed first
    id, title,
    notesThen, notesNow,                        // CANONICAL/IN_REVIEW/DRAFT notes in the subtree, not archived, at since / now
    newClaims:     Claim[]   (≤ 8),             // notes created in the window, most connected first
    changedClaims: Shift[]   (≤ 8),             // the vault now says something different
    retiredClaims: Claim[]   (≤ 5),             // archived in the window with no replacement
  } ],
}
Claim = { documentId, claim: string /* title */, gist: string|null /* description */ }
Shift = { documentId, then: { claim, gist }, now: { claim, gist }, why: string|null, replacedBy?: documentId }
```
- **then** = the note's title/description as they stood at `since` (the existing baselines); **now** = current values.
  A supersession is a Shift whose *then* is the old note and *now* the replacing note, `why` = the SUPERSEDES reason.
  A revision's `why` = the `## Revision history` line added in the window, else null. A Shift is only emitted when the
  claim text (title or description) actually differs — a version stamp alone is not a shift.
- "Most connected first" = incoming knowledge-edge count (graph_edges), ties by recency.
- A **scoped** request (`q`, `moc`, `topic`) returns the same `story` restricted to the scope; for a `q` / `topic`
  scope it also returns `thenVsNow: { then: Claim[] (≤ 12), now: Claim[] (≤ 12) }` — the scope's claims as the vault
  held them at `since` (notes that existed and were not archived then, with their then-titles) versus now. This is what
  answers "how did the reactor work in the summer, and how does it work now".

### A2. Chat
- `what_changed` returns `story` (and `thenVsNow` when scoped) as the main payload; totals become one short line; ids
  are kept only for citations. The unscoped call no longer returns per-document highlights.
- System prompt for change-over-time answers: write for a non-technical executive, in four parts — **how the vault
  grew** (areas that grew, new areas, how they connect to the main themes), **what is new** (the substance of the new
  claims per main area, in plain sentences), **what we now understand differently** (then → now, with the because),
  **where to look next** (offer the areas as follow-ups). No document ids, no operation counts, no "superseded"/
  "revised" jargon in the prose; cite claims with `[[documentId]]` markers only. For "how did X work then vs now",
  call `what_changed` with `query: X` and answer from `thenVsNow` and the scoped shifts.

### A3. REST / plugin
`GET changes` returns `story` too; the markdown rendering leads with the story (growth, then per area: new, changed
then → now, retired) and puts the event detail after it.

### A4. Acceptance additions
6. On the live vault after deploy + backfill, "what changed since 2026-09-01" names the new areas (Workflow Automation,
   Hosts, Runners and Plugins, Document Privacy and Erasure) and at least one then → now shift per changed area, with no
   ids or op counts in the prose.
7. "How did processor delivery work in September and how does it work now?" answers from `thenVsNow`: then
   "exactly once, in order"; now "at-least-once, with a crash gap", citing both notes.
