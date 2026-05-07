# Drive Sync Pipeline — Design

**Date:** 2026-05-07
**Author:** liberuum + Claude
**Status:** Approved for implementation planning

## Problem

The deployed Knowledge Vault Connect app renders documents incorrectly: notes appear without titles, descriptions, or tags; many show "document not found" errors. Earlier migration attempts (`scripts/vault-import.mjs`, `vault-fix-scripts/upload.ts`) replayed `.phd` operation archives against the destination switchboard. This produced operation histories that don't reduce cleanly under the current document-model schema, leaving documents with malformed state.

The root cause is **operation replay across schema versions**. Operations authored against older versions of `bai/knowledge-note` and `bai/moc` no longer reduce into a valid current state. Connect renders from current state, so the symptoms manifest as missing fields.

## Goal

Build a clean migration pipeline that:

1. Pulls source data from the canonical `powerhouse-vault` drive on `switchboard-dev.powerhouse.xyz` via GraphQL.
2. Reconstructs each document's current state on a target switchboard by issuing **mutations under the current schema** — not by replaying historical operations.
3. Verifies that local Connect can render every document correctly and that semantic search returns results.

The reference architecture is `/home/p/Powerhouse/demos/contributor-billing/scripts/drive-sync/`, which has been used successfully for the contributor-billing migrations. We adapt that pattern to the Knowledge Vault's document types.

## Non-Goals

- Migrating to remote vetra (`eager-hen-55.vetra.io`) — deferred until local pipeline is proven.
- Preserving operation history — this is exactly what we're discarding to fix the rendering bug.
- Preserving source document IDs — `switchboard docs create` generates IDs server-side; cross-references are remapped via an id-map.

## Scope

| Source drive | `powerhouse-vault` on `https://switchboard-dev.powerhouse.xyz/graphql` (UUID `9658f99a-3731-4487-91d4-0c5ee8ff4a6c`) |
|---|---|
| Target switchboard | Local: `http://localhost:4001/graphql` (profile `local`) |
| Document count | 398 docs across 7 types, 11 folders |

### Document types

| Type | Count | Notes |
|------|-------|-------|
| `bai/knowledge-note` | 348 | Bulk content. Has cross-doc `links` array. |
| `bai/moc` | 27 | Map-of-Content. Has `coreIdeas`, `childMocs` cross-refs. |
| `bai/source` | 19 | Citation/reference docs. |
| `bai/knowledge-graph` | 1 | Singleton. References many docs. |
| `bai/pipeline-queue` | 1 | Singleton. Operational queue state. |
| `bai/health-report` | 1 | Singleton. Health-check report state. |
| `bai/vault-config` | 1 | Singleton. Config/preferences. |

## Architecture

```
scripts/drive-sync/
├── lib/
│   └── common.sh           # Logging, sb_run helpers, preflight, profile guards
├── download.py             # Phase 0: GraphQL fetch from source switchboard
├── compare.py              # Phase 0.5: Diff fresh dump vs scripts/vault-dump-canonical
├── upload.sh               # Phases 1–4: Create drive, folders, docs, apply state
├── reindex.sh              # Phase 5: Trigger reindex mutation on local subgraph
└── data/                   # Output dir (git-ignored)
    └── powerhouse-vault/
        ├── manifest.json
        ├── tree.json
        ├── drive-info.json
        ├── states/{doc-id}.json
        ├── ops/{doc-id}.json    # informational only, not replayed
        └── id-map.json          # written during upload
```

### Pipeline phases

#### Phase 0 — Download (download.py)

Pure GraphQL against the source switchboard. **No switchboard CLI involvement on the source side** — the user explicitly wants the download decoupled from CLI quirks.

Endpoints used (single switchboard root):
- `query { document(identifier: "powerhouse-vault") { state { global { nodes { id, name, kind, documentType, parentFolder } } } } }` — drive tree.
- `query { document(identifier: "<doc-id>") { state { global } } }` — per-doc state. Iterated for all file nodes.

Output:
- `manifest.json` — same shape as drive-sync's: `{ source, folders[], documents[] }`. Folders extracted from `kind=folder` nodes; documents from `kind=file`.
- `states/<doc-id>.json` — the `state.global` blob for each doc.
- `ops/<doc-id>.json` — fetched but **not replayed**. Kept for forensic inspection only.

Concurrency: simple bounded pool (e.g., 5 concurrent requests) to avoid hammering switchboard-dev. Per-doc progress logging (`[i/N] <name> ...`) since this takes a few minutes.

#### Phase 0.5 — Compare (compare.py)

Diffs the freshly-downloaded dump against the existing `scripts/vault-dump-canonical/` to detect drift or loss between the two snapshots. Reports:
- Documents present in canonical but missing from fresh (and vice versa).
- Field-level differences for shared docs: `title`, `content`, `links` count, `topics` count, `status`.

This is a **sanity gate**, not a hard failure — divergence is expected if the source drive evolved between 2026-05-06 and now. The user reviews the diff and decides whether to proceed.

#### Phase 1 — Drive + folders (upload.sh)

Creates a fresh local drive via `switchboard drives create --name "knowledge vault"`. Topologically sorts folders (parents before children), generates new UUIDs for each, and dispatches all `ADD_FOLDER` actions in one batch via `switchboard docs apply --wait`.

Records old-folder-id → new-folder-id in `id-map.json`.

#### Phase 2 — Document creation (upload.sh)

Iterates the manifest in a deterministic type order (sources first, then notes, then mocs, then singletons). For each doc:

```bash
switchboard docs create --type <doc-type> --name <name> --drive <drive-id> --format json
```

Records old-doc-id → new-doc-id in `id-map.json` after every create (so the file always reflects committed work). Uses `wait_for_doc()` poll loop after each create to guarantee the doc is queryable before the next operation.

After all creates, a single batched `MOVE_NODE` apply call places each doc into its remapped parent folder.

#### Phase 3 — Per-type state application (upload.sh)

For each doc, the appropriate handler reads `states/<old-id>.json` and translates `state.global` into mutation calls.

**Knowledge-note handler (`apply_knowledge_note`):**
- `setNoteInfo` — title, description, noteType, status (single mutation)
- `setNoteContent` — content body
- `addTopic` — one call per topic (each carries its own OID)
- `setProvenance` — author, sourceOrigin, createdAt
- **Defers `addLink` calls to Phase 4** (cross-doc references)

**MoC handler (`apply_moc`):**
- `setMocInfo` — title, description
- **Defers `addCoreIdea`, `addChildMoc` to Phase 4**

**Source handler (`apply_source`):**
- `setSourceInfo` — title, url, citation fields
- No deferred cross-refs.

**Singleton handlers:**
- `apply_knowledge_graph` — sets graph metadata; node/edge population deferred to Phase 4 since it references other docs.
- `apply_pipeline_queue` — adds queue items (may reference docs → some calls deferred).
- `apply_health_report` — sets summary, adds check entries (no cross-refs).
- `apply_vault_config` — sets config keys (no cross-refs).

The exact mutation names per handler are TBD pending document-model introspection during implementation. The handler-stub structure follows drive-sync's `apply_builder_profile` pattern: scalar fields → single `set/update` mutation; arrays → loop of `add` mutations; nested objects → dedicated mutations.

Mutations are batched per-document via the `begin_batch(doc_id) / mutate(...) / flush_batch()` pattern from drive-sync, sending one `docs apply --wait` per doc.

#### Phase 4 — Cross-reference pass (upload.sh)

After all docs exist, walks the manifest a second time:

- For each `bai/knowledge-note`: dispatches `addLink` mutations with `targetDocumentId` remapped via id-map.
- For each `bai/moc`: dispatches `addCoreIdea` and `addChildMoc` with remapped IDs.
- For `bai/knowledge-graph` singleton: adds nodes/edges with remapped doc references.
- For `bai/pipeline-queue` singleton: adds queue items referencing remapped docs.

If a referenced doc isn't in the id-map (e.g., it failed to create in Phase 2), the link is **dropped with a warning** rather than silently kept as a dangling reference.

#### Phase 5 — Reindex (reindex.sh)

Note on naming: the project has both a `bai/knowledge-graph` singleton **document** (a per-drive doc that stores graph metadata) and a `subgraphs/knowledge-graph/` **GraphQL subgraph** (server-side endpoint exposing graph queries and the reindex mutation). They're distinct. Phase 5 calls the **subgraph** mutation, which separately rebuilds a per-drive PGlite index — it does not touch the singleton document.

POSTs to the local switchboard's knowledge-graph subgraph mutation:

```graphql
mutation {
  reindexDrive(driveId: "<new-drive-id>") {
    indexedNodes
    indexedEdges
    errors
  }
}
```

This populates the per-drive PGlite-backed embedding store and graph index, enabling semantic search in Connect. Reuses the existing reindex mutation at `subgraphs/knowledge-graph/helpers/reindex.ts`.

### Verification

The pipeline is "done" when:

1. `manifest.json` shows 398 documents and Phase 2 reports 398 successful creates.
2. Phase 4 reports zero dropped links (or only links to expected-skipped docs).
3. `reindexDrive` returns ≥348 indexed nodes (one per knowledge-note).
4. Manual Connect verification: open a few notes — title, description, topics all visible; clicking a `BUILDS_ON` link navigates to the linked note; search by phrase returns relevant notes.

A formal automated post-upload verification script is out of scope for v1; manual Connect-side sign-off is sufficient.

## Failure Modes & Recovery

| Failure | Recovery |
|---------|----------|
| Phase 0 partial download | `download.py` is idempotent — re-runs skip docs whose state file already exists. |
| Phase 2 doc create fails | id-map.json persisted incrementally → re-run upload skips already-mapped docs. |
| Phase 3 mutation fails for a doc | Logged with doc id; skipped, doesn't abort the run. To retry: re-run upload with the doc's old id removed from `id-map.json` so it gets recreated. |
| Phase 4 cross-ref to missing doc | Dropped with warning, not retried. |
| Phase 5 reindex error | Standalone script — re-run after fixing without re-uploading. |
| CLI quoting issues with names containing commas/quotes | At `docs create` time the name is replaced with a CLI-safe placeholder (e.g., the doc's old id slugged) — and Phase 3's `setNoteInfo` / `setMocInfo` / etc. carries the original `title` field. Title is what Connect renders; the drive-tree `name` is rebuilt from title via a final `UPDATE_NODE` pass per doc. |

## Out of Scope (v1)

- Remote-target upload (we'll re-run against eager-hen-55 once local is green).
- Per-field state diff verification post-upload (manual Connect check is the gate).
- Resumable cross-ref pass (Phase 4 is fast enough to re-run from scratch).
- A `--dry-run` mode (could be added later).

## Open Questions

- **Singleton mutation names**: the exact mutation names for `bai/knowledge-graph`, `bai/pipeline-queue`, `bai/health-report`, `bai/vault-config` need to be confirmed against the document-models during implementation. Spec assumes the standard `set<Module><Field>` / `add<Module><Item>` patterns hold.
- **Existing `vault-fix-scripts/` and `scripts/vault-import.mjs`**: kept as-is for now (forensic value). Not deleted as part of this work.
