# drive-sync — upload, download, reindex, repair a Powerhouse knowledge vault

This folder holds the canonical scripts and a committed dataset
(`data/knowledge-vault/`, 543 docs) so anyone with a fresh clone can
recreate the vault on a clean local reactor in one command.

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
