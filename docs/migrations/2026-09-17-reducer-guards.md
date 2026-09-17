# Hardening: enums and reducer guards across the vault models

Companion to [`2026-09-17-note-type-enum.md`](./2026-09-17-note-type-enum.md). Every change below
was dispatched to the document-model documents in the vetra drive (MCP `addActions`), regenerated
by codegen, mirrored in `src/` reducers, and covered by tests. Where a change affects stored data
or a write path, the section says so.

## Why

The vault's own MoC on its model recorded the gap: *"noteType and relationship type are free
strings the reducers never validate, provenance written last discards timestamps,
RECORD_EXTRACTION_STATS validates nothing."* An audit of all twelve models found the same pattern
in more places, and the live drives confirmed each one: four spellings of one `noteType`, a queue
with `completedCount 139` for 81 tasks, 50 sources whose `claimCount` disagreed with their claim
list, config updates whose unknown key was ignored while `updatedAt` was still bumped.

## `bai/knowledge-note`

| Change | Effect on writes | Stored data |
|---|---|---|
| `noteType` → `enum NoteType` | creator, reducer and REST lint reject anything else | migrated on both local drives (see companion runbook) |
| top-level `updatedAt: DateTime`, stamped by every content and lifecycle op | none | new field, `null` on old notes until touched |
| `SET_PROVENANCE`: `createdAt` immutable once set → `ProvenanceCreatedAtImmutableError` | callers correcting author/origin must pass the existing `createdAt` back (the editor does) | none |
| `SET_METADATA_FIELD` value check for `confidence` (`grounded\|established\|speculative`), `severity` (`critical\|warning\|info`), `decisionStatus` (`proposed\|accepted\|rejected\|superseded`) → `InvalidMetadataValueError` | editor offers selects | live values were already inside the sets |

The old "provenance-first" batch ordering is no longer required: edits before `SET_PROVENANCE`
now keep their timestamp in `state.updatedAt`.

## `bai/source`

| Change | Effect |
|---|---|
| `SET_SOURCE_STATUS` transition table → `InvalidSourceStatusTransitionError` | `INBOX→EXTRACTING\|ARCHIVED`, `EXTRACTING→EXTRACTED\|INBOX\|ARCHIVED`, `EXTRACTED→ARCHIVED\|EXTRACTING`, `ARCHIVED→INBOX`; same status = no-op |
| `RECORD_EXTRACTION_STATS`: counts ≥ 0, `0 ≤ skipRate ≤ 1` → `InvalidExtractionStatsError`; `claimCount == extractedClaims.length` → `ExtractionStatsMismatchError` | add the claims **before** recording stats |
| `INGEST_SOURCE` builds provenance when any of `url/author/publishedAt/method/tool` is present | `method`/`tool` alone are no longer discarded |

Not enforced (deliberately): `→ EXTRACTED` does not require stats, because the source editor's
status dropdown is a legitimate manual path. "EXTRACTED without stats" stays a health finding.

## `bai/pipeline-queue`

| Change | Effect |
|---|---|
| `ADD_TASK`: `taskType` must have a `phaseOrder` entry → `UnknownTaskTypeError`; `currentPhase` must be one of its phases → `InvalidPhaseError` | no more tasks that can never advance |
| `ADVANCE_PHASE`: only `PENDING\|IN_PROGRESS` → `InvalidTaskStatusError`; `handoff.phase == currentPhase` → `PhaseMismatchError` | a DONE task is no longer resurrected at the first phase |
| `COMPLETE_TASK`, `FAIL_TASK`: not from `DONE\|FAILED`; `BLOCK_TASK`: only from `PENDING\|IN_PROGRESS` | counters cannot be double-counted; a FAILED task is retried by adding a new task |

## `bai/observation`

`PROMOTE` only from `PENDING`, `IMPLEMENT` only from `PROMOTED`, `ARCHIVE` never twice →
`InvalidObservationTransitionError` (mirrors the tension reducer).

## `bai/vault-config`

| Change | Effect |
|---|---|
| `UPDATE_DIMENSION.dimension` → `enum Dimension`, `UPDATE_VOCABULARY.key` → `enum VocabularyKey`, `UPDATE_MAINTENANCE_THRESHOLD.condition` → `enum MaintenanceCondition` (UPPER_SNAKE; reducers map to state keys) | an unknown key is rejected at input validation instead of ignored |
| position `1..5`, confidence `0..1` → `InvalidDimensionValueError`; threshold ≥ 0 → `InvalidThresholdError`; `extractionSelectivity` `0..1` → `InvalidPipelineConfigError` | |

`feature` stays a free string: the UI lets users type features.

## REST (`subgraphs/http`)

- `POST/PATCH/DELETE relationships`: `type` must be one of the seven knowledge link types →
  `400 BAD_REQUEST`, rule `UNKNOWN_LINK_TYPE`. `ADD_RELATIONSHIP` is a reactor action with a
  free-string type; an unknown one used to be stored and then ignored by the indexer.
- The model-specific `noteType` lint rule was removed: the generic `INVALID_INPUT` check (generated
  zod schema) now rejects it first, as `LINT_REACTOR`.

## Repairs for live data the guards do not rewrite

Guards constrain future writes; they do not rewrite history. Each drift found on the local
drives has an auditable repair:

| Drift | Repair | Record |
|---|---|---|
| `extractionStats.claimCount ≠ len(extractedClaims)` | [`scripts/repair-source-stats.mjs`](../../scripts/repair-source-stats.mjs) — dry run, then `--apply`; keeps `skippedCount`, recomputes `skipRate`, re-records through `RECORD_EXTRACTION_STATS` | `cf9b51d2…`: 50/50 repaired 2026-09-17; both drives read 0 mismatches |
| queue `completedCount` / `activeCount` drift | `RECONCILE_COUNTERS { updatedAt }` — new queue operation, recomputes both from the tasks | `c60679ae…` queue was 139 for 81 tasks — dispatch after deploying this package |
| `EXTRACTED` sources with no stats (86 on `cf9b51d2…`) | **none** — inventing a `skippedCount` would be a lie; stays a health finding | — |
| duplicate singletons on `cf9b51d2…` | vault-config: `/self/VaultConfig` (`d8caf037…`) is empty, `(copy) 1` (`1eb4724a…`) holds the config → delete the empty one, rename the copy. Health-report `(copy) 1` (`2f3420ec…`, 2026-09-03) is a superseded snapshot → delete. Queue `(copy) 1` (`accde087…`) holds 25 DONE tasks with handoffs → **keep**; the active queue is `4666b59e…` | pending a human: `switchboard docs delete` is irreversible |

## Deploy order

1. Deploy the package; restart the Switchboard (reducers and the REST lint live in `dist/`).
2. Run the `noteType` migration on every drive (companion runbook).
3. Dry-run, then apply, `repair-source-stats.mjs` on every drive.
4. Dispatch `RECONCILE_COUNTERS` on every pipeline queue (idempotent).
5. Decide the duplicate singletons by hand.
