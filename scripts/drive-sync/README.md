# drive-sync — upload, download, reindex, repair a Powerhouse knowledge vault

This folder holds the canonical scripts and a committed dataset
(`data/knowledge-vault/`, 543 docs, plus the 2026-09 remote snapshot in `data/powerhouse-knowledge/` — see *Datasets*) so anyone with a fresh clone can
recreate the vault on a clean local reactor in one command.


## Authentication

The Switchboard reads identity from the request's bearer, not from the signed
actions inside the payload. Every script here sends `PH_ACCESS_TOKEN` when it is
set, and omits the header when it is not — a missing header is an anonymous
caller (fine on a host with authorization off), while a malformed one is a hard
401.

```bash
export PH_ACCESS_TOKEN="$(ph access-token | tail -1)"
```

Tokens are Renown delegation credentials and last **7 days**, so this is a
per-session export. `grants.py` requires one unconditionally, because managing
access needs ADMIN.

Manage who can reach a drive — grants go on the drive and inherit to every
document beneath it, so one row per person covers the whole vault:

```bash
python3 scripts/drive-sync/grants.py --drive <id> --list
python3 scripts/drive-sync/grants.py --drive <id> --read 0xabc… --write 0xdef…   # dry run
python3 scripts/drive-sync/grants.py --drive <id> --read 0xabc… --apply
python3 scripts/drive-sync/grants.py --drive <id> --revoke 0xabc… --apply
```

---

## Quick start: upload to a clean local reactor

```bash
# 1. Make sure a local reactor is running (separate terminal):
ph vetra --watch                           # serves http://localhost:4001

# 2. Optional but recommended on dev.253+: avoid disk write amplification
#    (see scripts/drive-sync/data/knowledge-vault for the dataset)
export PH_PGLITE_IN_MEMORY=1               # in-memory PGlite, zero fsync
ph vetra --watch                           # restart with this env if you set it

# 3. Run the upload from the repo root:
python3 scripts/drive-sync/upload.py \
    --data scripts/drive-sync/data/knowledge-vault \
    --drive-name "knowledge vault"
```

A clean run takes **~5–8 min** on local (543 documents + 2,211 cross-refs).
You should see:

```
[upload] created 543/543 documents
→ applied 2211/2211 cross-ref actions (0 failures)
[upload] done — drive: <UUID> (knowledge-vault)
```

Open Connect at `http://localhost:3001/d/knowledge-vault` (vetra studio)
to browse the drive.

---

## Uploading to a remote Switchboard

Every script resolves its target from the `PH_GRAPHQL_ENDPOINT` environment
variable, which defaults to `http://localhost:4001/graphql` (see
`lib/gql.py`). There is no `--endpoint` flag on `upload.py` — set the env var:

```bash
export PH_GRAPHQL_ENDPOINT=https://<your-switchboard-host>/graphql

python3 scripts/drive-sync/upload.py \
    --data scripts/drive-sync/data/knowledge-vault \
    --drive-name "knowledge vault" \
    --throttle-ms 50                      # ease backpressure over the network
```

Then rebuild the graph projection on the remote (the processor indexes live,
but a reindex guarantees a consistent baseline after a bulk import):

```bash
ENDPOINT=https://<your-switchboard-host>/graphql/knowledgeGraph \
  bash scripts/drive-sync/reindex.sh scripts/drive-sync/data/knowledge-vault
```

Three things to check before you start:

- **The remote must already run this Reactor Package**, i.e. have the `bai/*`
  document models deployed. Uploading against a Switchboard that lacks them
  fails per-document at creation.
- **`id-map.json` must not exist** for a clean run — it is the resume marker
  and is keyed to the *previous* target's document ids, so a stale one makes
  the upload skip documents it wrongly believes already exist. It is
  deliberately absent from the committed dataset.
- **Semantic search needs a separate step.** Embeddings are computed
  client-side and pushed, so run `embed-backfill.mjs` against the remote after
  the upload; `reindex` does not create them.

---

## What's in `data/knowledge-vault/`

| File / dir | Purpose |
|---|---|
| `manifest.json` | List of folders + documents (id, name, type, parentFolder) |
| `drive-info.json` | Source drive metadata (id, slug, name) |
| `tree.json` | The drive's full node tree from the original export |
| `states/<doc-id>.json` | Per-document `state.global` — title, content, topics, links, etc. |
| `ops/<doc-id>.json` | Per-document operation history (informational; not replayed) |
| `id-map.json` | Source-ID → new-server-ID mapping the upload writes incrementally — also acts as the **resume marker**: if you re-run upload.py with this file present, already-created docs are skipped. **Delete this file to force a clean re-run.** |
| `upload-summary.json` | Counts and drive id from the last run |

The dataset is **drive-override migrated**: edges live in
`state.links[]` / `state.coreIdeas[]` / `state.childRefs[]` in each
doc's state file, ready to be re-emitted as `ADD_RELATIONSHIP` system
actions by upload.py's phase 4.

---

## Upload phases

`upload.py` runs four sequential phases, each idempotent on
`id-map.json`:

1. **Drive + folders.** Creates a new `powerhouse/document-drive` document
   with the editor pinned to `knowledge-vault`, then creates the 11
   folders inside it (`/knowledge/`, `/sources/`, `/ops/`, etc.). Skip
   this phase with `--existing-drive <id>` if you've already created a
   drive and only want to import documents into it.
2. **Create documents.** For each of the 543 docs in `manifest.json`,
   calls `KnowledgeNote { createDocument }` (or `Moc {...}`,
   `Source {...}`, etc. depending on type), then `DocumentDrive.moveNode`
   to place it inside its target folder. Writes the new server id to
   `id-map.json` as each one lands.
3. **Apply state.** For each created doc, dispatches its `setTitle`,
   `setDescription`, `setContent`, `addTopic`, `setProvenance`, etc.
   actions via `mutateDocument`. Per-type handlers in `handlers/` decide
   which actions to emit.
4. **Cross-references.** Sends each `state.links[]` / `state.coreIdeas[]`
   / `state.childRefs[]` entry as an `addRelationship` GraphQL mutation
   on `/graphql/r`. This populates the reactor's `DocumentRelationship`
   table; the graph-indexer processor mirrors it into `graph_edges`.

---

## After upload: rebuild the knowledge-graph index

The graph-indexer processor builds `graph_nodes` / `graph_edges` from
the operation stream as documents are created. On a fresh upload it
should be up to date automatically, but if you suspect drift you can
force a reindex:

```bash
bash scripts/drive-sync/reindex.sh scripts/drive-sync/data/knowledge-vault
# or:
python3 scripts/drive-sync/reindex.py \
    --endpoint http://localhost:4001/graphql/knowledgeGraph \
    --data scripts/drive-sync/data/knowledge-vault
```

This calls the subgraph's `knowledgeGraphReindex(driveId)` mutation,
which deletes all `graph_edges` rows whose `source_document_id` is in
the drive and re-fans-out per relationship type from
`DocumentRelationship`. Returns `{ indexedNodes, indexedEdges, errors }`.

---

## After upload: backfill embeddings (semantic search)

Reindexing does **not** compute embeddings — vectors are pushed by
clients via `knowledgeGraphUpsertEmbedding`, normally by the Connect
drive-app when someone opens the vault (`use-embedding-backfill.ts`).
After a headless upload, `knowledgeGraphSimilar` and
`knowledgeGraphSearchByEmbedding` return nothing until embeddings
exist. Backfill them without opening Connect:

```bash
bun scripts/drive-sync/embed-backfill.mjs --drive <drive-uuid-or-slug>
# optionally: --endpoint http://localhost:4001/graphql
```

The script queries `knowledgeGraphMissingEmbeddings`, embeds
`title + " " + description` per node with `Supabase/gte-small` (q8 —
the same model/quantization the browser uses, so vectors are
interchangeable), and pushes each via the upsert mutation. The model
(~34 MB) downloads from the Hugging Face hub on first run and is
cached. ~385 docs take about 2 minutes; re-runs are incremental
(only missing embeddings are computed). Verify with:

```bash
switchboard query '{ knowledgeGraphMissingEmbeddings(driveId: "<UUID>") }'
```

---

## Refreshing the dataset from a live reactor

To re-snapshot a vault into `data/knowledge-vault/`:

```bash
python3 scripts/drive-sync/download.py \
    --endpoint http://localhost:4001/graphql/r \
    --drive <drive-id-or-slug> \
    --out scripts/drive-sync/data/knowledge-vault \
    --concurrency 3
```

`download.py` fetches each doc's state plus its outgoing relationships
per type (`RELATES_TO`, `BUILDS_ON`, `CONTRADICTS`, `SUPERSEDES`,
`DERIVED_FROM`, `CORE_IDEA`, `CHILD_MOC`) and reconstructs the
`state.links[]` / `state.coreIdeas[]` / `state.childRefs[]` arrays the
upload handlers consume. Caches per-doc (skips refetch if the state
file already exists) — `rm -rf data/knowledge-vault/states/` to force a
full refresh.

---

## Datasets

| Directory | Source | Snapshot | Contents |
|---|---|---|---|
| `data/knowledge-vault/` | the original local vault | 2026-05 | 543 docs, 2,211 cross-refs — the historical baseline |
| `data/powerhouse-knowledge/` | **the remote vault** `powerhouse-knowledge` (`c5893e1b-854b-49b1-b8aa-6b133ab87969` on `light-colt-c497cfbd-switchboard.vetra.io`) | **2026-09-03**; the scope of work and both demo WBS refreshed 2026-09-08 | 1,467 docs: 982 notes, 403 sources, 58 MoCs, 13 tensions, 3 retired projects, **4 WBS**, **1 scope of work**, 3 singletons; 12 folders; **4,718 edges, 843 with a reason** |

The second snapshot exists so a full copy of the production vault can be
stood up on a local reactor — first use: **testing Switchboard authorization**
(`AUTH_ENABLED`, `DOCUMENT_PERMISSIONS_ENABLED`, `ADMINS`, …) against real
data before touching the remote. Verified against the live drive at download
time with `verify-backup.py` (completeness, per-type edge totals, and a
12-document sample of the relationship table against the graph dump: 0
mismatches).

### Two files the newer snapshot adds

- **`edges.json`** — every knowledge edge in the drive from **one**
  `knowledgeGraphEdges` call, with `reason` and `confidence`. This is now the
  default source for the per-doc `links[]` / `coreIdeas[]` / `childRefs[]`
  arrays (`download.py --relationships graph`): one request instead of seven
  per document, and the only read path that sees edge metadata —
  `documentOutgoingRelationships` returns documents, not edge rows. The old
  per-type fan-out remains as `--relationships table` for a Switchboard
  without the knowledgeGraph subgraph. The dump is a projection, so
  `verify-backup.py` spot-checks it against the table.
- **`auth.json`** — `{docId: state.auth}` for every document: the access
  policy in the document's own auth scope. All 1,465 are uninitialized
  (`version: 0`) today; after an authorization experiment, diffing this file
  shows exactly which documents gained a policy.

### Restoring it locally — what comes back and what does not

`upload.py` restores everything it has a handler for: notes, MoCs, sources
and the three singletons (1,446 docs) with their topics, provenance,
metadata and **articulated edges** — a link carrying `reason`/`confidence`
is dispatched as an `ADD_RELATIONSHIP` action with `metadata`, which is how
`switchboard docs link --reason` writes it; the native `addRelationship`
mutation has no metadata argument and would silently drop all 843 reasons.

A `powerhouse/scopeofwork` restores too, via `handlers/scope_of_work.py`:
the document's own fields, contributors, deliverables (with key results,
progress, budget anchors), project envelopes, roadmaps and milestones, plus
each envelope's `knowledgeRefs` remapped through `id_map` — which is what
gives the restored scope its `CITES` edges into the vault.

Two things inside a scope of work are deliberately **not** written when
their target is unrestorable: an envelope's `wbsRef` (`LINK_PROJECT_WBS`)
and a deliverable's `goalRef` (`LINK_DELIVERABLE_GOAL`). Both point into a
`bai/wbs` document, so until WBS has a handler they would be dangling
references; the handler skips them rather than storing a broken link. The
visible consequence is that the restored scope has no `DELIVERED_BY` edge.

`bai/wbs` restores through `handlers/wbs.py`: the goal tree emitted
parents-first (`CREATE_GOAL` rejects a child whose parent does not exist
yet), then per-goal status, outcomes, assignees, notes and dependencies,
plus `owner`, `references` and the `sowRef`/`sowProjectId` back-pointer.
**Goal ids are intra-document OIDs and are restored verbatim, never through
`id_map`** — that is precisely what makes a scope of work's `goalRef` valid
again, so restore the WBS and the SoW's 19 goal links resolve.

`bai/tension` restores through `handlers/tension.py`: `CREATE_TENSION` plus
the terminal transition, because status is not settable — `RESOLVE_TENSION`
and `DISSOLVE_TENSION` are the only ways out of OPEN. `involvedRefs` are
remapped and are where the graph's `INVOLVES` edges come from.

**Tension duplication.** The graph-indexer opens a tension for every
`CONTRADICTS` pair not already covered by one (any status suppresses a new
one). A clean full run is safe: documents land in Phase 2/3, relationships
in Phase 4, so these tensions exist before the edges that would trigger
auto-creation. Restoring into a drive that **already** holds indexer-created
tensions duplicates the overlapping pairs — match on title and skip, as the
2026-09-08 restore did (7 of 13 skipped, 6 restored).

**Not restored yet:** the 3 retired `bai/project` documents. `upload.py`
skips unknown types rather than failing.

### Verify a snapshot

```bash
python3 scripts/drive-sync/verify-backup.py \
    --data scripts/drive-sync/data/powerhouse-knowledge \
    --endpoint https://<switchboard-host>/graphql/r --sample 12
```

---

## Troubleshooting

**Upload skips Phase 2 (already-uploaded ids found).**
You have a stale `id-map.json` from a previous run pointing at a
different reactor. Delete it: `rm -f data/knowledge-vault/id-map.json`.

**vetra is sluggish or hangs on `createDocument`.**
The `pglite-fs` storage backend in dev.246+ writes a full FS snapshot
on every commit; default `PGLITE_FLUSH_INTERVAL_MS=100` (set by
switchboard) coalesces them, but for the fastest local iteration just
use `PH_PGLITE_IN_MEMORY=1` (no disk writes at all). Restart vetra
after changing this env.

**A restored MoC is missing its `RELATES_TO` edges.**
Fixed 2026-09-08. `handlers/moc.py` looped over `coreIdeas` (`CORE_IDEA`)
and `childRefs` (`CHILD_MOC`) but never over `links[]`, so every
MoC-sourced `RELATES_TO` was dropped while Phase 4 still reported
`0 failures` — 201 edges on the `powerhouse-knowledge` snapshot, across 26
MoCs. If you restored a vault before that date, re-run the link phase or
compare per-type edge totals against `edges.json` before trusting them.

**`ADD_PROJECT_DELIVERABLE` / `ADD_MILESTONE_DELIVERABLE` are not link
operations.** Both *create* a deliverable and reject an id that already
exists (`Deliverable with ID … already exists`). To put an existing
deliverable in a project or milestone set, use `ADD_DELIVERABLE_IN_SET`
with `projectId` or `milestoneId`. Getting this wrong loses every
membership row while the surrounding actions still apply, and the job still
reports success — read `project.scope.deliverables` back to check.

**Connect dead-letters ~1–2 % of docs on the first sync after upload.**
A known upstream sync-envelope race — see
[`docs/bug-reports/reactor-dev244-split-envelope-fix-incomplete.md`](../../docs/bug-reports/reactor-dev244-split-envelope-fix-incomplete.md).
Server-side the docs are fine. Recovery is currently manual: copy the
dead-lettered doc IDs from Connect's DB inspector and delete + re-create
those docs (a `--repair-file` mode for upload.py is in design).

**`Unknown argument "meta" on field "DocumentDrive.createDocument"`.**
You're on a vetra older than dev.246 with the new `gql.py` that uses
`preferredEditor`, or vice-versa. The current `gql.py` is correct for
dev.246+ — match your vetra version.

---

## Other scripts in this folder

| Script | When you'd use it |
|---|---|
| `upload.sh` | Bash wrapper that enforces `switchboard config` profile is `local` before delegating to `upload.py`. Use it in CI/automation to prevent accidental remote uploads. |
| `download.py` | Snapshot a vault from any reactor (works against `/graphql/r` on local or remote). |
| `reindex.py` / `reindex.sh` | Force the `knowledgeGraph` subgraph to rebuild from `DocumentRelationship`. |
| `embed-backfill.mjs` | Compute + push embeddings for nodes missing them (headless counterpart of the Connect drive-app backfill). Required for semantic search after a headless upload. |
| `compare.py` | Diff two `data/` dumps to detect drift between snapshots. |
| `cleanup-duplicates.py` | Operator tool to dedupe drive-level node entries (rare). |
| `lib/gql.py` | Direct GraphQL helpers used by `upload.py` (no subprocess overhead). |
| `lib/sb.py` | `switchboard` CLI subprocess wrappers — used only by tests and a couple of legacy paths. |
| `handlers/*.py` | One per document type — translates a doc's `state.global` into the action list `mutateDocument` and `addRelationship` need. |

---

## When in doubt

The "Quick start" three-line recipe at the top is the canonical path.
Everything else here is for when something deviates from that.
