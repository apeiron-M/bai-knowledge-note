# Browser sync executor synthesises `skip:1 CREATE_DOCUMENT` and dead-letters when sync envelopes split CREATE/UPGRADE/ADD_RELATIONSHIP across multiple deliveries

**Affected package:** `@powerhousedao/reactor-browser`
**Observed version:** 6.0.0-dev.240 (also reproduces on dev.239 and dev.241)
**Reactor:** 6.0.0-dev.240
**Switchboard:** runs locally via `ph vetra` (PGlite reactor storage)
**Connect:** 6.0.0-dev.240, dev mode at `http://localhost:3001`

---

## Summary

When bulk-uploading documents to a drive, a small but consistent fraction (~1–2%, 5/397 in our case) of documents end up dead-lettered on the client with `RevisionMismatchError: expected 1, got 0`. The browser's `executeLoadJob → executeCreate` path synthesises a `CREATE_DOCUMENT` operation with `skip: 1` and tries to write it at `index: 0` into the local `IOperationStore`, but the store is already at revision 1, so the write is rejected. After 4 retries the load job fails and the document is dead-lettered on the inbox.

The failing documents are different on each fresh upload — it is not data-dependent. The server's op log for the affected documents is **clean** (no `skip > 0` ops, all indices contiguous starting at 0). The issue is purely in how the client reconstructs missing ops when a load job arrives whose `operations[]` list starts at an index higher than what the local store has.

## Repro

1. Spin up a fresh `ph vetra` switchboard on `:4001` and Connect on `:3001`.
2. Run a bulk-upload script that creates 300+ documents back-to-back, then dispatches `ADD_RELATIONSHIP` cross-references (~1100 of them, ~3 per source doc) about 60 seconds after the creates finish. The total document-scope op log per source doc ends up looking like:
   - `index 0`: `CREATE_DOCUMENT` (Phase 2)
   - `index 1`: `UPGRADE_DOCUMENT` (Phase 2, auto-emitted by the namespaced `createDocument` mutation)
   - `index 2+`: `ADD_RELATIONSHIP` × N (Phase 4, ~60s later)
3. Open Connect with a clean IndexedDB (Clear Site Data) and navigate to the newly-uploaded drive.
4. Observe the dead-letter inspector — ~5 documents fail with the error below. The full sidebar still loads (global-scope ops apply fine); only document-scope sync into IOperationStore breaks for these specific docs.

We've reproduced this consistently across multiple fresh uploads. Different documents are affected each time, which suggests timing-/batching-sensitive behavior in the channel sync layer, not a per-document data issue.

## Failing job payload

```jsonc
{
  "id": "e7f61394-65b7-49ab-a9b3-d63d98af086e",
  "kind": "load",
  "documentId": "eaeb7141-e498-4221-a1e0-c2d1124d3456",
  "scope": "document",
  "branch": "main",
  "actions": [],
  "operations": [
    { "index": 1, "skip": 0, "action": { "type": "UPGRADE_DOCUMENT", ... } },
    { "index": 2, "skip": 0, "action": { "type": "ADD_RELATIONSHIP", "input": { "sourceId": "eaeb7141…", "targetId": "41274087…", "relationshipType": "RELATES_TO" } } },
    { "index": 3, "skip": 0, "action": { "type": "ADD_RELATIONSHIP", ... } }
  ]
}
```

Note: `index` starts at **1**, not 0. `CREATE_DOCUMENT` was delivered in an earlier sync envelope and is already in the local `IOperationStore` at index 0 (revision 1). The job's `actions[]` is empty.

## Synthesised op the executor tries to write

```jsonc
{
  "id": "906eea6c66282a18b184f100327acb0e",
  "index": 0,
  "skip": 1,
  "hash": "",
  "action": {
    "id": "07ea0b7b-de3a-4ac0-b6c4-248583b9f4f3",
    "type": "CREATE_DOCUMENT",
    "scope": "document",
    "input": {
      "name": "cqrs-separates-write-commands-from-read-queries-for-independent-scaling",
      "model": "bai/knowledge-note",
      "branch": "main",
      "version": 0,
      "documentId": "eaeb7141-e498-4221-a1e0-c2d1124d3456",
      "protocolVersions": { "base-reducer": 2 }
    },
    "timestampUtcMs": "2026-05-12T14:15:42.705Z"
  }
}
```

The synthesised op has `index: 0, skip: 1`. The store, already at revision 1, rejects with:

```
RevisionMismatchError: Failed to write operation to IOperationStore:
  Revision mismatch: expected 1, got 0
```

Stack trace (abbreviated):

```
writeOperationToStore  dist-ChuaKcnU.js:8370
  ↳ executeCreate      dist-ChuaKcnU.js:8134
  ↳ processActions     dist-ChuaKcnU.js:8574
  ↳ executeLoadJob     dist-ChuaKcnU.js:8777
```

## Server-side state (confirmed clean)

Querying `documentOperations(filter: { documentId: "eaeb7141…" })` on `/graphql/r` returns the full op log with **no `skip > 0` ops**:

```
idx=0  skip=0  CREATE_DOCUMENT   (document scope)
idx=1  skip=0  UPGRADE_DOCUMENT  (document scope)
idx=2  skip=0  ADD_RELATIONSHIP  (document scope)
idx=3  skip=0  ADD_RELATIONSHIP  (document scope)
+ global-scope SET_TITLE, SET_DESCRIPTION, SET_CONTENT, etc.
```

So the server's view is consistent; the synthesis happens entirely on the client.

## What the channel sync looks like to the affected docs

The sync cursor advances correctly:
- `inbox` cursor reaches 6131 / received 6131 (all envelopes acknowledged)
- `outbox`: ours-acked 6208 / sent 6208

Five docs nonetheless show entries in the inbox (status `Transport Pending`) AND in the dead-letter list (status `Failed`). The pending inbox entries are global-scope ops blocked on the doc-scope load failing.

## Hypothesis

In `executeLoadJob`, when the inbox delivers a job with `operations[]` whose first op has `index > 0` AND `actions` is empty:

- If the local store already contains the doc at the expected revision (because an earlier sync envelope delivered `CREATE_DOCUMENT`), the executor should **not** call `executeCreate` — it should just apply the given operations starting at the listed index.
- Currently it appears to unconditionally call `executeCreate` to "ensure" the doc exists, which synthesises a `CREATE_DOCUMENT` with `skip: 1` (to mark that earlier ops have been squashed/replaced). That synthesis only makes sense when the doc truly doesn't exist locally; when it already does at revision 1, the write conflicts.

This would explain why the bug is timing-sensitive: it only manifests for docs where `CREATE_DOCUMENT` lands in a different sync envelope than `UPGRADE_DOCUMENT + ADD_RELATIONSHIPs`. Our upload script naturally produces this split because Phase 2 (creates) and Phase 4 (cross-refs) are separated by ~60 seconds.

## Mitigations attempted (all unsuccessful)

| Attempt | Outcome |
|---|---|
| Dispatch `ADD_RELATIONSHIP` as a system action through `mutateDocument` | 1.3% dead-letter |
| Use the native `addRelationship(source, target, type)` mutation on `/graphql/r` | 1.3% dead-letter, **same shape** |
| Wipe browser IndexedDB and re-sync from scratch | Bug reproduces immediately |
| Wait for sync to fully complete before interacting | Failed envelopes stay dead-lettered indefinitely |

The dispatch path doesn't matter — both produce identical sync envelopes that hit the same client-side synthesis logic.

## Suggested fix

In `DocumentActionHandler.executeCreate` (or wherever `executeLoadJob` invokes it for "load" jobs with an empty `actions[]`):

```typescript
// Pseudo-code, near where executeCreate is called from executeLoadJob.
const localRevision = await store.getRevision(documentId, scope, branch);
const firstIncomingIndex = operations[0]?.index ?? 0;

if (firstIncomingIndex > 0 && localRevision >= firstIncomingIndex) {
  // The doc was created by an earlier sync envelope; no synthesis needed.
  // Just apply `operations[]` starting at firstIncomingIndex.
  return applyOperationsDirectly(operations);
}
// existing path: synthesise CREATE_DOCUMENT and apply
```

Alternatively, when synthesising the create with `skip: 1`, check the current revision first and either:
- skip writing the synthetic op if local already has revision ≥ 1, OR
- abandon synthesis and just skip ahead in the operations array.

## Impact on our project

We're using the drive-override pattern from `recipes/drive-override` to migrate ~400 knowledge-vault documents away from a singleton "knowledge-graph" document that previously held all nodes/edges in its state. The migration cut browser memory from ~869 MB to **93 MB stable** — a massive win — but this dead-letter bug means a random ~5 of 397 documents become unreachable in Connect on each fresh upload. Re-uploading produces a different set of 5 failing docs. We can ship the memory improvement, but those 5 docs require a manual re-sync or upstream fix to access.

Happy to share the full upload script and a minimal repro repo if useful.

---

## Environment

- OS: Linux 6.6.87.2-microsoft-standard-WSL2
- Browser: Chromium-based (Vivaldi/Chrome/Edge)
- Node: 20+
- Packages (all pinned to dev.240 via `ph use dev` except `shared`@dev.241):
  ```
  @powerhousedao/reactor@6.0.0-dev.240
  @powerhousedao/reactor-api@6.0.0-dev.240
  @powerhousedao/reactor-browser@6.0.0-dev.240
  @powerhousedao/connect@6.0.0-dev.240
  @powerhousedao/shared@6.0.0-dev.241
  document-model@6.0.0-dev.240
  ```
