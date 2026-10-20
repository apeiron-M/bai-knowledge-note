# Migration: four models go to specification v2

**Models:** `bai/source`, `bai/knowledge-note`, `bai/vault-config`, `bai/pipeline-queue` · **Script:** [`scripts/upgrade-documents.mjs`](../../scripts/upgrade-documents.mjs)
· **Design:** [`docs/superpowers/specs/2026-09-18-document-model-versioning-design.md`](../superpowers/specs/2026-09-18-document-model-versioning-design.md)

## What changed

Commit `7935ee2a` added `attachments: [SourceAttachment!]!` to `SourceState`, and `88ede6fb`
added the nullable `originalFile` / `originalFileName` / `originalMimeType` /
`originalSizeBytes` / `originalAttachedAt` / `convertedBy`. Both landed **in place under
specification version 1** — the schema changed without a version bump, so the reactor sees one
version number describing two different shapes.

`attachments` is the only breaking one: codegen emits `z.array(...)` with no `.nullish()`, so a
document without the key fails `SourceDocumentSchema`. The editor's
`useSelectedSourceDocument()` asserts and throws:

```
ZodError: state.global.attachments — expected array, received undefined
           initialState.global.attachments — expected array, received undefined
```

Those two lines are **one fact reported twice**: `KyselyDocumentView.get` assigns
`initialState: state`, the same object. The nullable fields above are fine — `undefined` passes
`.nullish()`.

This cannot heal itself. Reads are a raw `jsonb` snapshot read (the reducer never runs at read
time), and a document's initial values are frozen at creation into its
`UPGRADE_DOCUMENT(fromVersion: 0)` operation, so a cold rebuild reproduces the old shape too.
`ADD_ATTACHMENT` additionally `TypeError`s on an un-migrated source (`state.attachments.some(...)`).

The fix is a real version bump: spec v1 is restored to its `1.0.54-dev.12` shape, `RELEASE_NEW_VERSION`
freezes it, the post-dev.12 changes are re-applied to v2, and codegen emits `upgrades/v2.ts`
filling `attachments: []` into **both** `state` and `initialState`.

## Order of operations on a deployment

1. **Deploy the package** with spec v2 and restart the Switchboard. Reducers and the upgrade
   manifest live in `dist/`; running the sweep against a Switchboard serving the old bundle
   cannot resolve the v2 upgrade path and every document fails with `ManifestNotFoundError`.
2. **Dry-run each drive** (default mode — reads only):
   ```bash
   export SWITCHBOARD_ORIGIN=https://<host>-switchboard.vetra.io   # omit for localhost:4001
   export SWITCHBOARD_TOKEN="$(switchboard auth token)"            # any bearer with WRITE on the drive
   node scripts/upgrade-documents.mjs --drive <drive-id-or-slug> --to 2
   ```
   With no `--type` it sweeps exactly the four models that have a v2. **Do not pass
   `--all-types`** unless you know every matched type has an upgrade path — a type without
   one fails with `ManifestNotFoundError` on every document.
3. **Apply**:
   ```bash
   node scripts/upgrade-documents.mjs --drive <drive-id-or-slug> --to 2 --apply
   ```
   Each document is read back; it counts as migrated only when its stamped version advanced
   (and, with `--expect <field>`, when that field is present). Exit `1` if any failed.
4. **Re-run the dry run** until it reports `to upgrade: 0`.
5. Repeat per drive.

The script talks only HTTP — it enumerates the drive over GraphQL rather than shelling out to
`switchboard docs list`, which would resolve the drive through the CLI's *active profile* and
happily list a local drive while dispatching upgrades to the remote.

Re-running is safe: the executor returns success unchanged when a document is already at the
target version.

## Side effects

- `UPGRADE_DOCUMENT` marks the result `__migrated`, so **every scope is reindexed**, not just
  the ones the upgrade touched. Expect the drive's read models to churn.
- The upgrade is recorded as an operation, so migrated sources move in Activity and in
  `knowledgeGraphRecent`.
- The upgrade reducer spreads `document.state.global` **last**, so existing data always wins;
  a source that somehow already has `attachments` keeps it.
- Documents created after the feature landed already carry the field and are skipped.

## The other three models

Same sequence, same script. What differs is the upgrade reducer codegen derived:

| Model | v1 → v2 diff | Upgrade reducer |
| ----- | ------------ | --------------- |
| `bai/source` | `attachments` + 6 nullable `original*` fields | auto **fill**: `attachments: []`, rest `null` |
| `bai/knowledge-note` | `noteType` `String` → `NoteType` enum; `updatedAt` added | **manual** — codegen emits a `throw` for a changed field type. Hand-written in [`upgrades/v2.ts`](../../document-models/knowledge-note/upgrades/v2.ts): normalize the value the way `migrate-note-type.mjs` does (trim, upper-case, `-`/space → `_`), unmappable → `null`; seed `updatedAt: null` |
| `bai/vault-config` | state unchanged; `dimension`/`key`/`condition` inputs became enums | auto **no-op** (`return { ...document }`) |
| `bai/pipeline-queue` | state unchanged; `RECONCILE_COUNTERS` added, 5 reducers guarded | auto **no-op** |

The two no-op migrations are still worth doing: the value is the **version
boundary**, not a state fill. Operations recorded before it replay through the v1
reducers, so the new guards cannot retroactively reject an old
`UPDATE_DIMENSION` with a lowercase key, or an old task operation, and silently
drop it from state on the document's next write.

### noteType was not damaged

The distribution across the 982 notes on `cf9b51d2…` is **identical** before and
after — `OBSERVATION` 240, `REFERENCE` 175, `ARCHITECTURE` 162, `PATTERN` 137,
`CONCEPT` 110, `DECISION` 54, `PROCEDURE` 45, `INTEGRATION` 36, `WORKFLOW` 17,
`BUG_PATTERN` 6. Zero nulls, so nothing was unmappable on these drives. A drive
that still holds lowercase or unmappable spellings should run
`scripts/migrate-note-type.mjs` **first** if it wants to decide those cases
explicitly rather than let them become `null`.

## Consequence for callers: deep `/v1` imports are now pinned to the old model

Freezing v1 turned every deep `document-models/<name>/v1/...` import into a
reference to the *pre-change* model. Fixed in this change:

- `subgraphs/http/lib/lint/model-registry.ts` → `/v2/gen/schema/zod.js` for the
  four bumped models. It deliberately keeps the narrow zod-only import rather
  than the barrel, because the barrel re-exports `hooks.js` and would drag
  `@powerhousedao/reactor-browser` into the node bundle.
- Editors and `tests/unit/*` → the top-level barrel `document-models/<name>`,
  which always points at the latest version (CLAUDE.md).

## How old is too old?

The frozen v1 is the `1.0.54-dev.12` shape, so a document created under an older build is only
safe if its state already fits that shape. Checked against every published version:

| Document created at | Fits the frozen v1? |
| ------------------- | ------------------- |
| `1.0.54-dev.9` … `dev.12` | ✅ no state-shape gap at all |
| `1.0.52`, `1.0.54-dev.0` | ✅ in practice — the only gap is `bai/wbs` gaining `sowRef` / `sowProjectId`, both `.nullish()`, so `undefined` validates |

`powerhouse/scopeofwork` did not exist before `1.0.52`, so there are no old documents of it to
migrate. No published version has a document that the v1 → v2 upgrade leaves broken.

## Record

| Date | Drive | Result |
| ---- | ----- | ------ |
| 2026-09-18 | `c60679ae…` (my-personal-vault) | source **67/67** (56 + 11 stamped-v1) · knowledge-note **241/241** · vault-config **1/1** · pipeline-queue **1/1** ✓ |
| 2026-09-18 | `cf9b51d2…` | source **404/404** · knowledge-note **982/982** · vault-config **1/1** · pipeline-queue **2/2** ✓ |

All re-runs report `to upgrade: 0`. Live documents sampled against the v2
schemas the editors assert with (`*PHStateSchema`): 12/12 sources, 12/12 notes,
and every singleton, on both drives.

Verified on a sample document: `version 1 → 2`, `attachments` present as `[]`,
`originalFile`/`convertedBy` null, title and all pre-existing state preserved.
