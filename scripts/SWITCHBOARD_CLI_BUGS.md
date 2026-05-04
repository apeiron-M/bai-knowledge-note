# Switchboard CLI — `export` / `import` Roundtrip — Status & Findings

## 1. Summary

This document started as a bug report against `switchboard` 1.0.20-ish after a failed roundtrip of the 398-doc `powerhouse-vault`. Six CLI bugs were filed; **all six are fixed in 1.0.22** along with folder-reconstruction support. **1.0.23 added forward-reference deferral**, closing the largest remaining gap surfaced in the 1.0.22 e2e run and lifting in-import link resolution from 53% to 100%. The only deferred piece left is schema-aware op translation (§4.3), which would recover the ~12% of ops still rejected for carrying fields the current schema no longer accepts.

## 2. Environment

| Item            | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| CLI binary      | `/home/p/.cargo/bin/switchboard` (1.0.23)                            |
| Source endpoint | `https://switchboard-dev.powerhouse.xyz/graphql` (profile `remote-dev`) |
| Source drive    | `powerhouse-vault` (398 documents, 666 inter-note links, 7 folders)  |
| Target endpoint | `http://localhost:4001/graphql` (profile `local`)                    |
| Target drive    | freshly created via `switchboard drives create` (`diff upload vault`) |
| Document models | `bai/knowledge-note`, `bai/moc`, `bai/source`, `bai/vault-config`, `bai/health-report`, `bai/pipeline-queue`, `bai/knowledge-graph` |
| 1.0.22 e2e date | 2026-04-29                                                           |
| 1.0.23 e2e date | 2026-04-30                                                           |

---

## 3. Bugs

### ✅ Bug 1 — `switchboard import` silently produced empty docs when ops failed

**Status:** **Fixed in 1.0.22.**

Previously, per-op rejections were rendered as `⚠` warnings while the final per-doc and overall summary still claimed `State: ✓ EXACT MATCH` / `✓ Imported`. The exit code was always `0`.

The 1.0.22 import now distinguishes three per-doc verdicts:

- `State: ✓ EXACT MATCH` — every op applied and final state is byte-identical to source.
- `State: ✗ MISMATCH` followed by `✓ Imported (state has drift on volatile fields)` — every op applied, but the final state differs from source on fields that are expected to differ (e.g., reference IDs that were rewritten; see Bug 2).
- `Imported with errors` — at least one op was rejected by the reactor.

The final line summarizes: `⚠ 286/398 documents imported into drive '<id>' (5172 ops attempted, 843 failed)` and the process exits non-zero. `--strict` flips per-op rejections into hard failures for CI use.

**Verification on 2026-04-29 e2e run:**

- 107 docs reported `EXACT MATCH`, 179 `drift on volatile fields`, 112 `Imported with errors` — sums to 398, no doc is silently skipped.
- Final exit code: `1` (`Error: import finished with errors: only 286/398 documents fully imported`).

---

### ✅ Bug 2 — Document IDs not preserved on import; cross-doc references not rewritten

**Status:** **Mostly fixed in 1.0.22 — one remaining gap covered in §4.1.**

The CLI now auto-builds an old→new UUID map across the import and recursively rewrites UUID-shaped strings in op inputs. A `--id-mapping <file>` flag lets users supply or persist this map across invocations.

**Verified working on 2026-04-29 e2e run:**

- Document IDs reassigned on import (0/398 IDs preserved across runs — by design; preservation is a separate feature).
- MOC `coreIdeas[].noteRef`: **100%** of references in 27 MOCs point to local IDs.
- MOC `childRefs[]`: **100%** rewritten.
- knowledge-note `links[].targetDocumentId`: **348/666 = 52.3%** rewritten (see §4.1).

---

### ✅ Bug 3 — `export drive --with-ops` sometimes emitted empty `operations.json`

**Status:** **Reportedly addressed in 1.0.22 ("make it loud" — explicit warning when documentOperations returns 0 but revisionsList says non-zero).** The 2026-04-29 e2e re-export of `powerhouse-vault` produced non-empty `operations.json` for every doc with non-zero revisions; no warning fired. Treating as resolved unless it recurs.

---

### ✅ Bug 4 — `export doc --drive <slug>` errored on docs verifiably on that drive

**Status:** **Fixed in 1.0.22.** `helpers::resolve_doc` now falls back to scanning `state.global.nodes` when the `documentChildren` index lags. Not retested individually on 2026-04-29 (full-drive export was used), but the fix is mechanical and the e2e didn't surface any export-side issues.

---

### ✅ Bug 5 — `config show -p <profile>` ignored the profile flag

**Status:** **Fixed in 1.0.22** by plumbing `--profile` through `Commands::Config → config::show()`. All commands in the 2026-04-29 run honored `--profile local` and `--profile remote-dev` correctly.

---

### ✅ Bug 6 — `switchboard import` did not auto-introspect for unknown types

**Status:** **Fixed in 1.0.22.** First encounter with `bai/vault-config` on a fresh local profile triggered:

```
ℹ Type 'bai/vault-config' not in cache — re-introspecting...
```

The import then proceeded without manual `switchboard introspect`. Confirmed in the 2026-04-29 log.

---

### ✅ Folder reconstruction (post-bug-report follow-up)

**Status:** **Implemented in 1.0.22.** Directory args are walked; folder hierarchy is mirrored on the destination via `addFolder` + `moveNode`.

**Verified on 2026-04-29 e2e run:** 7/7 source folders recreated on the target drive (`knowledge`, `knowledge/notes`, `ops`, `ops/health`, `ops/queue`, `self`, `sources`). Every imported doc landed in the correct folder.

---

### Bug 8 — `drives delete` doesn't purge operation history; subsequent re-bootstrap fails with `RevisionMismatchError`

**Status:** Open. Discovered 2026-04-30 while resetting the local reactor for the 1.0.23 e2e run.

**Reproduction:**

1. Stop `ph vetra`.
2. With the reactor running on a previous restart that created system drives, list them — there will be `vetra-<hash>` and `preview-<hash>` entries managed by the dev environment.
3. Run `switchboard --profile local drives delete vetra-<hash> -y` and `... preview-<hash> -y`. CLI reports `✓ Deleted drive`.
4. Restart `ph vetra`.

**Observed:** Reactor bootstrap re-runs `CREATE_DOCUMENT` for `vetra-<hash>` at revision 0, but the IOperationStore still has the prior op log at revision 3, so every bootstrap action fails:

```
ERROR Job <id> failed with Failed to write operation to IOperationStore:
  Revision mismatch: expected 3, got 0
```

The reactor retries 3× (visible in `errorHistory`) and then gives up. The drive document is gone but the op log isn't — the dev environment's auto-init can't produce a coherent state. `MaxListenersExceededWarning: 11 SIGINT/SIGTERM listeners` accompanies it, suggesting each retry adds a new shutdown listener.

**Diagnosis:** `drives delete` removes the drive document and (presumably) drops its node tree, but does not call into the IOperationStore to purge that drive ID's append-only operation history. Any future creator that uses the same slug — including the dev env's auto-bootstrap — sees revision 3 lying around and rejects revision-0 writes.

**Expected:** Either (a) `drives delete` cascades the deletion into the operation store so the drive ID is fully recyclable, or (b) `drives delete --keep-history` is the opt-in non-cascading variant and the default cascades. Either way, a second `drives create` (or auto-bootstrap) for the same slug must succeed without manual storage surgery.

**Workaround:** Stop the reactor and wipe `<repo>/.ph/reactor-storage/` and `<repo>/.ph/read-storage/`. Destroys ALL drive content, not just the deleted ones — i.e., a second-order data loss for users who delete one drive and then need to re-bootstrap.

---

### Bug 9 — `switchboard import` doesn't dedupe singletons by type; creates `(copy) 1` duplicates

**Status:** Open. Discovered 2026-04-30 during the 1.0.23 e2e against a Connect-managed drive.

**Reproduction:**

1. Create a drive in Connect (or any flow that triggers `useDriveInit`-style auto-seeding of singleton-typed docs — e.g., `bai/vault-config`, `bai/knowledge-graph`, `bai/health-report`, `bai/pipeline-queue`).
2. Run `switchboard import <export> --drive <id>` against the export of another drive that contains its own copies of the same singleton types.

**Observed:** The import sees that `VaultConfig` already exists by name on the target and creates a second `bai/vault-config` doc named `VaultConfig (copy) 1`. Same for the other three singleton types. The destination drive ends up with 8 singleton docs (4 originals + 4 imported copies).

```
bai/vault-config:    VaultConfig
                     VaultConfig (copy) 1
bai/knowledge-graph: KnowledgeGraph
                     KnowledgeGraph (copy) 1
... etc
```

**Expected:** A `--dedupe-singletons` flag (or default behavior for known singleton types) that:

- For document types that are conventionally singleton-per-drive (e.g., types listed in a `meta.singleton: true` schema marker, or that the drive registry treats as one-per-drive), upsert by (drive, type) instead of by name.
- Or skip the import for that doc when the target drive already has a doc of that type, with a one-line summary in the per-doc verdict.

The current `(copy) 1` rename is well-intentioned but produces a confusing drive structure that downstream editors and hooks (which look up singletons by type) can't reason about.

---

## 4. New findings from the 1.0.22 e2e run

### ✅ 4.1 Forward references in dense cross-doc graphs

**Status:** **Fixed in 1.0.23.** Implemented as the deferral-queue design (option #2 below) and verified on the same 398-doc vault that exposed the gap in 1.0.22.

**Original observation (against 1.0.22):** With Bug 2 fixed, MOC references resolve at 100% but knowledge-note `links[].targetDocumentId` resolve at only 52.3% (348/666). Every sampled unresolved link still pointed at the original *remote* UUID — i.e., it was never rewritten because the target's new ID wasn't yet in the old→new map at the time the source doc's `ADD_LINK` op was dispatched. Forward-ref load is structural: with 666 links in a 398-doc drive, ~50% of references are forward by import order.

**1.0.23 implementation (deferral queue, option #2):**

- `has_forward_ref(value, id_map)` — pure recursive walk that returns `true` if any UUID-shaped string in the input isn't yet in the map.
- `DeferredOp { doc_id, doc_type, doc_name, op }` — minimal record of an op queued for the second pass.
- `push_operations_via_mutate(..., &mut Vec<DeferredOp>)` — enqueues forward-ref ops instead of dispatching them with bad UUIDs.
- `drain_deferred_ops` — after every doc is created, drains the queue with the now-complete map.
- `dispatch_op` — extracted shared mutation-building helper used by both push and drain (no duplication).

Designs considered but not implemented (kept here for reference):

1. **Two-pass import (`--two-pass`)** — phase 1 creates every doc, phase 2 dispatches all ops. Trivial but doubles create round-trips; not needed once #2 was working.
2. **Deferral queue** — chosen. Single pass; queues only ops whose inputs reference unknown UUIDs, drains after all docs exist. No extra round-trips for ops with no forward refs (the common case). Doesn't require classifying ops by type.
3. **Schema-aware classification** — would be more precise but requires the introspected schema to expose `OID`/`PHID` typing. Skipped.

**Verification on the 2026-04-30 e2e run** (398 docs, 666 inter-note links, fresh local drive, 1.0.23):

```
…
  ⚠ Drained: 2010 resolved, 81 failed
⚠ 297/398 documents imported into drive '...' (7263 ops attempted, 843 failed)
```

| Metric                          | 1.0.22       | 1.0.23           | Δ              |
| ------------------------------- | ------------ | ---------------- | -------------- |
| Resolvable refs (target imported) | 348/657 (53%) | **657/657 (100%)** | every forward ref now rewritten |
| Phantom refs (no target anywhere) | 9            | 9                | unchanged — pre-existing data quality |
| Links still pointing at remote IDs | 318          | **0**            | drain phase resolved them all |
| Docs fully imported (exact + drift) | 286          | 297              | +11 |
| Verdict shift                    | exact 107 / drift 179 / errors 112 | exact 15 / drift **282** / errors 101 | rewritten IDs now visible in byte-diff → "drift" |

The `Drained: 2010 resolved, 81 failed` line in the 1.0.23 log is the new feature reporting itself: 2010 forward-ref ops were queued, then dispatched successfully after the map was complete; the 81 drain failures are ops that *also* hit schema drift (`ADD_TOPIC` carrying a `KnowledgeNote_AddTopicInput.updatedAt` field the current schema doesn't accept — covered in §4.3, not a regression).

[`scripts/relink.mjs`](relink.mjs) — the 200-line workaround that demonstrated this fix before the CLI implementation landed — is now obsolete but kept in-tree as a working reference for the design.

### 4.2 No way to set `preferredEditor` after drive creation

**Observation:** `preferredEditor` is a top-level `PHDocument` field stored in the document header (not in `state.global`), and Connect uses it to pick the drive-app that opens the drive (e.g., our `knowledge-vault` editor). The `switchboard drives create --preferred-editor <id>` flag persists it correctly at creation time, verified by:

```bash
$ switchboard --profile local drives create --name "x" --preferred-editor "knowledge-vault" --format json
{ "id": "...", ... }

$ # → preferredEditor field on the resulting PHDocument is "knowledge-vault"
```

The 2026-04-29 e2e run forgot to pass `--preferred-editor` when creating the target drive, so `diff upload vault` opens with the generic Connect explorer instead of the knowledge-vault drive-app.

**Gap:** there's no way to set `preferredEditor` on an existing drive. The `DocumentDriveMutations` GraphQL type exposes `setDriveName`, `setDriveIcon`, `setSharingType`, `setAvailableOffline`, listener/trigger ops, etc. — but no `setPreferredEditor`. The only recovery path is delete-and-recreate, which forces a full re-import for every doc.

**Suggested feature:** either (a) a `setPreferredEditor` action on the document-drive type (requires a doc-model change), or (b) a CLI-side `switchboard drives update --preferred-editor <id>` that synthesizes whatever it needs to under the hood (e.g., a header-update mutation). Either would let users opt into a custom drive-app after a drive's already populated, instead of having to nuke and re-import.

### 4.3 Schema drift in the inverse direction (deferred §4 §1, restated)

The original Bug 1 surfaced ops that *lacked* a now-required `updatedAt` field. The 2026-04-29 run surfaced the opposite case across two doc types:

**`bai/source`:** 743 `ADD_EXTRACTED_CLAIM`, `SET_SOURCE_STATUS`, and `RECORD_EXTRACTION_STATS` ops were rejected with:

```
Field "updatedAt" is not defined by type "Source_AddExtractedClaimInput"
Field "updatedAt" is not defined by type "Source_SetSourceStatusInput"
Field "updatedAt" is not defined by type "Source_RecordExtractionStatsInput"
```

— i.e., ops that *carry* a now-removed field. Same root cause (schema drift between when ops were captured and the current target schema), opposite direction.

**`bai/health-report`:** `ADD_CHECK` ops rejected because the enum value `METHODOLOGY_GROUNDING` is no longer in `HealthReport_HealthCategory`.

**Total impact:** 843/7263 ops (11.6%) rejected on the 1.0.23 e2e run, all schema-drift related, all surfaced honestly by the per-op `✗` reporting (Bug 1 fix). Count is unchanged from the 1.0.22 run since these failures are independent of the forward-ref deferral.

**Resolution path:** these are exactly the cases that the deferred "schema-aware op translation" work (§4 §1 of the original report) is meant to handle — translate input shapes against the target schema before dispatch (fill missing required fields, drop fields no longer accepted, map renamed enum values to the closest current value or warn). No new CLI work required to *report* these correctly; they're already correctly reported.

---

## 5. Recommended next CLI work

In priority order:

1. **Schema-aware op translation** (§4.3, already on roadmap) — would recover the 11.6% of ops dropped to schema drift in the e2e run.
2. **`drives update --preferred-editor <id>`** (§4.2) — let users opt into a custom drive-app after the drive's been populated, instead of nuke-and-re-import.
3. **Singleton dedup on import** (Bug 9) — upsert-by-type for known singleton document types instead of creating `(copy) 1` duplicates.
4. **Cascade `drives delete` into operation store** (Bug 8) — so re-creating a deleted drive's slug doesn't fail with `RevisionMismatchError`.
5. **`--from-state` fallback** (already on roadmap) — last-resort safety net when ops can't replay even after translation.
6. **`--preserve-ids`** for empty-target imports — for users who want to keep original UUIDs (e.g., to preserve external systems referencing them by ID).

~~Forward-reference deferral~~ — **shipped in 1.0.23** (§4.1).

---

## 6. Historical workaround (kept for reference)

Before 1.0.22, the bypass was a pair of bespoke scripts at `scripts/legacy/` (now archived):

- **`vault-export.mjs`** — issued raw GraphQL queries against the source endpoint and wrote each doc as `<id>.json` containing `{ id, type, name, state }`.
- **`vault-import.mjs`** — read each dump, looked up the current schema for the target type, reconstructed current-schema actions from the exported state, and dispatched via `switchboard docs create` + `switchboard docs apply`. Ran a second pass after all docs were created to resolve cross-doc references using an old→new ID map built during creation.

The 1.0.22 CLI subsumes the entire workflow and adds verdict reporting that the bespoke scripts didn't have. The only feature still missing relative to the workaround is the second-pass link resolution (§4.1).
