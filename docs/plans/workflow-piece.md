# The Knowledge Vault as a workflow piece — what can be implemented

**Date:** 25 September 2026 · **Stack read:** `6.2.3-dev.24` (`@powerhousedao/pieces-framework`,
`reactor-workflow`, `workflow` as installed in this repo) · **Vault:** `@powerhousedao/knowledge-note`
`1.0.54-dev.17`

**Sources:** the `reactor-workflow` repo (the paperless-ngx and docling pieces, `plan/`, `demo/`), the
academy guide *Building a piece*, this repo's `subgraphs/` (REST, GraphQL, convert, access),
`processors/graph-indexer/` and `docs/plans/http-surface.md`. Engine facts come from the original
TypeScript in the installed packages' source maps; paths written `src/…` below are paths inside those
maps.

---

## Summary

**The vault can be a piece.** The design is a piece `@powerhousedao/piece-knowledge-vault`, shipped
from this package, that calls the vault's existing REST surface
(`<origin>/api/@powerhousedao/knowledge-note/*`) with a Renown bearer held in a workflow connection.
On the routes that exist today it can offer about fifteen actions: search, read, ingest a source,
create and link notes, claim a pipeline task, dispatch linted actions, and a raw API call. It can also
offer three polling triggers. A short list of vault-side changes (§8) makes the pipeline actions and
triggers complete and lossless.

Two facts decided the design:

1. **A third-party piece never gets the reactor.** `ctx.reactor` (`reactorOf(ctx)`) is served only to
   the piece whose package name is exactly `@powerhousedao/piece-reactor`
   (`src/pieces/engine/blocks.ts:485`, "Identity, not provenance"). A vault piece is a
   network client of the vault, like paperless and docling are of theirs. This also turns out to be
   the right boundary on its own merits: the graph index (semantic search, edges, stats) lives in the
   vault subgraph's relational tables, which `ctx.reactor` could not reach anyway.
2. **The generic reactor piece reaches vault documents, but it has no vault semantics.**
   `piece-reactor#document-find/get/create/dispatch` works on `bai/*` documents with no code from us.
   But it has no relationship actions, so it cannot link notes or add MoC membership. It cannot search.
   It skips the vault's lint and placement rules. Reading the code, its writes run as the Switchboard's
   own identity with no caller, so drive grants are not consulted either. The vault piece is what
   carries those guarantees into a workflow.

**Recommended first slice:** a connection (URL plus token), the actions `search`, `get-note`,
`ingest-source`, `create-note` and `link-notes`, and the demo workflow *paperless → convert → vault
source*. It needs no vault changes. §12 gives the full order.

---

## 1. What the workflow engine allows (facts that constrain the design)

| Fact (dev.24) | Where | Consequence for the vault piece |
|---|---|---|
| Only `@powerhousedao/piece-reactor` is served `ctx.reactor` | `src/pieces/engine/blocks.ts:485-489` | Talk to the vault over HTTP |
| Pieces run in a forked worker: `env: {}`, no `node_modules`, framework inlined at build | `worker/transport.ts`; `ph build` | No env vars and no host services; everything comes from the connection and props |
| Egress refuses private and loopback space unless `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES` lists it (renamed from the older unprefixed `WORKFLOW_EGRESS_ALLOW_ADDRESSES`) | `worker/egress.ts` | A hosted vault is fine. A vault on `localhost` needs `127.0.0.1/32,::1/128` |
| Connection check = `auth.validate({auth})`, then `auth.getConnectionIdentifier` (best-effort); a 30 s timeout | `src/pieces/activepieces/worker/entry.ts` (`authForValidate`); `src/reactor/service.ts` `checkConnection` | Implement both on the auth. The `piece.checkConnection` shims in paperless and docling are legacy; dev.24 does not call them |
| Secrets are refs (`secret://v1:…`) encrypted with AES-256-GCM; for `CUSTOM_AUTH` the host merges config and secrets into `{type, props}` | `src/reactor/secret-store.ts`, `engine/connections.ts` | The bearer token is a `PieceAuth.SecretText` prop |
| Step timeout defaults to 30 s (`step.timeoutSeconds` overrides); trigger hooks get 60 s | `PieceWorker` | `POST sources` with read-back, and above all `POST convert`, can exceed 30 s. Document per-step timeouts |
| No loop block exists: engine blocks are `core#branch`, `core#assert`, `core#schedule`, `core#webhook`, `core#manual` | `src/reactor/service.ts:2422+` | Actions must take **arrays** where a workflow needs "for each" (batch notes, one source per section) |
| Polling: default 60 s (`PH_WORKFLOWS_POLL_INTERVAL_MS`), floor 1 s, backoff `interval × 2^failures` capped at 30 min; cursor rewound on failure, so delivery is at least once | `src/reactor/schedule.ts:12`, `trigger-supervisor.ts` | Cursor in `context.store` (≤ 512 KB per value) plus `_dedupe_key` (30 s window) |
| Webhook triggers need `PUBLIC_URL`; signature headers arrive redacted and there is no raw body; a sweep with no payload runs every 15 min | `RW/README.md` "Known missing features" | HMAC-signed inbound webhooks (GitHub, Slack) cannot be verified inside a piece. See §10 |
| Files cross steps as refs: the host uploads what `ctx.files.write` stages into the reactor's attachment store; FILE props hydrate to bytes. Ceiling 8 MiB (`PH_WORKFLOWS_PIECE_MAX_FILE_BYTES`) | `context/files.ts`, `src/reactor/attachment-port.ts` | On the same Switchboard, a step's `attachment://` ref can be stored on a source (`ATTACH_ORIGINAL_FILE`) |
| No automatic step retries; `rerun` replays journaled outputs of the steps that succeeded. Policy retry, concurrency and idempotency fields are not enforced | grep over `reactor-workflow` | Non-idempotent writes are not re-sent behind our back. Idempotency is still worth having (§8, V8) |
| Workflow Studio is a drive app (`workflow-studio`) allowing only `powerhouse/workflow` and `powerhouse/connection`; workflows, triggers and connections are reactor-wide | `WF/dist/powerhouse.manifest.json` | The "workflow drive" is a separate drive, such as `Workflows`, that acts on vault drives. Connect needs `connect.app.workflowsEnabled` |
| Workflows are on when `PH_WORKFLOWS_ENABLED=1` or `workflows.enabled: true`; `@powerhousedao/workflow` is then added to the packages automatically | `SB src/workflow-runtime.mts` | Pieces in this package load wherever the package is installed and workflows are on |

---

## 2. What the vault exposes today

**REST** (`subgraphs/http`, documented in `docs/http-api.md`). Every route except `badge.svg` requires
a verified Renown bearer, and handlers check `canRead`, `canWrite` or `canManage` on the canonical id.
The write routes carry exactly the guarantees a piece wants to inherit:

- **Lint before dispatch.** A `400` (`LINT_REACTOR`, `LINT_CONVENTION`) means nothing was written. This
  covers enums, the 200-character description limit, literal `\n`, and the articulation rule on
  relationship reasons.
- **Placement is the API's job.** `POST sources` and `POST notes` resolve the folder from the document
  type (`lib/vault-folders.ts`) and verify containment by reading it back.
- **Rollback.** A failed create deletes what it made (`502 CREATE_FAILED` / `CONTAINMENT_FAILED`).
- **`readBack`** is `confirmed`, `unconfirmed` (dispatched: do **not** retry) or `skipped`, and comes
  with a `jobId`.
- **`POST sources`** does create, place, `INGEST_SOURCE`, `EXTRACTING` and an `ADD_TASK(claim)` with a
  fresh UUID after checking for an existing task on the same `documentRef` — the whole seed step in
  one call.

**GraphQL** (`/graphql/knowledgeGraph`, or the gateway). Thirty read queries guarded per drive
(`withDriveGuards`). Useful to a piece where REST has no route: `knowledgeGraphRecent(driveId, since)`
(read access), `knowledgeGraphNodesByType`, `knowledgeGraphNodesByStatus`.

**Convert** (`subgraphs/convert`, not in `http-api.md`). `POST convert?filename=` takes the raw file
bytes (30 MiB cap) and returns `sections[]` sized for sources, plus `markdown=1`, figures and OCR
details. It is a preview that writes nothing. The backend is `@powerhousedao/docling-service`
(docling.rs), not docling-serve.

**Gaps a piece runs into:**

| Gap | Where | Effect |
|---|---|---|
| No route lists the pipeline queue or advances, fails or blocks a task; only `POST tasks/:id/claim` exists | `routes/tasks.ts` | Pipeline actions need a workaround (§5) or new routes (V1) |
| `ASSIGN_TASK` checks only `assignedTo`, never `status` | `pipeline-queue/v2/src/reducers/queue-management.ts:59-71` | An automated claim can resurrect a DONE or BLOCKED task (`ADVANCE_PHASE` clears `assignedTo`) without fixing the counters. Must be fixed before claims are automated (V2) |
| `activity` is newest-N with no cursor, needs `canWrite`, and never records `bai/source`, `bai/pipeline-queue` or relationship operations | `processors/graph-indexer/query.ts:1039-1052` | Not usable as a lossless trigger feed (V3) |
| On a host that does not resolve caller identity (`AUTH_ENABLED` / `RESOLVE_CALLER_IDENTITY` off) `ctx.user` is empty, so every route calling `requireUser` answers 401 | `lib/authorize.ts` | The piece needs identity-resolving hosts. The connection check must say so plainly |
| The vault sends no outbound events | — | Webhook-strategy triggers are not possible yet (V6) |

---

## 3. How the piece reaches the vault — options

| Option | Works across Switchboards? | Vault semantics (lint, placement, links, search) | Access control | Verdict |
|---|---|---|---|---|
| **A. Vault piece over REST with a bearer** | Yes | Yes: every server-side check applies | Drive grants on the bearer's address; `canMutate` for lifecycle operations | **Recommended** |
| B. Only `piece-reactor` blocks (no code) | No: same reactor only | None: no links, no search, enums silently dropped, reducer errors surfaced as `Action X failed` | Switchboard identity, no caller | Keep for one job: its `document-event` trigger (§6) |
| C. Widen `ctx.reactor` to more pieces | Same reactor only | Still no graph index | Same as B | Rejected: an engine change against a stated design rule, and it buys nothing A lacks |

With option A, identity works like this. REST writes are **signed by the Switchboard's key**, but the
caller the permission checks and the operation log see is the bearer's address (`lib/write.ts`).
Give workflows a dedicated identity with `WRITE` on the vault drive, not a person's. Because
`APPROVE_NOTE` needs an actor other than the author, a workflow identity should never approve its own
notes.

---

## 4. The connection

```ts
PieceAuth.CustomAuth({
  displayName: "Knowledge Vault",
  description: "A Switchboard hosting a knowledge vault, and a bearer for an identity with access to it. …",
  props: {
    base_url: Property.ShortText({ displayName: "Switchboard URL", required: true }),  // origin only, no /graphql, no /api
    token:    PieceAuth.SecretText({ displayName: "Access token", required: true }),   // `ph access-token --expiry …`
  },
  validate, getConnectionIdentifier,
});
```

- **The drive is chosen per step, not per connection.** A `Property.Dropdown` is filled from
  `GET drives`, which returns only vault drives the bearer can read. One identity can then serve
  several vaults.
- **`validate`** calls `GET ping` and fails with a message the user can act on for each case:
  - `401 Credentials no longer valid`: "the token expired; mint a new one".
  - `user: null`: "this Switchboard does not resolve caller identity; vault writes need AUTH_ENABLED".
  - A network error: say whether the address is loopback, and so needs the egress allow-list.

  It then calls `GET drives` and fails when the identity can read no vault.
- **`getConnectionIdentifier`** returns something like `0x12…ab @ vault.example.com (2 vaults)`.
- **Normalise `base_url`** the way paperless does: refuse `/graphql` or `/api` suffixes, which are
  the most likely thing to be pasted.

**Token lifetime is the open problem.** A bearer passes only while the JWT `exp` holds **and** Renown
still has the credential for that DID and address (reactor-api `AuthService.verifyBearer` →
`verifyCredentialExists`, cached for 60 s). `ph access-token --expiry` sets the first. The plugin
docs say the Renown binding also lapses after 7 days — **to verify**. So a pasted token is a
connection that silently expires. Options:

| | How | Cost |
|---|---|---|
| a | Long `--expiry` token for a dedicated identity; the label shows the expiry | Nothing to build. Still bounded by the Renown credential |
| b | The connection stores a service keypair, and the piece mints a short-lived JWT per run (the JWT is self-signed; `@renown/sdk` gets inlined) | Small piece work. Still needs a live Renown credential for the DID |
| c | A vault-issued, drive-scoped API key (like slice 4's planned `x-vault-admin-key`), checked by the vault's routes | Vault work and a security review; no Renown dependency |

Start with (a), spike (b) and decide (c) together with slice 3's service-principal question (§10).

---

## 5. Actions

Block type `@powerhousedao/piece-knowledge-vault#<name>`. Names are permanent: renaming breaks every
workflow that uses them. Every action takes `drive` (dropdown) unless it is a raw call.
**Available** means it works on today's routes.

### Read — context for LLM steps and branches

| Action | Calls | Key props | Output (`outputSchema`) | Available |
|---|---|---|---|---|
| `search` | `GET search` | `query`, `limit` (≤ 25), `related` (0–50), `include_content`, `include_archived`, `format` json/markdown | `hits[]` (id, title, description, similarity, noteType, status), `related[]`, `links[]`, `markdown` | ✅ |
| `get-note` | `GET notes/:id` or `.md` | `document_id`, `format` | `{id, name, documentType, state, edges[]}` or markdown | ✅ |
| `get-related` | `GET notes/:id/similar`, `links`, `backlinks`, `connections` | `document_id`, `kind`, `limit` / `depth` | nodes or edges with reasons | ✅ |
| `get-health` | `GET health.json` | — | `overallStatus`, `checks[]`, `graphMetrics`, `recommendations[]`, `generatedAt` | ✅ |
| `get-stats` | `GET stats` | — | node, note, MoC, edge and tension counts, `articulatedEdgeCount` | ✅ |
| `export-context` | `GET llms-full.txt` | `include_drafts` | plain text of canonical notes and scope outlines | ✅ |

### Ingest

| Action | Calls | Key props | Output | Available |
|---|---|---|---|---|
| `ingest-source` | `POST sources` (then `POST actions` `ATTACH_ORIGINAL_FILE` when a ref is given) | `title`, `content`, `source_type` (dropdown from `SourceTypeSchema`), `url`, `author`, `published_at`, `method` (default `workflow`), `tool`, `queue` (default on), `folder_id`, `original_file_ref` (ShortText, so the ref passes through unhydrated) | `id`, `path`, `status`, `task {id, created}`, `readBack`, `operations[]` | ✅ (file ref: same Switchboard only, to verify) |
| `create-source-folder` | `POST sources/folders` (idempotent on name) | `name` | `{id, path, created}` | ✅ |
| `convert-file` | `POST convert?filename=` (raw body) | `file` (FILE prop), `ocr`, `figures`, `min_section_chars`, `include_markdown` | `sections[]`, `markdown`, `pages`, `quality`, `textSource` | ✅ (needs a long step timeout; 8 MiB piece ceiling vs the vault's 30 MiB) |
| `ingest-file` | `convert-file`, then `create-source-folder`, then one `POST sources` per section | as above, plus `source_type` and `queue` | `folder`, `sources[] {id, title, task}` | ✅ Composite, because the engine has no loop |

### Author — notes, links, observations

| Action | Calls | What it adds over raw actions | Available |
|---|---|---|---|
| `create-note` | `POST notes` (one note), then `POST relationships` per link, then `ADD_EXTRACTED_CLAIM` on the source | Typed props instead of action JSON: `title`, `description` (JS-length ≤ 200 checked before sending), `note_type` (the ten values), `content`, `topics[]`, provenance (`sourceOrigin` `DERIVED`/`IMPORT`), `derived_from` (source id) with `derived_reason`, `moc_id` (adds `CORE_IDEA`), `links[] {target, type, reason, confidence}`. Returns the id plus a per-link result | ✅ |
| `create-notes` | `POST notes` (≤ 25), then the same links | Takes a JSON array — including JSON buried in a model's prose, as the reactor piece learned to parse in the UMH demo — so an LLM step's output feeds it directly | ✅ |
| `link-notes`, `update-link`, `unlink-notes` | `POST`, `PATCH`, `DELETE relationships` | `type` dropdown from `KNOWLEDGE_LINK_TYPES`, `confidence` from `EDGE_CONFIDENCE`; the articulation check is server-side | ✅ |
| `create-observation` | `POST notes` with `documentType: "bai/observation"` (placed in `/ops`) + `CREATE_OBSERVATION` | `category` dropdown; lets workflows report friction and failures into the vault's own signal | ✅ |
| `review-note` | `POST actions`: `SUBMIT_FOR_REVIEW`, `APPROVE_NOTE`, `REJECT_NOTE`, `ARCHIVE_NOTE` | `actor` is the connection's address; the server checks `canMutate` and the author ≠ approver rule | ✅ |

### Pipeline queue

| Action | Calls | Available |
|---|---|---|
| `claim-task` | `POST tasks/:id/claim`; `409` → a typed "already claimed" error | ✅, but unsafe until V2 |
| `list-tasks` | Today: `GET notes/<driveId>?drive=` returns the drive state (the route reads any document), from which the queue node is found and its id cached in `store`; then `GET notes/<queueId>`. After V1: `GET tasks?drive=` | ✅ via workaround / V1 |
| `advance-task`, `fail-task`, `block-task` | Today: `POST actions` on the queue id found as above (`ADVANCE_PHASE` with a handoff, lint-checked). After V1: `POST tasks/:id/advance`, `…/fail`, `…/block` | ✅ via workaround / V1 |

The final `ADVANCE_PHASE` completes the task, so the piece must never follow it with `COMPLETE_TASK`.
Encode that in the action rather than documenting it.

### Escape hatches

| Action | Calls |
|---|---|
| `dispatch-actions` | `POST actions` with `allowed_actions` (a whitelist, as `piece-reactor#document-dispatch` offers) and `wait` |
| `custom-api-call` | `createCustomApiCallAction` from `pieces-framework/common` with the connection's bearer, as paperless ships |

**Errors.** Map the vault's codes to one error class with plain `category` and `retryable` fields; the
host copies enumerable fields across IPC, as `PaperlessApiError` does:

| Codes | Category | Retryable |
|---|---|---|
| `LINT_REACTOR`, `LINT_CONVENTION`, `BAD_REQUEST` | validation | no |
| `UNAUTHENTICATED` | credential | no |
| `FORBIDDEN` | permission | no |
| `NOT_FOUND` | not found | no |
| `CONFLICT` | conflict | no |
| `CREATE_FAILED`, `CONTAINMENT_FAILED` (rolled back) | server | yes |
| `Rollback INCOMPLETE` | server | no; carries `details[].orphaned` |
| `READ_BACK_INCOMPLETE`, `readBack: "unconfirmed"` | unconfirmed | **no**; carries `jobId` |

**Enums come from the vault's own code**, inlined at build so the dropdowns cannot drift:
`KNOWLEDGE_LINK_TYPES` (`processors/graph-indexer/link-types.ts`), `EDGE_CONFIDENCE`
(`subgraphs/http/lib/articulation.ts`), `SourceTypeSchema.options` (source zod), and the note types.

---

## 6. Triggers

| Trigger | Strategy | Source | Cursor and dedupe | Available |
|---|---|---|---|---|
| `new-pipeline-task` | POLLING | The queue's `tasks[]` (the §5 workaround, or V1). Props: `task_type`, `phase`, `only_unassigned` | Store the seen `(taskId, currentPhase)` pairs; `_dedupe_key = taskId:phase`. It also fires when a task advances into a phase that is PENDING and unassigned, so one workflow per phase works | ✅ via workaround / V1 |
| `note-changed` | POLLING | GraphQL `knowledgeGraphRecent(driveId, since)` (read access). Props: `document_type` (notes, MoCs, tensions, scopes), `status`, `note_type` | Cursor = max `updatedAt`; `_dedupe_key = documentId:updatedAt` | ✅ With caveats: newest-first with a limit, so a burst can drop items; edge changes do not bump `updatedAt`. V3 fixes both |
| `note-became-canonical`, `tension-opened` | POLLING | Presets of `note-changed` | Store the set of ids already emitted, so later edits do not re-fire | ✅ |
| `health-changed` | POLLING | `GET health.json` | Last `generatedAt` and `overallStatus`; fire on a new report or on a status change (prop) | ✅ |

**No "source queued" trigger is needed.** Sources are not indexed, but every queued source has a
claim task — both from the app's *Queue for Processing* and from `POST sources` — so
`new-pipeline-task` covers it.

**Zero-code, same-Switchboard alternative:** `@powerhousedao/piece-reactor#trigger:document-event`
with `documentType: bai/pipeline-queue` and `actionType: ADD_TASK`. The host fires it from the
operation stream instantly, and the payload carries `action.input` (task id and `documentRef`). There
are three caveats:
- **No drive filter.** Every vault on the reactor fires it.
- **Same Switchboard only.**
- **No loop guard.** A workflow that writes to what it listens to fires itself, so keep `actionType`
  narrow.

It pairs well with the vault piece's actions.

**Webhook triggers wait for V6.** The vault has nothing to register `context.webhookUrl` with.

---

## 7. Example workflows

All of these live in the workflow drive and act on a vault drive.

1. **Archive to source** (extends `reactor-workflow/demo`):
   1. `piece-paperless-ngx#trigger:new_document`
   2. `#get_document_file` (archive variant)
   3. `piece-knowledge-vault#convert-file` (or `piece-docling#convert_file`)
   4. `piece-knowledge-vault#ingest-source` with `content: {{steps.convert.output.markdown}}`,
      `source_type: DOCUMENTATION`, `url` pointing at the paperless document, and
      `original_file_ref: {{steps.file.output.ref}}`

   The source lands in `/sources` as `EXTRACTING` with a claim task, and the existing agent pipeline
   picks it up.
2. **Extraction in a workflow:**
   1. `#trigger:new-pipeline-task` (phase `create`)
   2. `#claim-task`
   3. `#get-note` on `{{trigger.payload.documentRef}}`
   4. An LLM step ("atomic claims as JSON")
   5. `#create-notes` (`derived_from` the source)
   6. `#advance-task` (create → reflect)

   Reflect, reweave and verify stay with the agent or a human. Workflows never approve their own
   notes, and `/health` reports whatever the automation leaves thin.
3. **Health watch:**
   1. `core#schedule` (daily)
   2. `#get-health`
   3. `core#branch` on the status
   4. `#create-observation` plus a notification piece
4. **Repository to source:**
   1. `core#webhook` (the token URL is the secret)
   2. `core#branch` on `pull_request.merged`
   3. `#ingest-source` (`title`, `body`, `html_url`, `user.login`)

   Caveat: the engine cannot verify GitHub's HMAC (signature headers are redacted, there is no raw
   body), and it rejects OAuth2, so the Activepieces GitHub piece's triggers are out.

---

## 8. Vault-side work that makes the piece complete

| # | Change | Why | Size |
|---|---|---|---|
| V1 | `GET tasks?drive=&status=&phase=`, `POST tasks/:id/advance \| fail \| block \| unblock` (find the queue by drive, as `claim` does) | Pipeline actions without two extra reads of the whole drive per call | S |
| V2 | `ASSIGN_TASK` rejects any status but `PENDING` (a new operation error, dispatched to the model via MCP **and** in `src/`, with tests ≥ 95%) | Automated claims must not resurrect finished tasks | S |
| V3 | A lossless change feed: `GET changes?drive=&after=<cursor>`, ascending, with an opaque cursor, covering source and queue operations. Also fix the `${documentId}-${index}` id, which collides across scopes | `note-changed` and task triggers without gaps | M |
| V4 | Long-lived service identity (§4, b or c) | Connections that do not silently expire | M, needs a decision |
| V5 | Document the `convert` routes in `http-api.md`; optionally let `POST convert` take an attachment ref instead of bytes | Files above the piece's 8 MiB ceiling; same-host conversion without a byte round trip | S/M |
| V6 | Outbound subscriptions (`POST subscriptions {drive, events, url}`, then deliveries) | Webhook-strategy triggers; only if cross-host latency matters | L |
| V7 | Say in the REST docs (and the rest-api skill) that identity resolution is required | The skill's "auth off → send no header" advice fails today | XS |
| V8 | Idempotency on `POST sources` (for example `idempotencyKey`, or dedupe on `url`) | A re-fired trigger or a manual re-run must not seed the same source twice | S |

---

## 9. Packaging in this repo

The piece talks HTTP, so it could live anywhere. Shipping it from this package keeps the enums and the
REST contract in one repo and one test suite, and needs no new publish pipeline. The cost: a
workflow-only Switchboard that installs it also gets the vault's models, processors and subgraphs. If
cross-host use grows, move it into a pieces-only package on the `reactor-workflow` template.

1. `bun add -D @powerhousedao/pieces-framework@6.2.3-dev.24 @powerhousedao/reactor-workflow@6.2.3-dev.24`,
   pinned to the stack; they publish in lockstep.
2. `bunx ph generate piece knowledge-vault --id @powerhousedao/piece-knowledge-vault --auth custom`.
   It writes `pieces/index.ts`, `pieces/knowledge-vault/{index.ts, lib/…}` and the manifest `pieces`
   entry. Then check it did not write a second lockfile (it syncs dependencies itself; which installer
   it uses is untested here).
3. Add `"./pieces"` and `"./pieces/*"` (`types` + `node`) to `package.json` `exports`. The generator
   does not; the host resolves `${pkg}/pieces` → `dist/node/pieces/index.mjs`.
4. `bun run build`. It emits `dist/node/pieces/knowledge-vault/index.mjs` with everything inlined, plus
   `descriptor.json`. Like subgraphs, a piece change is invisible until it is built. Piece code runs
   under node in the worker, so no `Bun.*` APIs.
5. Local run: set `"workflows": { "enabled": true }` (or `PH_WORKFLOWS_ENABLED=1`) and
   `connect.app.workflowsEnabled`, then run
   `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES=127.0.0.1/32,::1/128 bun run vetra`. Expect
   `Holding N package piece(s)` in the log. **Verify first:** that `ph vetra` loads the pieces of the
   project it runs in, not only those of packages in `packages`.
6. Add `pieces/**/lib/**` to `vitest.config.ts` coverage `include`. Today it covers only reducers and
   `subgraphs/*/lib`.

---

## 10. Testing

- **Unit tests against the real handlers.** The REST routes are Fetch handlers built from injected
  deps (`createSearchRoute(deps)`, `createIngestSourceRoute(deps)`, …). Mount them behind a small node
  server with fake deps, and the piece is tested against the vault's actual request handling rather
  than a hand-written mock that can drift.
- **Conformance,** as `piece-paperless-ngx/test/conformance.test.ts` does, from
  `@powerhousedao/reactor-workflow/testing`:
  - `PieceRegistry` over the built list
  - `loadPieceFromDir`, where `constructor.name` must survive the build
  - `buildDescriptor`, asserting the full list of action and trigger names
  - `PieceWorker.runAction` against the mock inside a real fork

  There is no single conformance function in dev.24; these are the parts.
- **Live e2e,** skipped unless an environment variable is set: `ph vetra`, a scratch vault drive, and
  the example workflow 1 chain.

---

## 11. What this means for `http-surface.md` slices 3 and 4

**Slice 3's allow-list is already a piece's action list.** Its triggers — `ingest-source`,
`queue-task`, `create-observation`, `advance-phase`, and later deliverable status — are the actions
in §5. The workflow engine already provides what slice 3 planned to build:

- triggers from any piece
- connections with encrypted secrets
- dedupe
- a run journal
- an operator UI (Workflow Studio instead of an Integrations screen)
- per-workflow enable and disable

What slice 3 alone can still do is **verify signed inbound webhooks** (GitHub, Slack), because the
engine redacts signature headers and has no raw body. **Recommendation:** re-scope slice 3 to exactly
that — a verified endpoint that hands the event to a workflow, or to the ingest-source operation —
and drop the rule and mapping language and the presets. Take the service-principal decision once,
for both (§4).

**Slice 4 (vault-native MCP) is unaffected.** It serves agents; the piece serves workflows. The two
share the REST semantics underneath.

---

## 12. Risks and open questions

- **Bypass through `piece-reactor`.** Anyone who can author a workflow can
  `document-dispatch` into vault documents under the Switchboard's identity — no drive grant, no
  vault lint — as far as the code shows. Document "vault writes go through the vault piece", and
  consider asking the engine team for a per-drive policy on the reactor port.
- **Token expiry** (§4) — the most likely production failure.
- **Automation can lower vault health.** The Definition of done (two typed links, MoC membership,
  lifecycle to CANONICAL) is not met by `create-notes` alone. That is acceptable if the health report
  says so honestly; it is not acceptable to auto-approve.
- **Timeouts.** Convert and large ingests exceed the 30 s default. Say so in each action's
  description, and set `timeoutSeconds` in the examples.
- **Files across hosts.** An `attachment://` ref is meaningful only on the Switchboard that minted it.
  Cross-host ingest needs bytes (convert) or V5.
- **Engine docs versus code.** The academy describes retry, concurrency and idempotency policy that
  dev.24 does not enforce, and the piece guide's boot line reads `Loaded … piece(s)` where the code
  logs `Holding …`. Design against the code.
- **Unverified here:**
  - the Renown credential lifetime
  - whether `ph vetra` loads the local project's pieces
  - whether a same-host workflow ref passes the source's `AttachmentRef` validation and is claimed by
    the reference read model
  - the installer `ph generate piece` uses

---

## 13. Suggested order

| Phase | Scope | Vault changes |
|---|---|---|
| 0 — spike (≈ 1 day) | Generate the piece; connection with `validate` and identifier; `search`; build; see the block in Studio; resolve the four unverified points in §12 | — |
| 1 — first slice | `get-note`, `ingest-source`, `create-source-folder`, `create-note`, `link-notes`, `dispatch-actions`, `custom-api-call`, `get-health`; client, errors, unit and conformance tests; example workflow 1 end to end | V7 |
| 2 — pipeline | `claim-task`, `list-tasks`, `advance-task`, `fail-task`, `block-task`; `new-pipeline-task`; example workflow 2 | V1, V2, V8 |
| 3 — breadth | `convert-file`, `ingest-file`, `create-notes`, `create-observation`, `review-note`, `get-related`, `get-stats`, `export-context`; `note-changed`, `health-changed` | V5 |
| 4 — hardening | Lossless triggers; service identity; re-scoped slice 3 | V3, V4 |
| Later | Webhook-strategy triggers; publish to the Vetra registries | V6 |
