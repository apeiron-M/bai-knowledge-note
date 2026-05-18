# dev.244 `splitTrailingSameTimestampRun` fix is incomplete — same-timestamp CREATE/UPGRADE pairs still split across envelopes when a docId-sort moves the boundary off the trailing edge

**Affected package:** `@powerhousedao/reactor`
**Observed versions:** 6.0.0-dev.244 through **6.0.0-dev.253** (still reproducing on the latest dev release as of 2026-05-18). The `splitTrailingSameTimestampRun` fix and the dev.247+ `lastJobByDoc` work do not cover this case.
**Related upstream commit:** `chore: added a failing test case for split CREATE/UPDATE delivery`
**Original bug report:** [reactor-browser-skip1-create-document-sync-race.md](./reactor-browser-skip1-create-document-sync-race.md) — describes the client-side symptom (`RevisionMismatchError: expected 1, got 0` + dead-letter)
**Reactor / Switchboard / Connect:** observed on both local (`ph vetra`) and remote (`eager-hen-55`); all on the same dev.X version each time

---

## Summary

dev.244 ships a fix in `@powerhousedao/reactor` that adds `splitTrailingSameTimestampRun` to `updateOutbox`. The intent is to prevent a CREATE/UPGRADE pair (or any pair of operations sharing `(documentId, branch, scope, timestampUtcMs)`) from being delivered in separate sync envelopes.

**The fix does not eliminate the bug for us.** On a fresh upload of 397 documents on dev.244, we still get **5 dead-lettered documents** with the exact same client-side failure shape described in the original report. Re-running the upload reproduces 5 dead-letters every time; the affected documents differ between runs.

This report documents **why** the fix is incomplete, with two concrete dead-letter payloads as evidence and a code-level analysis of the producer path.

## Repro

1. Fresh local switchboard (`ph vetra`), clean Connect (clear IndexedDB).
2. Run an upload script that:
   - Phase 2: creates ~400 documents back-to-back using the namespaced `createDocument` mutation (which auto-emits `CREATE_DOCUMENT` and `UPGRADE_DOCUMENT` at the **same timestamp**).
   - Phase 4: ~60s later, dispatches ~1100 `ADD_RELATIONSHIP` cross-references across those documents.
3. Open Connect with a clean IndexedDB and navigate to the new drive.
4. Observe `RevisionMismatchError: expected 1, got 0` in the console and 5 dead-lettered documents in the DB inspector.

## Two dead-letter payloads from a dev.244 run

**Doc 1 (`66109ab2-04ac-4940-88e0-61d719ac819f`):**

Operations delivered in the failing job:

| Type | Index | Skip | Ordinal | Timestamp |
|---|---|---|---|---|
| `UPGRADE_DOCUMENT` | 1 | 0 | **480** | 2026-05-13T10:18:40.577Z |
| `ADD_RELATIONSHIP` | 2 | 0 | 5197 | 2026-05-13T10:19:50.212Z |
| `ADD_RELATIONSHIP` | 3 | 0 | 5198 | 2026-05-13T10:19:50.234Z |

The `CREATE_DOCUMENT` at index 0 is missing from the job — it has ordinal **479** (immediately before `UPGRADE_DOCUMENT`) and the same timestamp `2026-05-13T10:18:40.577Z` as `UPGRADE_DOCUMENT`. It was delivered in a **prior** envelope. The client synthesizes a `skip:1 CREATE_DOCUMENT` to fill the gap → revision mismatch.

**Doc 2 (`082f85dd-207c-4f79-a8d0-67304f1ba971`):**

| Type | Index | Skip | Ordinal | Timestamp |
|---|---|---|---|---|
| `UPGRADE_DOCUMENT` | 1 | 0 | **1445** | 2026-05-13T10:19:05.371Z |
| `ADD_RELATIONSHIP` | 2 | 0 | 5611 | 2026-05-13T10:19:58.607Z |

Same pattern: `CREATE_DOCUMENT` at ordinal ~1444 with the same timestamp as `UPGRADE_DOCUMENT` ended up in a separate envelope.

**Adjacent ordinals + identical timestamps + still split.** That is exactly the case `splitTrailingSameTimestampRun` was meant to prevent.

## Root cause analysis

Source: [`updateOutbox` in `@powerhousedao/reactor/dist/index.js:8800–8855`].

The producer pulls operations from `operationIndex.find` in **ordinal-ordered pages**:

~~~js
let page = await this.operationIndex.find(
  remote.collectionId,
  ackOrdinal,
  { excludeSourceRemote: remote.name },
  void 0,
  composedSignal,
);
let carry = [];
let hasMore;
do {
  // ...
  let operations = page.results.map((entry) => toOperationWithContext(entry));
  if (carry.length > 0) {
    operations = [...carry, ...operations];
    carry = [];
  }
  // ...
  operations.sort((a, b) => {
    if (a.context.documentId !== b.context.documentId) return a.context.documentId < b.context.documentId ? -1 : 1;
    if (a.context.scope !== b.context.scope) return a.context.scope < b.context.scope ? -1 : 1;
    return a.context.ordinal - b.context.ordinal;
  });
  if (hasMore) {
    const split = splitTrailingSameTimestampRun(operations);
    carry = split.carry;
    emitBatches(split.emit);
  } else emitBatches(operations);
  if (hasMore) page = await page.next();
} while (hasMore);
~~~

And the split helper:

~~~js
function splitTrailingSameTimestampRun(operations) {
  // ... walks backwards from operations[length-1], capturing only the
  // trailing run that shares (documentId, branch, scope, timestampUtcMs)
  // with the very last operation.
}
~~~

### The flaw

`splitTrailingSameTimestampRun` protects **only the trailing edge** of the sorted page. But the **source pagination** that creates the splitting risk happens **before the sort**, in ordinal space. After the sort by `(documentId, scope, ordinal)`, the operation that sat at the source-page boundary (e.g. ordinal 1444) can land **anywhere** in the sorted output — usually in the middle, because docIds are random UUIDs.

Concretely, when the source page ends at ordinal 1444 (= `CREATE_DOCUMENT` for doc `082f85dd…`):

1. The sorted page ends with whichever docId sorts last alphabetically — **not** doc `082f85dd…` unless it happens to be lexically maximal.
2. `splitTrailingSameTimestampRun` looks at the trailing run for that other docId — finds nothing relevant and returns `carry: []`.
3. `CREATE_DOCUMENT` for `082f85dd…` is emitted as part of this envelope.
4. The next page loads ordinal 1445+, which contains `UPGRADE_DOCUMENT` for `082f85dd…` at the same timestamp. After sort, it goes out in the next envelope.
5. The client receives the second envelope, sees the load job starting at index 1, synthesizes `skip:1 CREATE_DOCUMENT` because it has no local revision, and fails with `RevisionMismatchError`.

The same-timestamp protection needs to apply to **every** `(documentId, scope, timestamp)` group whose last member lives at the source-page boundary — not just the one that happens to land at the trailing edge after sort.

## A second, independent flaw: `lastJobByDoc` resets on every `updateOutbox` call

We initially assumed dependency tracking on `SyncOperation` would save us: even if CREATE and UPGRADE land in different envelopes, the second envelope's `SyncOperation` should declare `jobDependencies: [<CREATE jobId>]`, forcing the client's executor to wait until CREATE applies. **But the dead-letter payloads show `jobDependencies: []` on the failing UPGRADE+ADD_RELATIONSHIP job.** The deps are not just incomplete — they're missing entirely.

That points to a second bug. Look at the producer:

```js
// node_modules/@powerhousedao/reactor/dist/index.js:8803
async updateOutbox(remote, ackOrdinal, mode = OutboxMode.Backfill, signal) {
  let maxOrdinal = ackOrdinal;
  const lastJobByDoc = new Map();   // ← reset on every call
  let prevChainJobId;
  // ...
  const emitBatches = (operations) => {
    const batches = batchOperationsByDocument(operations);
    for (const batch of batches) {
      const jobId = crypto.randomUUID();
      const prevJobId = lastJobByDoc.get(batch.documentId);   // ← only sees prior jobs in *this* call
      const deps = [];
      if (prevJobId) deps.push(prevJobId);
      // ... emit syncOp with deps ...
      lastJobByDoc.set(batch.documentId, jobId);
    }
  };
  // ...paginates operationIndex, calls emitBatches once per page...
}
```

And the trigger:

```js
// node_modules/@powerhousedao/reactor/dist/index.js:8645
async processCompleteBatch(batch) {
  // ...
  for (const remote of affectedRemotes)
    await this.updateOutbox(
      remote,
      remote.channel.outbox.latestOrdinal,
      OutboxMode.BatchTriggered,
    );
}
```

**Every batch committed to the operation index fires its own `updateOutbox` call.** Each call constructs a fresh `lastJobByDoc`. So when our import script commits hundreds of separate batches (one `createDocument` per doc, then one `mutateDocument` per doc, then one `addRelationship` per cross-reference), the producer fires hundreds of `updateOutbox` calls — each one **starts with an empty deps map** and emits its `SyncOperation`s with `jobDependencies: []`.

Within a single `updateOutbox` call, pagination preserves deps across pages — that part works. The bug is that **dep state doesn't survive across calls**.

### Why this is independent of (and prior to) the `splitTrailingSameTimestampRun` issue

Even if `splitTrailingSameTimestampRun` perfectly guaranteed that same-timestamp ops never cross an envelope boundary, the `lastJobByDoc` reset would still break the client when:

- `createDocument` for doc A commits batch B1 (CREATE + UPGRADE) → `processCompleteBatch` → `updateOutbox` call C1 emits one `SyncOperation` J1 with deps `[]`.
- 60 seconds later, `addRelationship` on doc A commits batch B2 (ADD_RELATIONSHIP) → `processCompleteBatch` → **`updateOutbox` call C2** emits `SyncOperation` J2 with deps `[]` (because `lastJobByDoc` was just constructed empty for this call).
- Connect receives J1 and J2. They have no declared dependency between them. The client's `SimpleJobExecutor` is free to schedule J2 before J1 completes. J2 looks for the doc locally, finds nothing, synthesizes `skip:1 CREATE_DOCUMENT`, fails with `RevisionMismatchError`.

In our actual repro the `splitTrailingSameTimestampRun` issue may also be in play (CREATE/UPGRADE landing on a page boundary within one `updateOutbox` call), but the **dep-loss across calls is sufficient on its own** to reproduce the dead-letter pattern, and it explains the empty `jobDependencies` in every dead-letter payload we've collected.

### What can't be worked around from our side

We considered several import-script changes and verified none of them prevents the bug:

- **Pacing / serializing commits.** No effect — every commit still fires its own `processCompleteBatch` → `updateOutbox` chain.
- **Closing Connect during upload.** Doesn't help — `processCompleteBatch` fires for every registered remote regardless of whether the consumer is polling. The Connect-channel remote accumulates `SyncOperation`s with empty deps in its outbox; the deps damage is already done by the time Connect comes back to poll.
- **Restarting the reactor between upload and consumer connection.** Plausibly helps because the in-memory outbox is discarded, forcing one fresh `updateOutbox(remote, ackOrdinal=0, …)` call on Connect's first poll — which would carry deps correctly across pages within that single call. But this is not deployable on remote switchboards (e.g. `eager-hen-55.vetra.io`) that we don't control.
- **Batching mutations into fewer transactions.** GraphQL request batching still produces separate operation-index commits server-side, each its own `processCompleteBatch`.

The bug lives in producer state management. It can't be prevented by anything the GraphQL client does.

## Suggested fix shapes

These are independent fixes for the two failure modes. Both are likely needed.

### For the `splitTrailingSameTimestampRun` gap (envelope split)

#### A. Detect carry candidates before sorting

Check the source-page boundary in **ordinal space** (before sort), find all ops in the last page whose `(documentId, branch, scope, timestampUtcMs)` matches an op that would also appear in the next page (or whose ordinal is at the page edge and timestamp matches an op pulled from the operation index ahead-of-cursor), and carry those forward.

#### B. Look ahead from `operationIndex`

When deciding whether to emit an op or carry it, peek at the next ordinal in `operationIndex` and check if it shares `(documentId, branch, scope, timestampUtcMs)`. If so, defer the current op to the next page. This avoids the sort-by-docId interaction entirely.

#### C. Don't sort by docId before the split check

`splitTrailingSameTimestampRun` could operate on the ordinal-ordered page (pre-sort), find all same-(docId, branch, scope, ts) groups whose last ordinal equals the page's max ordinal, and carry them. Then sort what's left.

### For the `lastJobByDoc` reset (missing deps)

#### D. Persist `lastJobByDoc` across calls per remote

Keep `lastJobByDoc` (or, more compactly, a `Map<docId, latestEmittedJobId>` per remote) as a property of the producer, not a local in `updateOutbox`. Read from it at the start of each call; update it as `SyncOperation`s are emitted; invalidate entries when the corresponding job is acked-and-applied. Then `updateOutbox` call N+1 sees the jobId emitted by call N and declares the correct `jobDependencies`.

#### E. Coalesce `processCompleteBatch` triggers

Instead of `processCompleteBatch` firing one `updateOutbox` per batch synchronously, debounce/coalesce bursts of batches so a flurry of commits becomes one `updateOutbox` call. This naturally keeps `lastJobByDoc` populated across what would otherwise be many calls. (Risk: introduces latency for low-volume workloads; might need to be opt-in.)

#### F. Declare cross-call deps explicitly on the `SyncOperation` schema

When `emitBatches` doesn't have an in-memory `lastJobByDoc` entry, fall back to querying the outbox for the latest already-emitted `SyncOperation.jobId` for that `(documentId, scope, branch)` and use it as the dep. This is more expensive per emit, but eliminates the in-memory-only assumption.

Of these, (D) is the cleanest: it preserves the existing per-call logic and just lifts the scope of one piece of state, with minimal API churn.

## Confirmation that this still reproduces on dev.253 (2026-05-18)

After upgrading the whole stack to `6.0.0-dev.253` and re-uploading the same 407-doc vault to the remote (`eager-hen-55`), opening Connect against that drive surfaces the same dead-letter pattern at startup. Sample console output from a fresh browser session loading the remote:

```
[reactor] Error writing {... type:"CREATE_DOCUMENT", index:0, skip:1,
   action.input.documentId: "bc0f0757-0b5f-4aa8-bf72-8fc643cb0c4a",
   action.input.name: "operational-collateral-fund-makes-oss-investable",
   timestampUtcMs: "2026-05-18T10:13:22.330Z"
} to IOperationStore: {"name":"RevisionMismatchError"}
```

Followed by `loadDeadLetters` surfacing the persisted IDs from the channel:

```
[reactor] Dead letter added for document f3c4a3ae-9c81-4091-83ac-66cc4696c5f8 on channel eb77da1b-…
[reactor] Dead letter added for document f3830ec4-fd46-44f0-91dd-f809d775c53f on channel eb77da1b-…
[reactor] Dead letter added for document 173a6cbb-619c-48be-a67a-33523d459786 on channel eb77da1b-…
[reactor] Dead letter added for document 7f010d75-2ccd-4176-897f-455616b605b8 on channel eb77da1b-…
[reactor] Dead letter added for document bc0f0757-0b5f-4aa8-bf72-8fc643cb0c4a on channel eb77da1b-…
[reactor] Dead letter added for document 20fc0c40-831b-4d2f-a846-21bcb0cda754 on channel eb77da1b-…
[reactor] Dead letter added for document 8d7fb34e-200c-4c40-9db1-c438c3c90602 on channel eb77da1b-…
```

7+ docs out of 407 dead-lettered on this run (~1.7%) — consistent with the dev.244 observation of ~1.3–1.7%. The synthesised payload (`index:0, skip:1, type:"CREATE_DOCUMENT"`) is identical, indicating the same root cause described in this report.

**Bundle hash:** `dist-CF4j225r.js?v=7eb4dcab`, `reactor-DFuRedvV-hKa5kZ7k.js?v=7eb4dcab` (whatever Connect is serving as of 2026-05-18 11:21 BST).

### Full dead-letter payload from a dev.253 session

One of the 7 dead-letters (`f3c4a3ae-9c81-4091-83ac-66cc4696c5f8`), pulled from Connect's DB inspector, showing **both** root causes (split envelope + empty deps) firing together:

| Op type | Index | Ordinal | timestampUtcMs |
|---|---|---|---|
| `UPGRADE_DOCUMENT` | 1 | **395** | 2026-05-18T10:12:45.352Z |
| `ADD_RELATIONSHIP` | 2 | 5358 | 2026-05-18T10:15:41.195Z |
| `ADD_RELATIONSHIP` | 3 | 5359 | 2026-05-18T10:15:41.490Z |
| `ADD_RELATIONSHIP` | 4 | 5360 | 2026-05-18T10:15:41.552Z |
| `ADD_RELATIONSHIP` | 5 | 5361 | 2026-05-18T10:15:41.587Z |
| `ADD_RELATIONSHIP` | 6 | 5362 | 2026-05-18T10:15:41.612Z |

The `CREATE_DOCUMENT` at server index 0 has ordinal **394** with the same timestamp `2026-05-18T10:12:45.352Z` — adjacent to UPGRADE and sharing the timestamp, so `splitTrailingSameTimestampRun` should have kept them in the same envelope. It didn't — same shape as the dev.244 examples earlier in this report.

Critically, the failing job has:

```
jobDependencies: []
```

Empty deps confirms the **second** flaw (the `lastJobByDoc` reset across `updateOutbox` calls — see the section above). Both root causes are independently firing in dev.253, so either fix on its own would not eliminate this case; both fixes are needed.

**dev.247–.253 changelog:** zero commits touching `outbox`, `lastJobByDoc`, `splitTrailingSameTimestampRun`, or `RevisionMismatch`. The fix is still pending.

This bug is **strictly upstream**; nothing in the consuming app can prevent it. We can recover after the fact by deleting + recreating the affected server docs (we have a planned `--repair` flag in the upload script for this) but new uploads will keep producing fresh dead-letters until either fix (D) or fix (E/F) lands.

## Impact on our project

Same impact as the original report: ~1.3% (5/397) of documents become unreachable in Connect on each fresh upload. The drive-override migration (memory drop from 869 MB → 94 MB stable) is unaffected; only these specific docs require a manual workaround.

We have a local-side workaround that silently skips edges referencing missing target docs in our Graph View (so the UX is clean), but the underlying client-side dead-letter remains until this is fixed upstream.

## Environment

- OS: Linux 6.6.87.2-microsoft-standard-WSL2
- Browser: Chromium-based (Vivaldi/Chrome/Edge)
- Node: 20+
- Originally observed on `6.0.0-dev.244`; still reproducing on `6.0.0-dev.253` (2026-05-18) with the same shape.

```
@powerhousedao/reactor@6.0.0-dev.253
@powerhousedao/reactor-api@6.0.0-dev.253
@powerhousedao/reactor-browser@6.0.0-dev.253
@powerhousedao/connect@6.0.0-dev.253
@powerhousedao/shared@6.0.0-dev.253
document-model@6.0.0-dev.253
```

Happy to share the upload script and a minimal repro repo.
