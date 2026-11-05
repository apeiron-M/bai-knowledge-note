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
- **"Now" is the vault's current state**, also for an explicit past `until`: titles, descriptions, statuses, map
  membership and edges are read as they stand today (the index keeps no snapshot of them at `until`). The events
  and totals respect `until`; the story's *now* side and `notesNow` do not. A question about two past dates is
  answered from the events, not from `now`. (Review A, accepted as documented behaviour.)

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

---

## Addendum B — first recorded vs now, scope and size (approved 2026-11-04, after testing 1.0.54-dev.53 live)

Tested on the live vault after deploy + backfill. Four defects, all from real answers:

**B1. Scoped chat answers stay small.** A `q`/`topic`/`moc` call produced a 155 KB digest; the chat forwarded ~50–60 KB
(30 events with diffs + full `thenVsNow`) and the model stalled. Rule: the chat's `what_changed` returns, for any call,
the chat-budgeted `story` (as for unscoped) plus `thenVsNow` clipped to the same budget (≤ 6 then, ≤ 6 now, ≤ 6
unchanged, gists clipped) — **total ≤ ~14 KB**. Per-document `events` are returned only when the model passes
`detail: true` (or a `cursor`), ≤ 10 per page, two hunks each. Tests pin the bound on a realistic 50-area scoped digest.

**B2. Scope choice.** "What changed in the Powerhouse stack" was sent as `query: "Powerhouse stack"` → 10 hits + neighbours
(162 of 2,600 notes). Rules: (a) the system prompt says to call `what_changed` **unscoped** when the subject is the
vault as a whole or its main subject (the hub's title / the vault's overall theme); (b) a `query` first resolves to a
**MoC** whose title matches it (case-insensitive, word match against hub areas and their descendant maps) and then scopes
by that MoC subtree; (c) only when no MoC matches does it fall back to semantic search, now **25** hits + one-hop
neighbours. The resolved scope (map title or "search: …") is reported in the result so the model can say what it covered.

**B3. Duplicate merges are not changes in understanding.** The steward and extraction agents merged twin notes with
`SUPERSEDES` ("Same claim, written earlier…"). Such a supersession is **not** a Shift when the then/now claims are
near-identical (normalised token Jaccard ≥ 0.6 on title, or the SUPERSEDES reason marks a duplicate — contains
"twin", "duplicate", "same claim", "already makes this claim", "merged"). They are counted in `merged` per area
(uncapped count) and never listed in `changedClaims`.

**B4. First recorded vs now.** "Since June/September" on the Powerhouse vault: the notes were *created* inside the window
(2026-09-02, describing v6.2.2-dev.74) and revised later (2026-11-03, v6.2.3-dev.91). The story treated them as new only
and showed no evolution. Rule: for a note **created inside the window**, its *then* is its **first recorded state** — its
title/description once its creating batch settled: the last value written within **1 hour** of its CREATE_DOCUMENT (an
extraction batch writes all fields within minutes). If its claim (title/description) differs from now, it is a Shift
with `then.at` = that first-recorded time and `why` = the revision lines added later, and it is **also** listed as new
(the area says "new knowledge, and some of it already revised"). Same for `thenVsNow`: a note created in the window
contributes its first-recorded claim to `then`. Sources: each area reports `versions: { first: <git ref of the earliest
ingest of its sources in the window or before>, now: <latest> }` when its sources carry `git:` refs in `method`, so the
story can say "first recorded at v6.2.2-dev.74, now v6.2.3-dev.91+e0f277d". Shift gains optional `thenAt`.

**Acceptance (live, after deploy):**
8. "What changed in the Powerhouse stack since September?" → unscoped story; Reactor and Drives, Authorization,
   Deployment, Connect each show then→now shifts that are real revisions (no "same claim" merges), with
   `versions` v6.2.2-dev.74 → v6.2.3-dev.91+e0f277d; the chat result ≤ ~14 KB; a free model answers without stalling.
9. "How did processor delivery work in September and how does it work now?" → resolves to the Data Processing and
   CQRS map (or its processors notes), then: "exactly once, in order" (first recorded 2026-09-02), now:
   "at-least-once with a crash gap".

### Addendum B — corrections after review (2026-11-04)
- **B3 replaced.** Title Jaccard ≥ 0.6 with an unanchored reason match counted real reversals as merges ("exactly once" →
  "at least once" 0.67; "supported" → "not supported" 0.75; version-only flips 0.63). New rule: a supersession is a
  duplicate merge only when (a) its reason matches an anchored duplicate phrase — `^\s*same (claim|point)\b`,
  `already makes this claim`, `\btwin\b`, `\bduplicate (of|note|claim)\b`, `\bidentical claim\b`, `\bredundant with\b`,
  `merged (into|with) (the )?(newer|older|surviving|twin)` — or (b) the reason is empty AND title Jaccard ≥ **0.8** AND
  the differing tokens contain **no negation** (not/no/never/without/cannot) **and no digit or version token**.
  Merged notes are excluded from `thenVsNow` and from new/changed lists everywhere.
- **B4 extended.** First-recorded then-state also applies when a note created in the window is then superseded in it
  (`thenAt` on the supersession shift; the old note's first-recorded claim on the `then` side).
- **B2 tightened.** A query→map match where the title's words are a subset of the query needs the title to cover ≥ 50%
  of the query's content tokens, or to be the only matching map; otherwise search. A query matching the **hub's** title
  (or the vault's drive name) resolves to the whole vault (`resolved: { kind: "vault" }`), server-side.
- **As built (review B fixes, ledger § Review B fixes).** Query filler ("what changed", "how does … work now") is not
  content; "the only matching map" is read as the only map whose title shares any word with the query; a tie between
  the best two maps searches. `resolved: { kind: "vault", title }` names the hub or drive matched. Explicit
  `documentIds` always narrow what `q` resolves to. A retired note is never also a shift; a note created and archived
  in the window is retired. A created note's bodies are read only when its claim differs from its first record.

---

## Addendum C — subject = matching areas, dates, honesty (approved 2026-11-04, after testing 1.0.54-dev.54 live)

Live answers on dev.54 showed: "since September" read as **2025** (vault "0 → 2,614"); "the Powerhouse stack / repo /
reactor" answered with business areas (lead corpus, Domain Model Catalog, Service Pricing) or with a 25-hit search that
missed most reactor shifts; the model **invented** contents for areas the story only named; merge counts leaked into prose;
most shifts lacked a "first recorded" date; a rewording whose reason says "states the same" counted as a shift.

**C1. A subject means the main areas about it.** Resolving `q` (after the vault-title check of B2): rank the hub's
top-level areas — and their descendant maps — by semantic similarity between the query and each map's own text (title +
orientation, i.e. the MoC node's embedding; keyword overlap on title+orientation as the fallback when no embedding is
available). Select every top-level area whose best score (its own or a descendant's) clears a threshold relative to the
best match (≥ 0.9 × top score, and above an absolute floor tuned on the live vault), at most 12 areas; the scope is the
union of their subtrees, plus their sources. If one descendant map matches far better than its area (a narrow subject
like "attachments"), scope to that map's subtree instead. Only when no area clears the floor does it fall back to the
25-hit search. `scope.resolved` becomes `{ kind: "areas", areas: [{id,title}] }` (or `moc` / `search` / `vault`).
Expected on the live vault: "the Powerhouse stack" / "the powerhouse repo" → the technical areas (Reactor and Drives,
Reactor Sync Infrastructure, Authorization and Identity, Deployment and Operations, Connect Application, Workflow
Automation, Hosts Runners and Plugins, Document Model System, Editors and UX, Data Processing and CQRS, GraphQL and
Schema, Vetra Tooling …) and none of the business areas; "the reactor" → Reactor and Drives (+ its sub-maps) and Reactor
Sync Infrastructure.

**C2. Dates.** The chat system prompt carries today's date; a month or season without a year means its **most recent
past** occurrence ("since September" on 2026-11-04 → 2026-09-01; "since summer" → 2026-06-01). The digest reports the
vault's first recorded activity (`window.vaultStart`); when `since` predates it, growth is counted from `vaultStart`
and the chat says "the vault began on <date>" — never "0 notes then".

**C3. No merge counts reach the model.** `mergedCount` stays in the digest (REST/plugin) but the chat payload omits it.

**C4. First recorded date fallback.** When a note created in the window has no CREATE row in the index (lost before the
id fix), its first-recorded time is its `added_at` (header creation time); `thenAt` is always set for created-in-window
shifts.

**C5. No invented area content.** Areas the chat payload names without claims are marked `nameOnly: true` (or listed
only in `otherAreas`), and the system prompt forbids describing any area beyond the claims it was given: a name-only area
may be named and counted, never characterised.

**C6. Duplicate phrasing.** Add the anchored phrase `\bstates the same\b` (and `\bsame (floor|rule|limit|default)\b`)
to the merge rule.

Acceptance (on a local import of the live vault, then live): "What changed in the Powerhouse stack since September?",
"…in the powerhouse repo since summer?", "…in the powerhouse reactor since summer?" each answer only from technical
areas, with ≥ 10 then→now shifts for the reactor question, dated "first recorded on …", no invented area descriptions,
no merge counts, correct year.

### Addendum C — C1 replaced after measuring on the live vault (2026-11-04)
Measured with the vault's own embeddings: map-orientation similarity is compressed (0.84–0.90) and dominated by the vault's
own subject ("Powerhouse"): "the Powerhouse stack" scored business areas (lead corpus 0.866, Service Pricing 0.858) with
the technical ones, and "powerhouse reactor" ranked Reactor and Drives 8th. Note-hit concentration (top 200 semantic note
hits counted per area subtree) works for specific terms ("reactor" → Reactor and Drives, Workflow Automation,
Deployment, Authorization, Reactor Sync; "service pricing" → Service Pricing 91%) but not for vague subjects in a
single-subject vault ("stack", "repo" still pull Domain Model Catalog and the lead corpus). So C1 becomes three explicit
mechanisms, in this order:
- **C1a — areas chosen by the model.** `what_changed` (and GraphQL/REST) accept `areas: [id or exact title]`; the scope
  is the union of those areas' subtrees + their sources (`resolved: { kind: "areas", areas }`). The unscoped story already
  lists every area by title (cheap). Prompt rule: for a broad subject that is not the whole vault ("the stack", "the
  technical side", "the business side"), first call unscoped, pick the relevant areas **by their titles**, then call again
  with `areas`. Unknown titles are reported back, never guessed.
- **C1b — scope by source.** `source: "<text>"` scopes to notes derived (DERIVED_FROM / extractedClaims) from sources whose
  title, provenance URL or `/sources` folder path contains the text (case-insensitive), plus those sources
  (`resolved: { kind: "source", match, sources: n }`). Prompt rule: "what changed in <a repo / document set / book /
  meeting series>" → `source`. On the live vault, `source: "powerhouse-inc/powerhouse"` is exactly the repo-derived set.
- **C1c — specific terms by note concentration.** `q` (after the vault-title check) ranks areas by how many of the top
  200 semantic note hits fall in each area subtree, selecting areas holding ≥ 10% of the hits (max 8), else the 25-hit
  search. The map-orientation embedding ranking is removed. A narrow sub-map is preferred only when it holds ≥ 60% of the
  selected hits.
Acceptance additions: "powerhouse repo since summer" → `source`; "the Powerhouse stack since September" → unscoped list
→ `areas` with only technical areas; "the reactor since summer" → C1c areas led by Reactor and Drives.

---

## Addendum D — baselines, relevance, polish (approved 2026-11-04, after testing 1.0.54-dev.55 live)

Live answers on dev.55 were substantively right with a strong model; seven defects remained:

**D1. Growth from the vault's first import.** When `since` < `window.vaultStart`, growth (vault-wide and per area) is
measured from the **first-recorded state**: notes that existed at the end of the vault's first import day
(`vaultStart` + 24 h), not 0. `growth.from` keeps `vaultStart`; add `growth.notesAtStart` and per-area `notesAtStart`.
The chat says "first recorded on <date>: N notes → now M", never "0 → M".

**D2. Relevance ranking inside a question's scope.** For `q` / `source` / `areas` scopes, `newClaims`, `changedClaims` and
`thenVsNow` are ordered by relevance to the question (the `q` semantic hit order when a query exists — the top-200 hits
already fetched for C1c — else by incoming edges as today); a scoped answer prefers claims that matched the query.
Within an area, at most half the slots go to claims that did not match the query.

**D3. Follow-up without a date.** `what_changed` called without `since` in a conversation where an earlier call had one
reuses that earlier window (the chat keeps it); with none, it defaults to the vault's start — never an error.

**D4. No narration of tool calls.** The system prompt forbids describing tool calls, retries or errors in the answer
("I called…", "one call returned an error").

**D5. Punctuation-blind comparison.** Claim/gist comparison for shifts normalises case, whitespace and trailing
punctuation; a difference that disappears under normalisation is not a shift.

**D6. Versions only where versioned.** `versions` is reported for an area only when ≥ 50 % of its in-scope sources carry a
`git:` ref; the chat never states a version range for the whole answer unless every reported area has one.

**D7. Description-only shifts.** When the claim (title) is unchanged, the shift carries the gist difference: the
differing span of each gist (word-level diff, ≤ 160 chars each side with context), not two clipped copies; a gist change
whose normalised token Jaccard ≥ 0.9 is a trivial rewording and is not a shift.

Acceptance (live, dev.56): the reactor and service-pricing questions from the dev.55 tests no longer say "0 → N", list
no off-topic revisions (deliverables tables, roadmap ordering under pricing), state no version range for pricing, show no
identical before/after; "the Powerhouse stack since September" answers only from technical areas chosen by title.

## Addendum E — live review of dev.57 (2026-11-05)

Two live answers on dev.57 ("What changed in the Powerhouse stack since September?", then "and in authorisation?" in the
same chat) stayed on topic and kept the period, but checked against the data they showed five defects.

**E1. Tail-only areas are noise.** Semantic similarities run nearly flat (0.858 → 0.812 over 191 note hits for
"authorisation"), so the tail of the top 200 is noise, and a large unrelated area passed C1c's 10 % on the tail alone:
"authorisation" scoped the lead corpus (28 hits, 15 %, the best at rank 28) beside Authorization and Identity. An area
now also needs ≥ 2 of the top 25 note hits. Measured on ten live queries: only tail-only areas leave ("authorisation"
and "workflow engine" lose the lead corpus, "editors" Development Approaches, "drive apps" Reactor and Drives); the
reactor, processors, pricing, sync, attachments and codegen scopes are unchanged and no new sub-map narrowing fires.
Rank-weighted shares (1/r) were rejected: one top hit alone is worth ~17 %, which pulled in Connect Application for
"editors" and Powerhouse Platforms for "workflow engine". With fewer than 25 hits the rule reads "two hits and 10 %",
so a query with a single hit (keyword fallback) falls back to search instead of scoping a whole area.

**E2. `listAreas`.** A broad subject's first call returned the whole vault's growth and totals, and the answer reported
them as the stack's (836 → 2,614, seven new areas including business ones). `what_changed` takes `listAreas: true`:
it asks only `story { areas { id title } }` for the period and returns the titles — nothing that can be mistaken for
the subject — with the next step in `data.next` (the model reads `data`, never the summary). Elsewhere is no area to
name, but when notes on no map changed `data.elsewhere` says so and points to `query`; when only they changed, the
result says that, not "nothing changed". A scope given with `listAreas` (areas, query, source, moc, topic) wins, so a
flag the model copies forward cannot hand it the same list again. Prompt and tool text send a broad subject there first.

**E3. Story claims are citable.** what_changed names claims by text (`claim`, a shift's `then`/`now`), never `title`,
so the chat's resolver did not know them: their citations were dropped (" ." in the prose) and replacements showed as
raw ids. A claim is now known by its text — a replaced note as it read then, its `replacedBy` as it reads now; among
claim texts the last seen wins (a result lists then before now), a real title from any tool or an earlier turn's
citation replaces it, and claim text matches a label only exactly, never by prefix ("[[Attachments]]" is not the claim
that starts with the word). Story claims count as read for the read-before-citing rule (the story handed over their
claims), so a change answer is not sent back to read them. The model also wrapped a then → now pair in one more
bracket, `[[[old]] → [[new]]]`, which corrupted the first id and left "]" after the second: a run of markers (and what
joins them: an arrow, a comma, "and", "to") wrapped in one bracket is unwrapped — never a markdown link's text or a
bracketed phrase — and an unpaired extra `[` is shed from the id, the same way the unread check reads it.

**E4. Growth belongs to the scope.** "Authorization and Identity (260 → 414 notes)" was the two-area scope's growth;
the area's own notes went 18 → 134. The prompt: growth is the whole scope's — give it to the subject or its areas,
never to one area; an area's own count is its notes (growth only: the totals line stays out of the answer). Same rule
in the plugin.

**E5. Story first for a broad subject.** With 25 chosen areas, thenVsNow went first and took 5.3 of the 14 KB, leaving
the story three areas at one new and one changed claim. For `areas` and `source` scopes the story is fitted first and
thenVsNow takes the room left (dropped when not one claim a side fits); `q` and `topic` keep thenVsNow first.
Live: six areas instead of three, thenVsNow 2.5 KB. The 14 KB budget (B1) still limits a 25-area subject to six areas
at one new and one changed claim; raising it is a separate decision.
