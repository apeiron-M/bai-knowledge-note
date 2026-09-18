# Document-model versioning: upgrading documents across a breaking model change

**Status:** approved, implementing `bai/source` first
**Problem reported:** the source editor throws `ZodError: state.global.attachments — expected array, received undefined` on every source created before the attachments feature.

## 1. What broke, and why it cannot heal itself

Between the published `1.0.54-dev.12` (registry.dev.vetra.io, 2026-09-15T19:59Z, commit `2eb1f2fc`)
and HEAD, three commits touched `document-models/`: `7935ee2a` (source attachments),
`88ede6fb` (source originals), `c45fa8e8` (NoteType enum + reducer guards).

Exactly one change breaks the *shape* of stored state:

| Model | Change | Breaking |
|---|---|---|
| `source` | `attachments: [SourceAttachment!]!` | **yes** — zod `z.array(...)`, no `.nullish()` |
| `source` | `originalFile`, `originalFileName`, `originalMimeType`, `originalSizeBytes`, `originalAttachedAt`, `convertedBy` | no — all `.nullish()` |
| `knowledge-note` | `noteType: String` → uppercase `NoteType` enum | **yes, by value** — `"concept"` fails `z.enum` |
| `knowledge-note` | `updatedAt` | no — `.nullish()` |
| `vault-config` | `dimension`/`key`/`condition` → enums | input types only; replay hazard only |
| `pipeline-queue` | `RECONCILE_COUNTERS` | no — additive |

Three facts from the reactor make this unfixable by editing or by replay:

1. **Reads never replay.** `getDocument` is a raw `jsonb` read of
   `reactor."DocumentSnapshot".content`; the reducer does not run at read time.
2. **`initialState` *is* `state`.** `KyselyDocumentView.get` assigns
   `initialState: state` — the same object. The two zod errors are one fact reported twice.
3. **The creation seed is frozen.** At creation the reactor records
   `UPGRADE_DOCUMENT(fromVersion: 0)` carrying that day's `utils.createDocument()` output.
   It is never refreshed, so a cold rebuild reproduces the *old* shape.

Consequences: touching a document does not add the field; patching
`DocumentSnapshot.content` directly is reverted the next time the `document-view`
cursor rewinds and rebuilds. `ADD_ATTACHMENT` also `TypeError`s on an
un-migrated source (`state.attachments.some(...)`).

The root cause in one line: **the schema changed in place under specification
version 1, so the reactor sees one version number for two different shapes.**

## 2. Mechanism chosen

The stack has first-class document-model versioning, and this package is already
scaffolded for it (`document-models/*/upgrades/`, `document-models/upgrade-manifests.ts`)
but has never used it — every model sits at `supportedVersions = [1]`, `upgrades: {}`.

- `RELEASE_NEW_VERSION` (meta-model module `versioning`, empty input) appends a
  specification that is a deep copy of the latest one. It is exposed through
  reactor-mcp, so the whole change is dispatchable via `addActions`.
  *(Note: `CLAUDE.md` still says versioning is "not implemented" — that is stale
  as of 6.2.3-dev.11 and should be corrected.)*
- Codegen derives `supportedVersions` / `latestVersion` **only** from
  `specifications[].version`, emits one `v<N>/` module directory per
  specification, and writes `upgrades/v<N>.ts` **once, never overwriting it**.
- `buildMigrationPlan` GraphQL-diffs consecutive specs. An added field becomes a
  `fill` using the new spec's `initialValue`, falling back to the schema zero
  value (`[T!]!` → `[]`). A *changed* field type becomes `manual` — the emitted
  reducer throws until hand-written.
- The emitted reducer migrates **both `state` and `initialState`**, "so a rebuild
  from the operation log converges with the stored state".
- `IReactorClient.upgradeDocument` dispatches `UPGRADE_DOCUMENT`; the executor
  validates `fromVersion` against the document's stamp and a per-scope revision
  snapshot, runs the upgrade path, and marks `__migrated` so every scope is
  reindexed. Already at the target version → success, unchanged (idempotent).

## 3. Order of operations (per model)

`RELEASE_NEW_VERSION` copies the **latest** spec, and every other meta-model
reducer edits the **latest** spec. So the sequence is forced:

1. **Revert the spec to its dev.12 shape** — v1 must honestly describe what
   existing documents were created under. For `source`:
   `SET_STATE_SCHEMA`, `SET_INITIAL_STATE`, `DELETE_OPERATION` ×3
   (`ATTACH_ORIGINAL_FILE`, `ADD_ATTACHMENT`, `REMOVE_ATTACHMENT`),
   `SET_OPERATION_REDUCER` ×3 (`INGEST_SOURCE`, `SET_SOURCE_STATUS`,
   `RECORD_EXTRACTION_STATS`), `DELETE_OPERATION_ERROR` ×3
   (`InvalidSourceStatusTransitionError`, `InvalidExtractionStatsError`,
   `ExtractionStatsMismatchError`).
2. **`RELEASE_NEW_VERSION`** → v2 is a frozen copy of the real v1.
3. **Re-apply the post-dev.12 changes onto v2** (now the latest spec).
4. **Regenerate** — `ph generate document-model --dir document-models/source`
   (or let Vetra's watcher fire on the document change). Produces `v1/` (old),
   `v2/` (new), `upgrades/v2.ts`, `versions.ts = [1, 2]`, manifest `upgrades: { v2 }`.
5. **Two manual fixups.** Restore `v1/src/reducers/*.ts` from `git@2eb1f2fc` so v1
   compiles against v1 types; copy `v1/tests` → `v2/tests` by hand — codegen's
   carry-forward pass has an off-by-one (`if (previousVersion <= 1) return`) that
   skips v1→v2 for everything except reducers.
6. `git diff document-models/` and confirm only intended lines changed, then
   `bun run tsc`, `bun run test`, `bun run build`.

## 4. The sweep

`execute(documentIdentifier, actions, branch)` accepts arbitrary actions, so
`UPGRADE_DOCUMENT` can be dispatched over plain GraphQL — the sweep runs against
any Switchboard, local or remote, with no in-process reactor.

`scripts/upgrade-documents.mjs`, following the conventions of
`scripts/migrate-note-type.mjs`:

- dry run by default, writes only with `--apply`
- `--drive <id>`, `--type <documentType>`, bounded concurrency
- skips documents already at the target version (the executor no-ops anyway)
- reads each document back and confirms `state.document.version` advanced **and**
  the expected field is present; counts a document migrated only then
- exit `0` clean, `1` failures, `2` needs a human decision
- companion runbook at `docs/migrations/2026-09-18-model-v2-upgrade.md`
  with a `| Date | Drive | Result |` record table

Blast radius at time of writing: 471 `bai/source` and 1223 `bai/knowledge-note`
across the two local vaults.

## 5. Scope and sequencing

`source` is implemented and proven end-to-end first — codegen, tsc, tests, and a
real `UPGRADE_DOCUMENT` on one document read back to confirm `attachments` lands —
before committing to the rest.

| Model | Rationale | Cost |
|---|---|---|
| `source` | fixes the reported crash; fill derived automatically | 30 files, ~2.6k LOC |
| `knowledge-note` | noteType for vaults still on dev.12; **manual** upgrade reducer | 54 files, ~4.2k LOC |
| `vault-config` | state unchanged, but old lowercase `UPDATE_DIMENSION` ops replay through v1 reducers instead of being dropped | 28 files, ~2.4k LOC |
| `pipeline-queue` | same protection for old task operations | 31 files, ~2.6k LOC |

## 6. Risks

- **The revert step is destructive to the model document.** The document state is
  backed up before the first write and the backup path is recorded in the runbook.
- **Regeneration can pull in unrelated stack drift.** Mandatory `git diff
  document-models/` after every regeneration (CLAUDE.md).
- **Duplicated model directories double the reducer surface**; v1 reducers are
  frozen history and must not be "improved".
- **Coverage.** CLAUDE.md requires ≥95% reducer coverage; `v2/tests` must be
  carried over by hand or coverage drops.
