# Write Path Correctness, Batch Create, and GraphQL Resolver Performance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the vault write path fast *and* honest, and remove the fixed per-request overhead that makes every GraphQL graph query ~20x slower than its REST equivalent. Three outcomes: (1) `POST actions` can never again report success it did not verify; (2) creating N notes costs roughly one containment dispatch instead of N; (3) `knowledgeGraph*` queries drop from ~290 ms to the ~15 ms the underlying SQL actually takes.

**Contract of record:** [`docs/http-api.md`](../../http-api.md). Every route added or changed by this plan updates that table in the same task, and the grep invariant must keep holding: grepping it for `"public"` lists every unauthenticated route (today: `badge.svg` only).

**Spec:** [`docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md`](../specs/2026-09-13-http-surface-slice1-design.md) — the design of record for the HTTP surface; amended by Task 5 of this plan.

---

## Evidence base

Everything below was measured on 2026-09-14 against the live local Switchboard
(`http://localhost:4001`, package `1.0.54-dev.10`, stack `6.2.3-dev.4`, drive
`cf9b51d2-…` / `powerhouse-knowledge`, 1489 nodes). Medians unless stated.
All probe documents were deleted and the node count verified back at 1489.

### E1 — The read-back bug is deterministic, not a race

12 sequential `POST actions` against a freshly created note:

| run | latency | `operations[]` |
|---|---|---|
| 1 | 2.83 s | **0** |
| 2–12 | 0.11–0.91 s | 1 |

A fresh document's revision map is `[{scope: "document", revision: 2}]` — **there is no
`global` entry**. `write.ts` computes

```ts
const revisions = Object.values(options.document.header.revision ?? { global: 0 }); // [2]
const prior = revisions.length ? Math.min(...revisions) : 0;                        // 2
```

then filters `getOperations` with `sinceRevision: 2`. The write's first global operation lands
at **global index 0**, so `index >= 2` excludes it. Verified directly: the op is at global index
0 and the response was `{"revision":{"document":2,"global":1},"operations":[]}`.

**Root cause:** `prior` is a single scalar taken as `Math.min` across a *per-scope* revision map,
but `sinceRevision` filters a *per-scope* index. The two are not comparable. Consequences:

1. Every first global-scope write to a newly created document returns `operations: []` with HTTP 200.
2. That is exactly the create-then-populate sequence Task 4 introduces, so this blocks batch create.
3. It costs the full 5 × 200 ms retry budget every time — a latency bug as well as a correctness one.
4. `write.test.ts:157` covers only *retry-then-succeed*. **There is no test for the exhausted path**, which is why it shipped.

### E2 — Containment, not creation, is the cost of creating a document

| | sequential, warm each | 4 in parallel, wall |
|---|---|---|
| `createEmptyDocument` **with** `parentIdentifier` | ~1.25 s | **3.56 s** |
| `createEmptyDocument` **bare** (no parent) | ~0.24 s | **0.99 s** |

Containment adds ~1 s per document and is what serializes: parented creates inflate from 1.25 s
to 3.5 s each under 4x concurrency (queueing), while bare creates parallelise. 4 sequential
parented creates = 5.02 s.

### E3 — Containment batches, and placement survives

4 × `ADD_FILE` in a single dispatch against the drive: **1.414 s** (including ~0.5 s CLI spawn).
All four verified landed in `/knowledge/notes/` with correct names and `parentFolder`.

So: **4 bare parallel creates (0.99 s) + 1 batched ADD_FILE (1.41 s) ≈ 2.4 s vs 5.02 s
sequential — 2.1x**, and the ADD_FILE term is near-flat in N, so the margin widens with batch size.

Note the contrast with the CLI: `docs create --parent-folder <uuid>` has been observed to time
out, land the document anyway, and leave it at drive root — while a direct `ADD_FILE` carrying
`parentFolder` places correctly. The defect is in the CLI's create path, not in `ADD_FILE`.

### E6 — Why creation is slow: two serial jobs, one global executor, and an O(N^2) snapshot

Mechanism, recovered from the shipped sourcemaps (`@powerhousedao/reactor`,
`@powerhousedao/shared`, `@powerhousedao/switchboard`):

- **`DriveClient.addFile` is two awaited job batches plus a read**
  (`reactor` src `src/client/drive-client.ts:84-188`). Job 1 on the *new* document
  (`CREATE_DOCUMENT` + `UPGRADE_DOCUMENT` + `ADD_RELATIONSHIP(drive->doc)`, scope `document`),
  job 2 on the *drive* (`ADD_FILE`, scope `global`), then `client.get(documentId)`. The split is
  deliberate — the source comment notes that batching them would add a file node on top of a
  create that never landed. Both are awaited to `READ_READY`, i.e. including read-model indexing.

- **The reactor runs one job at a time, globally.** `executorStartCount = maxConcurrency ?? 1`
  (`reactor` src `src/core/reactor-builder.ts:710`), and Switchboard leaves the worker pool off:
  `numWorkers = REACTOR_WORKERS ?? 0`, and `0` disables it
  (`@powerhousedao/switchboard/dist/server-CiKkVE6g.mjs:639-643`). Nothing calls
  `withExecutorConfig({maxConcurrency})`. **This explains E2's parallel numbers**: 4 "parallel"
  bare creates took 0.99 s wall because they executed serially, and parented ones inflated to
  ~3.5 s each purely from queue wait.

- **Each `ADD_FILE` rewrites the whole drive snapshot.** Every operation stores
  `resultingState = JSON.stringify(<entire scope state>)`
  (`src/executor/simple-job-executor.ts:905`), and `DocumentView.commitOperations`
  (`src/read-models/document-view.ts:74-300`) parses it and persists the whole blob. For a drive
  with N nodes, one `ADD_FILE` re-serialises, re-parses and re-persists **all N nodes**. Creating
  N documents into one drive is therefore **O(N^2) JSON** — and this vault has 1489 nodes, which
  is why the create floor grew with the vault.

- **`ADD_FILE` is safely batchable.** `canBatch` (`src/executor/simple-job-executor.ts:1091-1114`)
  admits global-scope, non-document, `skip === 0` writes; `executeRegularActionsBatched`
  (`:1130-1173`) threads state in memory so cross-batch name-collision resolution still works;
  `commitPreparedWrites` (`:936-960`) commits all N in **one** store transaction. Job 1's actions
  are *not* batchable — `canBatch` excludes `scope === "document"`.

- **`waitForJob` has no polling and no artificial floor** (`src/shared/awaiter.ts:100-137`): one
  status read then an event-bus promise. The latency is genuine server work.

- **No bulk create exists.** No `createDocuments` / `bulkCreate` / `addFiles` anywhere in
  `@powerhousedao/{reactor,reactor-api,shared}`; the only plural mutation is `deleteDocuments`.
  `IReactorClient.executeBatch` (N jobs with a `dependsOn` DAG) exists **in-process only** and is
  not exposed over GraphQL. `validateBatchRequest` does not forbid several jobs targeting the same
  document, so an "N creates + 1 drive job" batch is representable today.

**Consequence for Task 4:** batching containment collapses N full-drive snapshot rewrites into
one. That is the dominant term, not the round trips.

### E7 — The orphan is caused by the create timing out, not by `--parent-folder`

Reproduced unprompted on 2026-09-14 while verifying Task 3. `switchboard docs create` printed
`Failed to connect ... operation timed out` — and the document **existed anyway**, at drive root
with `parentFolder: None`. An immediate retry with the *same* `--parent-folder` argument succeeded
and placed correctly in `/knowledge/notes/`.

So the earlier characterisation ("`--parent-folder` is ignored") was wrong. The correct one:
**the create and its containment are two jobs (E6); when the client times out between them, the
document survives and the containment is lost.** The CLI then reports the whole thing as a
failure. Two defects in one: a false failure report, and a silently orphaned document.

Practical consequence: **a timed-out create must be treated as "may have succeeded" and the drive
re-read**, never as a no-op to retry blindly. A blind retry produces a second document — observed:
the retry was auto-renamed `zz-verify-readback (copy) 1` by the drive's name-collision resolver,
leaving two orphans.

### E4 — GraphQL's cost is fixed per-request overhead, not query work

| probe | median | isolates |
|---|---|---|
| `{ __typename }` (no drive guard) | **2.8 ms** | parse + validate + transport |
| `knowledgeGraphNodeByDocumentId` (1 graph query) | **290 ms** | + `withDriveGuards` |
| `knowledgeGraphStats` (4 graph queries) | **306 ms** | 4 queries cost +16 ms |
| 3 aliases (node + forward + backlinks) | **360 ms** | aliases add sub-linearly |
| REST `notes/:id` (same three reads) | **13.4 ms** | no drive resolution |
| REST `stats` | **22.2 ms** | — |

GraphQL parsing is free (2.8 ms) and the graph SQL is ~4 ms per query. **~285 ms of fixed
per-request overhead is the entire problem**, paid by every `knowledgeGraph*` query.

Source of the overhead (`subgraphs/knowledge-graph/resolvers.ts:78-113` → `helpers/db.ts:66-81`):
`withDriveGuards` calls `resolveCanonicalDriveId`, whose line 71 is
`await subgraph.reactorClient.get(driveId)` — **fetching and JSON-parsing the entire drive
document**, whose `global` snapshot is the full 1489-node list. Plus `assertCanRead`, which under
the live `DOCUMENT_PERMISSIONS_ENABLED=true` / `DEFAULT_PROTECTION=true` config walks the
ancestor/protection/grant chain (~4-5 more round trips), unmemoized.

REST avoids all of it: the handlers take `?drive=` as a UUID and never resolve the drive.

### E5 — Secondary defects found while mapping the resolvers

- **N+1 field resolvers.** `topics`, `inDegree`, `outDegree` on `KnowledgeGraphNode`
  (`resolvers.ts:117-143`) each issue one query *per row*. `knowledgeGraphNodes { topics inDegree
  outDegree }` on a 500-node vault = 1 + 1500 queries. The `if (parent.topics) return parent.topics`
  short-circuit at `:123` is dead — `rowToNode` (`query.ts:216-231`) never emits a `topics` key.
- **The embedding matrix cache never hits from a resolver.** `embedding-store.ts:135` keys a
  `WeakMap` on the db handle, but `getDb` returns a **new object literal every call**, so every
  `knowledgeGraphSemanticSearch` / `Similar` reloads and `JSON.parse`s the whole `note_embeddings`
  table. Only the processor (stable handle) gets the cache.
- **`knowledgeGraphUpsertEmbedding` is broken at runtime.** `resolvers.ts:158` passes `getDb(...)`
  to `upsertEmbedding`, which calls `db.insertInto(...)`. `getDb` returns the 5-method query
  builder (`selectFrom`, `selectNoFrom`, `with`, `withRecursive`, `withSchema`) — no `insertInto`.
  The `as unknown as Kysely<DB>` cast at `helpers/db.ts:20` hides this from the type checker.
- **No GraphQL mutation can write an articulated edge.** Upstream `addRelationship(
  sourceIdentifier, targetIdentifier, relationshipType, branch)` carries no metadata, there is no
  `updateRelationship` at all, and this package defines only `knowledgeGraphReindex` and
  `knowledgeGraphUpsertEmbedding`. `reason`/`confidence` are reachable only over REST.
- **`KnowledgeGraphEdge.linkType`** is the correct field name (`schema.ts:35-52`).
  `relationshipType` exists only as the upstream *mutation input* name — a genuine trap.

---

### E8 — Benchmark methodology: interleave, and use a contention control

Two measurement traps caught me during this work; both produced numbers I nearly reported.

1. **Back-to-back requests measure my own load, not the server.** Semantic search benchmarked
   back-to-back gives HYBRID median 45.7 ms with p75 156.4 ms. The same query issued 400 ms apart
   gives median **38.1 ms, p25 37.9, p75 39.1** — a flat distribution. The spikes were my harness
   saturating the single-threaded executor (E6).

2. **Sequential A-then-B attributes time-varying load to whichever ran while it was busy.**
   Measuring GraphQL then REST suggested REST had regressed to a 425 ms median against GraphQL's
   10 ms. Re-measured **interleaved**, the two are indistinguishable — gql 120.7 ms vs REST
   112.1 ms median, both min ~11 ms, both max ~700 ms. There was no REST regression; the server had
   simply become busy between the two runs.

**Therefore:** every latency claim in this plan is measured (a) with requests spaced, (b)
interleaved when comparing two surfaces, and (c) alongside `knowledgeGraphDensity` as a contention
control — it is a two-query resolver that sits at a flat ~3 ms when the server is quiet, so a
raised value invalidates the run.

The underlying cause is worth stating plainly: **the reactor is CPU-bound on a single JS thread,
so any background job blocks every read.** Spikes to 500-700 ms hit REST and GraphQL alike. This
cannot be fixed with concurrency settings (see Task 3b: PGlite is in-process WASM and the
worker pool is unavailable in dev mode) — only by doing less CPU work per operation, which makes
batching (Task 4c) the highest-value remaining item.

## Global constraints

- Local toolchain is **bun** (`bun install`, `bun run tsc|lint:fix|test|build`, `bunx`). Never
  `npm`/`pnpm` locally. Do not rewrite `node …` invocations inside `package.json` scripts.
- `module: nodenext`, `verbatimModuleSyntax`, `strict`: every relative import ends in `.js`;
  type-only imports use `import type`.
- **Subgraph changes reach the running Switchboard only after `bun run build` + a `ph vetra`
  restart.** Per CLAUDE.md, ask the owner to restart; do not run `ph vetra` unattended.
- Never edit `gen/` or the codegen-owned `subgraphs/index.ts` by hand.
- Reducer coverage floor stays 95%; new `subgraphs/**/lib/**` modules target 100% line/branch.
- Never commit tokens. The smoke uses `$TOKEN` from the environment.
- Every task that changes a route updates `docs/http-api.md` **in the same commit**.
- Clean up probe documents in the same session that creates them, and verify the drive node count
  returns to its starting value.

---

## Part A — Write-path correctness (blocks Part B)

### Task 1: Make the read-back scope-correct

**Files:** `subgraphs/http/lib/write.ts`, `subgraphs/http/lib/write.test.ts`

- [x] **Step 1: Failing tests first.** Add to `write.test.ts`:
  - a document whose `header.revision` is `{ document: 2 }` (no `global` key) dispatching a
    `global` action that lands at index 0 → the operation **must** appear in `operations[]`.
    This reproduces E1 and fails against current `main`.
  - a document with `{ global: 40, document: 3 }` writing `scope: "document"` → matched.
  - a read-back page that is full (`limit` reached) with the wanted action on page 2 → matched.

- [x] **Step 2: Compute `prior` per written scope.** Replace the `Math.min` scalar with the
  minimum over **only the scopes present in the stamped actions**, defaulting an absent scope to
  `0`:

  ```ts
  const scopes = new Set(stamped.map((a) => a.scope ?? "global"));
  const revision = options.document.header.revision ?? {};
  const prior = Math.min(...[...scopes].map((s) => revision[s] ?? 0));
  ```

  For a fresh note writing `global` this yields `0`, not `2`.

- [x] **Step 3: Follow the cursor.** Walk `nextCursor` (bounded, e.g. 5 pages) instead of reading
  a single 200-row page, so a document with a long tail still matches.

- [x] **Step 4: `bun run tsc && bun run test`.** All three new tests green.

### Task 2: Make the response honest when read-back cannot confirm

**Files:** `subgraphs/http/lib/write.ts`, `subgraphs/http/routes/actions.ts`,
`subgraphs/http/routes/relationships.ts`, their tests, `docs/http-api.md`

The write has already been dispatched and `waitForJob` returned success, so a `503` would be
wrong: it invites a retry that would re-apply non-idempotent actions. The response must instead
*say* that it could not verify.

- [x] **Step 1:** Add `readBack: "confirmed" | "unconfirmed"` to `WriteResult` and to the JSON
  body of `POST actions` and the relationship routes. Always present. `unconfirmed` iff
  `matched.length === 0` after the retries.
- [x] **Step 2:** Include `jobId` in the synchronous response too, so an unconfirmed caller can
  poll rather than re-dispatch.
- [x] **Step 3:** Keep the `console.warn`, and add the computed `prior` and the scope set to it.
- [x] **Step 4:** Replace the flat 5 × 200 ms loop with bounded exponential backoff
  (50/100/200/400/800 ms ≈ 1.55 s total) so the common case returns sooner than 200 ms.
- [x] **Step 5: Test the exhausted path explicitly** — the gap that let this ship: a fake whose
  `getOperations` never matches must yield HTTP 200 with `readBack: "unconfirmed"`, and must
  **not** be reported as a clean write.
- [x] **Step 6: Update `docs/http-api.md`.** The `POST actions` row currently promises
  `{ revision, operations: [...] }` unconditionally. Document `readBack`, document that
  `operations` may be empty when `unconfirmed`, and state that an unconfirmed write **has been
  dispatched** and must not be blindly retried.

### Task 3: Live verification of Part A

- [x] `bun run build`, ask the owner to restart `ph vetra`.
- [x] Recreate the E1 probe: create a note, write to it once. Assert `operations.length === 1`
      and `readBack === "confirmed"` **on the first write** — the case that fails today.
- [x] Confirm the first-write latency drops from ~2.8 s to the ~0.2 s of subsequent writes.
- [x] Delete probes; verify the drive node count is unchanged.

---

## Part B — Batch create

### Task 3b: ~~Measure `REACTOR_WORKERS`~~ — WITHDRAWN, not available in this runtime

**Withdrawn 2026-09-14 after review.** The earlier note ("this may be a configuration-only
speedup") was wrong for this deployment. Three findings, in order of decisiveness:

1. **`REACTOR_WORKERS` is a `worker_threads` pool, and the code refuses it twice for exactly this
   setup** (`@powerhousedao/switchboard/dist/server-CiKkVE6g.mjs:1191-1192`):
   - `"The executor worker pool (REACTOR_WORKERS) is not supported in dev mode: Vite-loaded
     document models cannot cross a worker-thread boundary"` — `ph vetra` **is** dev mode.
   - `"...requires a Postgres reactor database ... PGlite cannot be shared across worker threads"`.
2. **This reactor runs PGlite** — embedded Postgres compiled to WASM, in-process, 718 MB in
   `.ph/reactor-storage`. A query is therefore **CPU on the JS thread**, not network I/O parked in
   an event-loop wait.
3. **So `maxConcurrency > 1` buys little either.** Async concurrency pays only when jobs *wait* on
   work happening off-thread. Between in-process WASM Postgres and the full-scope
   `JSON.stringify` every operation performs (E6), the executor is CPU-bound, and interleaving
   CPU-bound tasks on one thread does not create parallelism.

**What actually reduces the 500-700 ms spikes,** given a CPU-bound single thread:

- [ ] **Do fewer operations against the drive — batch them (Task 4c).** E6: each `ADD_FILE`
      re-serialises and re-persists all 1489 drive nodes, so N creates cost O(N^2) JSON. E3: four
      `ADD_FILE`s in one dispatch took 1.41 s against 5.02 s sequential. Batching turns N
      whole-drive serialisations into one. **This is now the top remaining lever, not an
      ergonomics nicety.**
- [ ] **Reduce CPU per operation upstream.** `resultingState = JSON.stringify(<entire scope
      state>)` (`simple-job-executor.ts:905`) is the hot spot and it grows with the drive. Worth an
      upstream issue: an operation should not have to serialise the whole scope.
- [ ] **For production only:** real Postgres + non-dev mode unlocks the worker pool, at which point
      `REACTOR_WORKERS` becomes measurable. Irrelevant to `ph vetra`; note it in the deployment
      docs rather than chasing it here.

### Task 4: `resolveVaultFolder` — placement is the API's job, not the caller's

**Files:** new `subgraphs/http/lib/vault-folders.ts` + tests

**Owner directive (2026-09-14):** a caller must never have to know where a document lives. The
API places it. The *rule* is hardcoded; the folder **UUID is resolved from the drive tree at
request time** — ids differ per drive and this package serves several, so a literal UUID would be
a latent cross-drive corruption bug.

```ts
export const VAULT_FOLDERS: Record<string, string> = {
  "bai/source":             "/sources",
  "bai/knowledge-note":     "/knowledge/notes",
  "bai/moc":                "/knowledge",
  "bai/tension":            "/ops",
  "bai/observation":        "/ops",
  "powerhouse/scopeofwork": "/projects",
  "bai/wbs":                "/projects",
};
export async function resolveVaultFolder(
  deps: HttpRouteDeps, driveId: string, documentType: string, ctx: RouteContext,
): Promise<string>;  // folder UUID, or throws HttpError(400)
```

- [x] **Step 1:** Walk the drive's `nodes[]` to map path -> folder id (a node with no
      `documentType` is a folder; build the path from `parentFolder`).
- [x] **Step 2: Refuse rather than fall back.** Throw `400 FOLDER_UNRESOLVED` when the path is
      missing, resolves to a file, or would be the drive root. **Never default to root** — E7 shows
      that is precisely how a vault silently accumulates orphans.
- [x] **Step 3:** Unknown `documentType` -> `400`, listing the supported types.
- [x] **Step 4:** Tests: each mapped type resolves; a missing `/sources` folder 400s; a drive-root
      fallback is impossible; a duplicate folder name at different depths resolves by full path.

### Task 4b: `POST sources` — ingest a source with content alone

**Files:** new `subgraphs/http/routes/sources.ts` + tests, `subgraphs/http/index.ts`, `docs/http-api.md`

The whole `/seed` step as one call. **The caller supplies content; the API does everything else.**

```
POST sources
  body { drive, title, content, sourceType?, description?, author?, url?, publishedAt?, queue? }
  ->   { id, parentFolder, path, status, revision, operations, readBack, task? }
```

- [x] **Step 1:** `documentType` is fixed to `bai/source`; `parentFolder` is **not accepted** from
      the caller — it is `resolveVaultFolder(drive, "bai/source")` = `/sources`. Reject the field
      if supplied, so nobody can put a source somewhere else.
- [x] **Step 2:** Create the document, contain it in `/sources` via `ADD_FILE`, then dispatch
      `INGEST_SOURCE { title, content, sourceType, description?, author?, url?, publishedAt?,
      createdAt, createdBy }` through the existing `executeWrite` (so it gets lint, stamping,
      attribution and the Task 1/2 read-back for free).
- [x] **Step 3:** Default `sourceType` to `MANUAL_ENTRY`; validate against the enum
      (`ARTICLE`, `PAPER`, `BOOK_CHAPTER`, `TRANSCRIPT`, `DOCUMENTATION`, `CONVERSATION`,
      `WEB_PAGE`, `MANUAL_ENTRY`) — an invalid enum is silently dropped by the reducer, so this
      must be a 400, not a shrug.
- [x] **Step 4: `queue?: boolean`** (default `true`): set `SET_SOURCE_STATUS -> EXTRACTING` and
      `ADD_TASK { taskType: "claim", documentRef: <id> }` on the pipeline queue, matching what the
      app's *Queue for Processing* button does. **Generate a fresh task UUID and check for an
      existing task with the same `documentRef` first** — a duplicate task id is unrecoverable
      (there is no `REMOVE_TASK`).
- [x] **Step 5: Return the verified placement** (`parentFolder` + `path`) read back from the
      drive, not echoed from the request. If containment failed, report it — never return a bare id.
- [x] **Step 6:** Tests: content-only request lands in `/sources`; `parentFolder` in the body is
      rejected; bad `sourceType` 400s; `queue: false` adds no task; a missing `/sources` folder 400s
      and **creates nothing**.
- [x] **Step 7:** Register the route and add it to `docs/http-api.md`.

### Task 4c: `POST notes` — batch create for the extraction phase

**Files:** new `subgraphs/http/routes/create.ts` + tests, `subgraphs/http/index.ts`, `docs/http-api.md`

Same placement contract as Task 4b (`/knowledge/notes`, never caller-chosen), applied to N notes.
From E2/E3/E6 the route:

1. Authorizes `canWrite` on the **drive** and resolves the folder once via Task 4.
2. Creates N documents **bare** — no `parentIdentifier` (E2: ~0.24 s each vs ~1 s parented).
   **These will not parallelise** (Task 3b: one CPU-bound JS thread, PGlite in-process), so issue
   them sequentially and do not build concurrency machinery that cannot pay off. The saving here is
   per-document (0.24 s vs 1 s), not from overlap. This also explains E2 directly: four "parallel"
   bare creates took 0.99 s wall — 4 x 0.25 s serialised, not 4 in parallel.
3. Dispatches **one** action batch against the drive containing N `ADD_FILE` actions — E3 proves
   placement survives, and E6 shows this collapses N full-drive snapshot rewrites into one, which
   is the dominant saving.
4. Applies each note's `actions[]` via `executeWrite`. **Depends on Task 1**: these are
   first-global-scope writes, which before the fix always read back empty.

- [ ] **Step 1:** Body `{ drive, documentType?, notes: [{ name, actions? }] }` — no `parentFolder`.
      Cap N at 25; reject duplicate names in the request.
- [ ] **Step 2: Lint every note's actions up front and 400 before creating anything**, preserving
      the "a 400 means nothing was dispatched" guarantee. This is the property the CLI lacks.
- [ ] **Step 3:** Partial-failure semantics. Creation is not transactional: if containment fails
      after the documents are created, orphans exist at drive root — the E7 failure mode, now ours
      to own. Either roll back (delete the created ids) or report them explicitly as
      `orphaned: [...]` with their ids. **Decide and document — never report a partial create as
      success.**
- [ ] **Step 4:** Return per-note `{ id, name, parentFolder, readBack, operations }`, with
      placement read back from the drive.
- [ ] **Step 5:** Tests with fakes: happy path; lint failure creates nothing; ADD_FILE failure is
      reported; N=1 matches the old behaviour.
- [ ] **Step 6:** Register (mind route order) and document in `docs/http-api.md`.

### Task 5: Prove the speedup, and amend the spec

- [ ] Re-run the 3-note extraction harness (create 3 / populate 3×5 / link 2) against the new
      route and compare to the recorded baseline: CLI 18 018 ms, REST-hybrid 17 875 ms.
      Target: creation phase from ~12 s to ~2 s; total under 8 s.
- [ ] Record the numbers in this file under a "Results" heading. **Report honestly** — if the
      containment dispatch dominates at N=3, say so.
- [ ] Amend `docs/superpowers/specs/2026-09-13-http-surface-slice1-design.md` to note that the
      HTTP surface now owns creation, which the slice-1 spec explicitly deferred.

---

## Part C — GraphQL resolvers

### Task 6: Kill the per-request drive fetch (the 285 ms)

**Files:** `subgraphs/knowledge-graph/helpers/db.ts`, `resolvers.ts`, tests

- [x] ~~**Step 1: Skip resolution for a UUID.**~~ **Rejected on review.** A slug is not guaranteed
      to be non-UUID-shaped, and treating a UUID-shaped slug as canonical would resolve to a
      namespace that does not exist — the precise failure `resolveCanonicalDriveId` was written to
      prevent (`relation "<ns>.graph_nodes" does not exist`). Memoization (Step 2) delivers
      substantially the same win without trading correctness for it: the fetch happens once per
      identifier per minute instead of once per query.
- [x] **Step 2: Memoize identifier → canonical id** in a process-level `Map` (slug mappings are
      effectively immutable; add a bounded size).
- [x] **Step 3: Memoize the authorization decision per `(ctx, driveId)`** on the ctx WeakMap, the
      way reactor-api already memoizes canonical-id resolution. Per-request, so it cannot leak
      across identities.
- [x] **Step 4: Benchmark before/after** with the E4 harness. Target: `nodeByDocumentId` from
      290 ms to < 30 ms. **Verify authorization still refuses an unauthorized drive** — add a test
      that a caller without read access is still rejected after memoization.

### Task 7: Batch the `KnowledgeGraphNode` field resolvers

**Scoped down 2026-09-14 after checking real usage:** `inDegree` / `outDegree` are **selected
nowhere** in this repo — their N+1 is theoretical. `topics` **is** selected, by
`editors/knowledge-vault/hooks/use-graph-search.ts:76`, on a multi-row search, so it costs one
extra query per result on every search the app runs. Batch `topics`; leave the degree fields
alone (or batch them for free if the same mechanism covers all three).

- [ ] Batch the per-row `topics` resolver with a per-request DataLoader (by `documentId`), or
      return it from the base query via a join/aggregate.
- [ ] Remove or fix the dead `if (parent.topics)` short-circuit at `resolvers.ts:123`.
- [ ] Test: a 50-row search selecting `topics inDegree outDegree` issues O(1) extra queries, not 150.

### Task 8: Fix the embedding matrix cache (handle identity)

**Fixed at the other end (2026-09-14).** Rather than re-key the cache, `getDb` now returns a
**memoized handle** per `(relationalDb, namespace)`. The `WeakMap` in
`embedding-store.ts:135` is then correct as written, and so is any other cache keyed on handle
identity — the bug was never the cache, it was that `RelationalDbProcessor.query` mints a fresh
object literal per call, so a subgraph could never hit it.

The invalidation probe was verified before making the cache live: `loadMatrix` still runs a
`COUNT(*) + MAX(updated_at)` on every call and reuses the matrix only when **both** match, so a
new, changed or removed embedding forces a reload. Making the cache work therefore cannot serve
stale search results.

- [x] Memoize the handle so subgraph callers hit the existing cache.
- [x] Test that two successive `getDb` calls return the identical object, that each drive gets its
      own handle, and that two relational dbs never share one.
- [x] Re-measure `knowledgeGraphSemanticSearch`. **Partial win, measured honestly:**

  | | before | after |
  |---|---|---|
  | floor (min over 30 runs) | 112 ms | **20-24 ms** |
  | `SEMANTIC` median | - | **43 ms** |
  | `HYBRID` median | 250 ms | **180 ms** |

  The ~5x drop in the *floor* is the matrix reload disappearing — that is the cache fix working.
  But `HYBRID`'s median only fell 28%, because the reload was never its dominant cost. The mode
  comparison isolates what is: `SEMANTIC` (43 ms) issues one `nodeByDocumentId` per hit;
  `HYBRID` (180 ms) adds the keyword leg plus up to `limit*2` = 12 more per-hit lookups. **That is
  Task 7's N+1, and Task 7 is now the critical path for search latency, not the embedding store.**

  Measured with the server settled — `knowledgeGraphDensity` flat at 3.0 ms and
  `nodeByDocumentId` tight at 8-15 ms, so these are real costs rather than the executor
  contention that polluted the earlier run.

- [x] **Done in Task 7:** `nodesByDocumentIds` batches the per-hit lookups in both
      `searchWithEmbedding` (SEMANTIC) and `hybridSearch` into one `WHERE document_id IN (...)`.
      With both fixes, and measured spaced: **HYBRID 250 ms -> 39.7 ms, SEMANTIC 22.3 ms.**

### Task 9: ~~Fix~~ REMOVE `knowledgeGraphUpsertEmbedding`

Reproduced live: the mutation failed with `db.insertInto is not a function`.
`getDb` returns the read-only query builder (`selectFrom`, `selectNoFrom`,
`with`, `withRecursive`, `withSchema`) but was cast `as unknown as Kysely<DB>`,
so passing it to `upsertEmbedding` — which calls `db.insertInto(...)` —
type-checked and then threw at runtime.

**Owner decision (2026-09-14): delete it rather than fix it.** The processor
self-embeds, so the client-push path is dead weight, and
`docs/superpowers/specs/2026-09-09-vault-authorization-design.md` had already
flagged it twice: as an attack vector ("permanently poison semantic search —
arbitrary vector stored with a hash that makes the staleness gate agree, so it
is never re-embedded") and as a candidate for deletion.

- [x] Remove the mutation and `UpsertEmbeddingResult` from `schema.ts`, the
      resolver, and its `PRIVILEGED_RESOLVERS` entry.
- [x] Delete `scripts/drive-sync/embed-backfill.mjs`, whose only purpose was
      calling it, and update `scripts/drive-sync/README.md` to describe the
      server-side path instead.
- [x] Keep `upsertEmbedding` / `sha256Hex` — the processor uses both
      (`processors/graph-indexer/index.ts:229-235`). Only the GraphQL surface goes.
- [x] **Narrow the types so this class of bug cannot recur.** `getDb` now
      returns `NamespacedReadDb` and the embedding store separates its read
      surface (`selectFrom`) from its write surface (`insertInto`/`deleteFrom`),
      so a read handle on a write path is a compile error. This immediately
      caught two further call sites passing read handles into write-typed
      functions (`subgraphs/http/live-deps.ts:32`,
      `subgraphs/knowledge-graph/resolvers.ts:427`) — both harmless in practice,
      both lying in their types.
- [x] Add `tests/processor/embedding-store.test.ts`; the store had no tests.

### Task 10: A GraphQL mutation that can write an articulated edge

- [ ] Add `knowledgeGraphAddRelationship(driveId, source, target, linkType, reason, confidence)`
      and an update/remove counterpart, mirroring `subgraphs/http/routes/relationships.ts`:
      the same `checkArticulation` gate and the same `executeWrite` path, so REST and GraphQL
      cannot drift.
- [ ] Name the argument `linkType` to match `KnowledgeGraphEdge.linkType`, and document in
      `schema.ts` that upstream's `addRelationship.relationshipType` is a different, metadata-less
      mutation.
- [ ] Tests: a bare knowledge edge is refused; `CORE_IDEA`/`CHILD_MOC` are allowed bare; a
      reason that merely restates the type is refused.

---

## Part D — Documentation and upstream

### Task 11: Correct the docs

- [ ] `docs/http-api.md` — the `operations[]` contract (Task 2) and the new create route (Task 4).
      Re-verify the `"public"` grep invariant.
- [ ] Add a short "Field-name traps" note where the graph API is documented: the edge field is
      **`linkType`**; `relationshipType` is only the upstream mutation's argument name.

### Task 12: Upstream bug entries — DONE (`docs/upstream-bugs-6.2.3-dev.4.md`)

**File:** new `docs/upstream-bugs-6.2.3-dev.4.md`, following the format of
`docs/upstream-bugs-6.2.2-dev.85.md` (symptom → repro → root cause with source citation → impact).

Each entry must be **re-verified against a clean probe before it is written down** — the existing
document's standard. Candidates, all observed on `6.2.3-dev.4`:

- [x] **`docs apply` reports a partially-rejected batch as success.** `status: READ_READY,
      error: null` while an over-length description was dropped and the surrounding actions
      applied. Job status does not reflect per-action errors.
- [x] **`docs create` can report a connection timeout on a create that succeeded** — and leave the
      document at drive root with `--parent-folder` ignored. Contrast with E3, where a direct
      batched `ADD_FILE` places correctly.
- [x] **`addRelationship` cannot carry metadata**, and there is no `updateRelationship`. Feature
      gap: the GraphQL surface cannot express an articulated edge.
- [x] **Slug resolution is inconsistent across CLI verbs:** `docs create --drive powerhouse-knowledge`
      resolves the slug; `docs tree powerhouse-knowledge` fails with `Document not found`.

### Task 13: Close-out

- [ ] `bun run tsc && bun run test:coverage && bun run lint:fix && bun run build`.
- [ ] Full live smoke of every route in `docs/http-api.md`.
- [ ] Record final before/after numbers in the Results section.
- [ ] Verify the vault is left at its starting node count with no `zz-*` residue.

---

## Results

_(filled in by Tasks 3, 5, 6, 8)_

**Tasks 3, 4, 4b and 6 verified live 2026-09-14.** Two caveats recorded honestly:

1. **Latencies are bimodal under background load.** `nodeByDocumentId` measured p25 12.4 ms /
   p75 21.2 ms when quiet, but spikes to ~120-200 ms while read models are catching up (e.g. right
   after deletes). `knowledgeGraphDensity` stays a flat 3.0 ms throughout, so this is contention on
   the single-threaded executor (E6), not resolver cost. Medians below are from a settled server.
2. **The first request after a Switchboard restart took 60 s** and my client gave up on it — the
   server-side handler completed correctly (document created, `INGEST_SOURCE` applied, task
   queued). Cold-start cost, not a route defect, but it means any smoke test must warm the server
   first or use a generous timeout.

**Task 3 verified live 2026-09-14** against the restarted Switchboard, drive `cf9b51d2-…`.
Probes created in `/knowledge/notes/`, deleted afterwards; vault confirmed back at 1489 nodes
with 0 documents at drive root.

| Metric | Before | After | Target |
|---|---|---|---|
| First write to a new note — `operations[]` | `[]` (wrong) | **1, `confirmed`** ✅ | 1, `confirmed` |
| First write to a new note — latency | 2.83 s | **0.40 s** ✅ | ~0.2 s |
| Relationship write (document scope) | not covered | **`confirmed`, 0.72 s** ✅ | confirmed |
| Bare `BUILDS_ON` refused | 400 | **400 `LINT_CONVENTION`** ✅ | 400 |
| Create 3 notes (extraction phase) | 12 223 ms | | < 3 000 ms |
| 3-note extraction, end to end | 17 875 ms | | < 8 000 ms |
| `knowledgeGraphNodeByDocumentId` | 290 ms | **10.2 ms** ✅ | < 30 ms |
| `knowledgeGraphStats` | 306 ms | **21.1 ms** ✅ | < 40 ms |
| 3-alias node + edges | 360 ms | **12.0 ms** ✅ | < 40 ms |
| `POST sources` warm, `queue: false` | route did not exist | **0.78–1.40 s** ✅ | — |
| `POST sources` warm, `queue: true` | route did not exist | **1.44 s** ✅ | — |
| `knowledgeGraphSemanticSearch` HYBRID | 250 ms | **39.7 ms** ✅ | < 60 ms |
| `knowledgeGraphSemanticSearch` SEMANTIC | — | **22.3 ms** ✅ | < 60 ms |
| semantic search floor (min) | 112 ms | **20 ms** ✅ | — |
