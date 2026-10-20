# Upstream bug report — Powerhouse `6.2.3-dev.4`

Four defects found while building the vault HTTP surface (`feat/http-surface`).
Each was reproduced live on 2026-09-14 against a local Switchboard
(`ph vetra`, PGlite, drive `cf9b51d2-…`, 1489 nodes). Every probe document was
deleted afterwards and the node count verified back at 1489.

Three of the four share a theme: **an operation succeeds partially, or fails
after doing work, and the caller is told it went fine.**

| | Field | Value |
|-|-------|-------|
| Reported against | `@powerhousedao/*` `6.2.3-dev.4`, `switchboard` CLI `1.0.36` |
| Environment | Arch Linux, node 26, `ph vetra` (dev mode), PGlite reactor store, `AUTH_ENABLED=true`, `DOCUMENT_PERMISSIONS_ENABLED=true` |
| Reproduced | all four, live, in one session |

## Summary

| # | Defect | Severity | Where |
|---|--------|----------|-------|
| 1 | A batch reports success while one of its actions was rejected | **data loss, silent** | `reactor` job status |
| 2 | `docs create` times out, but the document is created — without its folder | **orphaned data** | `reactor` `DriveClient.addFile` + CLI |
| 3 | Every operation stores a full copy of the document's state | performance, scales badly | `reactor` executor |
| 4 | `addRelationship` cannot carry metadata, and there is no `updateRelationship` | missing capability | `reactor-api` GraphQL |

---

## 1. A batch reports success while one of its actions was rejected

**What happens.** Send three actions in one batch, where the middle one is
invalid. The job reports success. Two actions applied, one did not, and nothing
in the reply says so.

**Why it matters.** The caller has no reason to look further, so the missing
write is discovered later — or never. In our case a note ended up with no
description while the tool that wrote it reported success.

**Reproduce.**

```graphql
mutation {
  executeAsync(documentIdentifier: "<a bai/knowledge-note>", branch: "main", actions: [
    { id: "…", type: "SET_TITLE",       timestampUtcMs: "<iso>", scope: "global", input: { title: "Probe", updatedAt: "<iso>" } },
    { id: "…", type: "SET_DESCRIPTION", timestampUtcMs: "<iso>", scope: "global", input: { description: "<260 characters>", updatedAt: "<iso>" } },
    { id: "…", type: "SET_NOTE_TYPE",   timestampUtcMs: "<iso>", scope: "global", input: { noteType: "concept", updatedAt: "<iso>" } }
  ]) { id }
}
```

`SET_DESCRIPTION` is rejected by the reducer — the model caps a description at
200 characters.

**Observed.**

```
jobStatus  -> { "status": "READ_READY", "error": null }        <- reports success

operations -> op 0 SET_TITLE       error: null
              op 1 SET_DESCRIPTION error: "Description exceeds 200 characters"
              op 2 SET_NOTE_TYPE   error: null

state      -> title "Probe", noteType "concept", description ""
```

**The information exists.** The error is recorded correctly on the operation.
It just never reaches the job status, which is the only thing most callers
check. The `switchboard` CLI inherits this: `docs apply --wait` prints
`{"status": "READ_READY", "error": null}` for the same batch.

**Suggested fix.** Have the job status reflect its operations — either a
distinct terminal status when any action errored, or a count of failed actions
on the job. Any of those lets a caller notice without fetching the operation
log and diffing it.

**Note.** Envelope-level problems *are* reported properly. The same batch with a
malformed `timestampUtcMs` failed loudly and correctly:
`FAILED — Invalid timestamp "1789393465164" on action SET_TITLE`. So the gap is
specifically reducer errors, not error reporting in general.

---

## 2. `docs create` times out, but the document is created — without its folder

**What happens.** `switchboard docs create --parent-folder <uuid>` prints a
connection timeout. The document exists anyway — at the drive root, with
`parentFolder: null`. Retrying makes a **second** document.

**Why it matters.** Two failure modes at once: a success reported as a failure,
and a document that exists but is in the wrong place. A document at the drive
root is invisible to folder views and to any pipeline that scans a folder. And
because the caller is told it failed, the natural response — retry — creates a
duplicate. We hit this three times in one session and twice it left an orphan.

**Reproduce.** Run `switchboard docs create --type bai/knowledge-note --name X
--drive <uuid> --parent-folder <folder-uuid>` repeatedly against a busy
reactor. It is intermittent, and more likely when the reactor is under load.

**Observed** (two separate occurrences, same session):

```
$ switchboard docs create … --parent-folder a12f15c0-…
Error: Failed to connect to http://localhost:4001/graphql: operation timed out

$ # but the document exists:
33682d1e-…  parentFolder = None   name = "zz-partial-write-probe"

$ # and the retry, with identical arguments, places correctly:
af17aaf5-…  parentFolder = a12f15c0-…  name = "zz-partial-write-probe (copy) 1"
```

**Root cause.** `DriveClient.addFile`
(`packages/reactor/src/client/drive-client.ts:84-188`) is deliberately **two
awaited jobs**, not one:

1. on the new document — `CREATE_DOCUMENT`, `UPGRADE_DOCUMENT`, `ADD_RELATIONSHIP`
2. on the drive — `ADD_FILE`

The source comment explains the split: batching them would let a file node
survive a create that never landed. That reasoning is sound, but it leaves a
window. When the client times out between job 1 and job 2, the document is
already committed and the containment never happens. The CLI surfaces only the
transport error.

**Note that `ADD_FILE` itself is fine.** Dispatching `ADD_FILE` directly with a
`parentFolder` always placed correctly in our testing, including four in one
batch. The defect is the gap between the two jobs, not the placement logic.

**Suggested fix.** Make the operation recoverable rather than atomic: on
reconnect, or on the next create, detect a document that exists with no
containment and finish job 2. Failing that, the client error should say the
document may have been created, so callers do not retry blindly.

---

## 3. Every operation stores a full copy of the document's state

**What happens.** Each operation is written with `resultingState` — a JSON
string of the **entire** document state at that revision.
`packages/reactor/src/executor/simple-job-executor.ts`, in the per-action
prepare step (shipped at
`@powerhousedao/reactor/dist/drive-container-types-yZrksiJR.js:3694`):

```js
const resultingState = JSON.stringify({
  ...updatedDocument.state,
  header: updatedDocument.header,
});
```

**Why it matters.** The cost of a write scales with the size of the document
being written to, not with the size of the change. For a note that is
irrelevant. For a **drive** it is not: a drive holds every file node, so adding
one file re-serialises the whole list. Creating N documents into one drive
costs O(N²) JSON.

This is our single largest source of latency. It also gets worse over time —
the same operation is cheap on a new drive and expensive on a mature one.

**Measured** (drive with 1489 nodes):

| | time |
|---|---|
| 4 documents created sequentially (4 separate `ADD_FILE`s) | **5.02 s** |
| the same 4 `ADD_FILE`s in one batched dispatch | **1.41 s** |

Batching helps because one dispatch pays the serialisation once instead of four
times. That workaround only exists because `ADD_FILE` happens to be batchable.

Node makes this worse: the reactor is CPU-bound on one JS thread (PGlite runs
in-process), so this serialisation blocks every concurrent read. We measured
unrelated queries spiking from ~12 ms to 500–700 ms while writes were running.

**We understand why it exists.** A full snapshot per operation makes "read the
state at revision N" instant, with no replay. That is a real benefit.

**Suggested fix.** Decouple snapshot frequency from operation count — snapshot
every N operations and replay the short tail, store a diff, or keep the full
state only for the latest revision. Any of these keeps writes proportional to
the change rather than to the document.

---

## 4. `addRelationship` cannot carry metadata, and there is no `updateRelationship`

**What happens.** The GraphQL relationship mutations take no metadata:

```graphql
addRelationship(sourceIdentifier: String, targetIdentifier: String, relationshipType: String, branch: String)
removeRelationship(sourceIdentifier: String, targetIdentifier: String, relationshipType: String, branch: String)
moveRelationship(sourceParentIdentifier: String, targetParentIdentifier: String, targetIdentifier: String, relationshipType: String, branch: String)
```

(verified by introspection against a running Switchboard, `6.2.3-dev.4`)

**Why it matters.** The underlying `ADD_RELATIONSHIP` action *does* accept a
`metadata` object — the reactor stores it and it can be read back. So the
capability exists everywhere except the GraphQL surface. A GraphQL client
cannot write an annotated edge at all, and there is no `updateRelationship`, so
it cannot amend one either.

For us this matters because an edge carries the reason it exists. Over GraphQL
we have to bypass these mutations and hand-build an `ADD_RELATIONSHIP` action
through the generic `execute` mutation — which means stamping our own envelope
and giving up the convenience the mutation exists to provide.

**Suggested fix.** Add an optional `metadata: JSONObject` to `addRelationship`,
and an `updateRelationship` that replaces it. Both map onto actions the reactor
already supports.

---

## Appendix — how these were verified

- All four reproduced on 2026-09-14 against `ph vetra` at `6.2.3-dev.4`.
- #1 and #4 were reproduced through raw GraphQL, so neither depends on the
  `switchboard` CLI. #1 also reproduces through `docs apply --wait`.
- #2 occurred unprompted three times during unrelated work, leaving two
  orphaned documents; both were verified in the drive tree before deletion.
- #3 was verified by reading the shipped bundle, and quantified with the
  4-document timing above.
- Probe documents were deleted after each test and the drive confirmed back at
  1489 nodes with zero documents at the root.

### Not filed

`REACTOR_WORKERS` refusing to start in dev mode and on PGlite is **not** a bug —
both guards are deliberate and the error messages explain why (Vite-loaded
document models cannot cross a worker boundary; PGlite cannot be shared across
threads). Recorded here only because it removes the obvious workaround for #3.
