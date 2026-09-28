# The Knowledge Vault piece — what to build

**Revised:** 28 September 2026 (first draft 25 September) · **Stack:** `6.2.3-dev.28` (upgraded from
dev.24 on 28 Sep; engine facts checked against the dev.26 source, and the dev.25–dev.28 changes against `main`) · **Vault:** `@powerhousedao/knowledge-note`
`1.0.54-dev.17`

**Sources:**
- Academy: *What are workflows?*, *Pieces and connections*, *Building a piece*, *Authoring
  workflows outside Connect*, *Receiving webhooks*, *Hosting HTTP routes*
- Engine source: `packages/reactor-workflow`, `packages/workflow` and `packages/pieces-framework`
  in the monorepo, plus the source maps of the installed dev.24 packages
- The `reactor-workflow` repo (the paperless-ngx and docling pieces)
- This repo's code: `subgraphs/http`, `subgraphs/convert`, `subgraphs/knowledge-graph` and
  `processors/graph-indexer`

Engine paths are cited as `RW/…` (`packages/reactor-workflow/src`), `WF/…` (`packages/workflow`) or
`RA/…` (`packages/reactor-api/src`).

**Scope.** This revision covers the vault piece itself: every action and trigger the vault's three
server surfaces can back, and the vault changes that close the gaps. Using it together with
Activepieces connectors (email, Google) is sketched in §13. That section will get its own design
once the piece exists.

---

## Summary

`@powerhousedao/piece-knowledge-vault` is shipped from this package. It is an HTTP client of the
vault's REST, convert and GraphQL surfaces, authenticated with a Renown bearer held in a workflow
connection.

On today's routes it can offer about **40 actions** in seven groups (read, graph, ingest, files,
author, pipeline, admin), plus two escape hatches and **six polling triggers**. Nine vault
changes (§10) close the remaining gaps. Only one of them is a bug that must be fixed before the
first slice ships: **V0**, where `POST sources` leaves an empty source behind when its content
fails lint.

**What changed since the first draft:**

| Topic | 25 Sep draft | Verified now |
|---|---|---|
| Inbound signed webhooks | "Cannot be verified in a piece" | `core#trigger:webhook` verifies `token`, `hmac`, `hmac-prefixed` and `hmac-timestamped`, with a dedupe field (`RW/reactor/webhook.ts:19-93`, enforced at `service.ts:1488-1512`). A *piece's* webhook trigger still cannot. The re-scope of slice 3 changes accordingly (§11) |
| Policy (retry, concurrency, idempotency) | Not enforced | Still not enforced in dev.26: `toWorkflowDefinition` copies only `timeoutSeconds` (`RW/…/lib.ts:295-331`). **The academy says otherwise; the code wins.** The piece must be idempotent itself |
| Boot log | `Holding …` | Both lines exist: reactor-api logs `Loaded N piece(s) from package …` and the runtime logs `Holding N package piece(s) …` |
| Files | "Ref as a ShortText prop" | Only FILE props hydrate. A FILE prop accepts a data URI, an http(s) URL, `attachment://`, or `{filename, base64}`, and ARRAY props hydrate FILE sub-props per row. A ShortText ref is just a string |
| Cross-host originals | "Same Switchboard only" | The piece can upload the bytes itself: `/attachments/reservations` on the vault's Switchboard is bearer-authenticated, then `ATTACH_ORIGINAL_FILE`. This works across hosts |
| Fan-out | "Actions take arrays" | Confirmed. Nothing fans out inside a run; only a trigger returning N items starts N runs. Expression paths index with `.0`, not `[0]` |
| `POST notes` | "Knowledge notes" | Also creates observations, tensions, MoCs, scopes and WBS, each placed in its folder by type |
| REST surface | about 12 routes | 30 routes, including `density`, `topics`, `orphans`, `triangles`, `graph.json`, `history`, `activity`, `bridges`, `access-map`, `admin/reindex` and three convert routes |
| Multi-auth | — | Rejected in dev.24; auth arrays run from dev.25, so on dev.28 Activepieces pieces that offer `[OAuth2, service account]` run with the service account. The vault piece still uses a single CustomAuth |
| Attachment downloads | Bearer + `GET /attachments/:hash` | From dev.26 (reactor #3109, #3112) bytes are served only through the read gate of a document that references them. Use `GET /attachments/:hash?documentId=<doc>` with the bearer, or `…/download-target?documentId=` for a signed URL (which still needs the bearer on a Switchboard with `REQUIRE_AUTHENTICATED_CALLER`). A bare GET is 404. Verified live on dev.28 |
| Paged results | `totalCount` | Removed in dev.26 (#3107): pages carry `hasNextPage` and `cursor` only |
| Local pieces | "To verify" | Switchboard adds `process.cwd()` to the packages (unless `--ignore-local`) and resolves `${pkg}/pieces` through `exports["./pieces"].node`. Only built entries load |
| Convert param | `min_section_chars` | `minSectionChars`. Convert also has `?job=` with a pollable `convert/progress/:job` route, and answers `503 CONVERT_BUSY` because it runs one conversion at a time |

---

## 1. Engine constraints the design follows

| Fact | Where | Consequence |
|---|---|---|
| `ctx.reactor` is served only to the package named `@powerhousedao/piece-reactor` | `RW/pieces/engine/blocks.ts:480-489` | The vault piece is an HTTP client |
| Auth: SECRET_TEXT, BASIC_AUTH and CUSTOM_AUTH run. OAuth2 and OIDC are rejected (issue #3091), as is CustomAuth with `refresh`. Auth arrays run only from dev.25 | `RW/pieces/activepieces/unsupported.ts:26-48`, `engine/connections.ts:122-160` | One `CustomAuth {base_url, token}`. CustomAuth props arrive as the stored **strings** |
| Action context: `propsValue`, `auth`, `store` (durable, FLOW or PROJECT scope), `files`, `run.id`, `step.name`. Accessing `server`, `connections`, `run.pause/respond`, `generateResumeUrl` or `agent` throws | `RW/pieces/activepieces/context/action.ts:154-194` | No human-in-the-loop pauses, no calls back into the host. All state lives in the vault or in `ctx.store` |
| Worker is forked with `env: {}` and no `node_modules`; the framework is inlined at build | `worker/transport.ts`, `ph build` | Enums and lint are inlined from this repo's code. No `Bun.*` |
| Egress: public hosts and all ports allowed; loopback, RFC1918, link-local and cloud metadata refused unless listed in `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES` (the only env var) | `RW/…/lib.ts:151-170`, `worker/egress.ts:15` | A local vault needs `127.0.0.1/32,::1/128` |
| Step timeout 30 s (per-step `timeoutSeconds`); trigger hooks 60 s, not configurable | `worker/host.ts:166`, `blocks.ts:621-623`, `trigger-supervisor.ts:223` | Convert and multi-file ingest document a timeout. Triggers keep each poll small |
| No policy enforcement: retry, concurrency, run timeout, idempotency key and park are dropped. Global run concurrency is `PH_WORKFLOWS_RUN_CONCURRENCY` (default 4) | `lib.ts:295-331`, `service.ts:2665-2672` | Nothing retries behind the piece's back, and nothing dedupes either. Idempotency is our job (§6) |
| Trigger items dedupe on `_dedupe_key` for 30 s; the polling cursor rewinds on failure (at-least-once) | `trigger-supervisor.ts:103,1045` | Cursor in `ctx.store` plus `_dedupe_key` on every item |
| Core blocks: `core#branch`, `core#assert`, `core#trigger:schedule`, `core#trigger:webhook`, `core#trigger:manual`. No loop, map, delay, code or http | `RW/reactor/core-catalog.ts:131-141` | Array-taking actions, composite actions, and triggers that emit one item per unit of work |
| Expressions are dot-path lookups with `||` fallback. `items[0]` is undefined; `items.0` works. An unresolved expression silently drops the prop | `pieces/engine/expressions.ts:16-23`, academy | Outputs are flat and named (`first_id`, `ids[]`, `count`) so authors rarely need to index |
| Files: `ctx.files.write` returns `apfile://`, which the host rewrites to an `attachment://` ref. Without a store it returns an inline `data:` URI. Trigger files are always inline. Ceiling 8 MiB (`PH_WORKFLOWS_PIECE_MAX_FILE_BYTES`). Returning an ApFile directly loses its bytes to `JSON.stringify` | `context/files.ts:77-131`, `limits.ts:136-177`, `worker/json-safe.ts` | Return refs or data URIs, never ApFile objects. Consume files through FILE props |
| A step may read an attachment only if the *workflow document* references it; no code records a step-written ref against the workflow | `RW/reactor/attachment-port.ts:74-86` | **Risk:** step A's ref may be refused when step B hydrates it. Test this in the spike (§12) |
| `core#trigger:webhook` payload is `{method, path, headers (redacted), queryParams, body}` with no raw body. It verifies `token` and the HMAC schemes and dedupes, when configured on the trigger | `service.ts:456-466,1488-1512` | Signed inbound webhooks (Mailgun, GitHub, Stripe-style) need no piece code |
| piece-reactor writes are unsigned and run as the host, with no drive-permission check at run time. `document-created` and `document-deleted` filter by `driveId`; `document-event` does not | `RW/reactor/reactor-port.ts:161-163,295-308`, `WF/pieces/reactor/triggers/*` | §12 bypass risk. `document-created` is a usable zero-code "new source" trigger on the same host |
| An Activepieces registry piece loads from the Powerhouse registry, then the AP CDN, then npm; dependencies are installed with `npm install`; `minimumSupportedRelease` is not checked | `RW/reactor/fetch.ts:13-14,164-169,408-435` | Relevant to §13, not to the vault piece |

---

## 2. What the vault exposes

Base: `<origin>/api/@powerhousedao/knowledge-note/`. Every route resolves the id to its canonical
form, then checks `canRead`, `canWrite` or `canManage`. Errors are `{error, code, details?}`.

| Group | Routes | Check |
|---|---|---|
| Identity | `GET ping` (`user` may be null), `GET drives` (vault drives the caller can read; first 100) | none / requireUser |
| Search | `GET search?q&mode=semantic&limit≤25&related≤50&content=1&includeArchived=1` (JSON, or a markdown digest with `Accept: text/markdown`) | read(drive) |
| Documents | `GET notes/:id` (any document, drives included: `{id,name,documentType,state,edges[]}`), `GET notes/:id.md` | read(id) |
| Graph | `notes/:id/similar?limit≤50`, `/links`, `/backlinks`, `/connections?depth≤4`; `stats`, `density`, `topics`, `topics/:name`, `orphans`, `triangles?limit≤100`, `graph.json`, `embeddings/missing` | read(drive) |
| Privileged reads | `notes/:id/history` (last 50), `activity?since&limit≤200`, `bridges` | write(drive) |
| Admin | `access-map`, `POST admin/reindex` | manage(drive) |
| Health | `health.json`, `badge.svg` (public), `llms.txt` (renown-optional), `llms-full.txt?includeDrafts=1` | read |
| Write | `POST actions {documentId, actions[], wait?, allowLiteralEscapes?}`; `POST notes {drive, documentType?, notes[≤25]}`; `POST sources`; `POST sources/folders` (idempotent on name); `POST`/`PATCH`/`DELETE relationships`; `POST tasks/:id/claim` | write |
| Convert | `POST convert?filename&ocr=1&figures=1&markdown=1&minSectionChars&job` (raw bytes, **30 MiB**, one file); `GET convert/progress/:job` (pollable, kept about 1 min after the job ends); `GET convert/health` | requireUser |
| GraphQL | 30 `knowledgeGraph*` queries plus `knowledgeGraphReindex`, guarded per drive; `History`, `Activity`, `ActivityByType`, `Bridges`, `Debug` and `Reindex` need write | read / write |
| Switchboard (not the vault) | `POST /attachments/reservations` (409 `already_exists` with the `ref` if the sha256 is known), `PUT /attachments/reservations/:id`, `HEAD /attachments/:hash`; reads through `GET /attachments/:hash?documentId=` (dev.26+: the document must reference the attachment and be readable by the caller) | bearer |

**Guarantees the piece inherits:**
- Lint before dispatch: enums, the 200-character description, literal `\n`, articulation, envelope.
- Placement by document type, verified by reading the drive back.
- Rollback on a failed create.
- `readBack` of `confirmed`, `unconfirmed` (do not retry; carries a `jobId`) or `skipped`.
- Per-action reducer errors in `operations[].error`. **A 200 can still carry a rejected action**,
  and the piece must surface it.

**Limits:**
- Request bodies: 2 MiB for `actions`, `notes` and `sources`; 1 MiB elsewhere; 30 MiB for convert.
- The piece's own file ceiling: 8 MiB.
- Convert sections cap at 40 000 characters, which keeps each section's `POST sources` well under
  2 MiB.

**Gaps a piece runs into:**
- **`POST sources`**
  - No idempotency.
  - No original-file input.
  - Lint runs after create (V0).
- **Tasks:** no route lists them or advances, fails or blocks them.
- **Sources are not indexed:** no search and no lookup by URL.
- **No lossless change feed:** `Recent` and `Activity` return the newest N first, cover no
  sources or queue, and have colliding operation ids.
- **No REST route deletes a document.**
- **Identity:** a host that does not resolve caller identity answers 401 on every
  `requireUser` route, and `ping` shows `user: null`.

---

## 3. Why a vault piece and not only piece-reactor

The academy's advice is that a piece should not write documents, and that authors should drop in
`piece-reactor#document-*` instead. For the vault that advice is wrong, and the piece exists
because of it. piece-reactor:
- **cannot link** (relationships are not document actions), **search**, or read the graph;
- **skips the vault's lint and placement**, so invalid enums and 201-character descriptions land
  as silent partial writes and documents land at the drive root;
- **writes as the host with no drive grant**, while the vault piece writes as a named identity
  that the vault's access list governs.

Keep piece-reactor for one job the vault piece cannot do: instant same-host triggers
(`document-created` with `driveId`, `document-event`).

---

## 4. Code layout

The layout follows the paperless piece:

```
pieces/
├── index.ts                       # PackagePiece list → dist/node/pieces/knowledge-vault/index.mjs
└── knowledge-vault/
    ├── index.ts                   # createPiece: auth, actions[], triggers[]
    └── lib/
        ├── auth.ts                # CustomAuth {base_url, token} + validate + getConnectionIdentifier
        ├── logo.ts
        ├── common/
        │   ├── auth-value.ts      # readAuth(): accepts both auth shapes
        │   ├── client.ts          # VaultClient: rest(), graphql(), convert(), attachments()
        │   ├── errors.ts          # VaultApiError {code, category, retryable, jobId?, orphaned?}
        │   ├── enums.ts           # re-exported from the vault's own code (inlined at build)
        │   ├── props.ts           # driveDropdown, noteTypeDropdown, linkTypeDropdown, …
        │   ├── normalize.ts       # ISO-Z dates, literal-escape detection, JS-length checks
        │   ├── lint.ts            # the server's lint (subgraphs/http/lib/lint), run before sending
        │   ├── files.ts           # FILE prop → bytes; sha256; data-URI / ref output
        │   ├── idempotency.ts     # ctx.store key → id memo (§6)
        │   └── output-schemas.ts
        ├── actions/*.ts           # one file per action (§5)
        └── triggers/*.ts          # one file per trigger (§7)
```

- **One client, three surfaces.**
  - `rest()` reads the error envelope and maps codes to `VaultApiError`.
  - `graphql()` posts to `<origin>/graphql` for the `knowledgeGraph*` reads that REST lacks.
  - `convert()` streams raw bytes and polls progress.
  - `attachments()` implements reserve → PUT.
- **Lint on the client too.** `subgraphs/http/lib/lint` is pure and depends only on the models'
  zod schemas, so the piece can import it and fail a step *before* the network call with the same
  findings the server would give. The server stays the authority. The cost is bundle size, which
  the spike measures.
- **Enums come from source:**
  - `KNOWLEDGE_LINK_TYPES` from `processors/graph-indexer/link-types.ts`
  - `EDGE_CONFIDENCE` from `subgraphs/http/lib/articulation.ts`
  - `SourceTypeSchema.options`
  - note types, observation categories, `TaskType`, `MocTier`

  Dropdowns therefore cannot drift from the models.

---

## 5. Actions

Block type `@powerhousedao/piece-knowledge-vault#<name>`. **Names are permanent.** Every action
takes `drive` (a dropdown from `GET drives`) unless marked otherwise.

In the "Status" column, ✅ means it works on today's routes, **W** means it works today through a
workaround, and **V#** names the vault change (§10) that makes it clean.

**Conventions for every action:**
- **Write actions:**
  - Take `wait` (default on).
  - Return `readBack`, `jobId` and `rejected[]`, the per-action reducer errors.
  - Fail the step when `rejected[]` is non-empty, unless `allow_partial` is set.
- **Outputs** are flat and named, and every action declares an `outputSchema`.
- **Descriptions** give the step timeout to set when the default 30 s is too short.
- **Destructive or lifecycle actions** say so in the description.

### 5.1 Read — context for LLM steps and branches

| Action | Calls | Key props → output | Status |
|---|---|---|---|
| `search` | `GET search` | `query`, `limit`, `related`, `include_content`, `include_archived`, `format` (json/markdown), `min_similarity` (filtered client-side), `exclude_mocs` → `hits[]`, `first_id`, `count`, `markdown` | ✅ |
| `get-document` | `GET notes/:id` | `document_id` → `id`, `name`, `documentType`, `state`, `edges[]`; plus flattened `title`, `description`, `content`, `status` for notes | ✅ |
| `get-document-markdown` | `GET notes/:id.md` | `document_id` → `markdown` (frontmatter plus body, for LLM prompts) | ✅ |
| `get-related` | `notes/:id/similar`, `links`, `backlinks`, `connections` | `document_id`, `kind`, `limit` / `depth` → `nodes[]` or `edges[]` with `reason` and `confidence` | ✅ |
| `find-nodes` | GraphQL `knowledgeGraphNodesByType` / `NodesByStatus` / `ByTopic` / `ByAuthor` / `ByOrigin` / `Stale` | `filter` (dropdown) and its value → `nodes[]` | ✅ |
| `export-context` | `GET llms.txt` / `llms-full.txt` | `full`, `include_drafts` → `text` | ✅ |
| `get-source` | `GET notes/:id` on a `bai/source` | → `status`, `extractedClaims[]`, `extractionStats`, `originalFile` | ✅ |
| `list-sources` | Today: `GET notes/<driveId>` (the drive state), filtered to `bai/source` nodes under `/sources`, optionally by folder. After V10: `GET sources?url=&status=` | `folder_id`, `name_contains` → `sources[] {id, name, parentFolder}` | W / V10 |

### 5.2 Graph and health

| Action | Calls | Output | Status |
|---|---|---|---|
| `get-stats` | `GET stats` + `density` | node, note, MoC, edge and tension counts; `articulatedEdgeCount`; density | ✅ |
| `get-health` | `GET health.json` | `overallStatus`, `checks[]`, `graphMetrics`, `recommendations[]`, `generatedAt` | ✅ |
| `list-orphans` | `GET orphans` | `nodes[]`, `count` | ✅ |
| `list-topics` | `GET topics` / `topics/:name` | `topics[] {name, noteCount}` or `nodes[]` | ✅ |
| `find-synthesis-opportunities` | `GET triangles` | `triangles[]` (A→B, B→C, no A–C) | ✅ |
| `get-history` | `GET notes/:id/history` (write grant) | `operations[]` with signer | ✅ |
| `get-activity` | `GET activity` (write grant) | `records[]` | ✅ |

### 5.3 Ingest

| Action | Calls | Key props → output | Status |
|---|---|---|---|
| `ingest-source` | `POST sources` | `title`, `content`, `source_type` (dropdown), `description`, `author`, `url`, `published_at` (normalized to ISO-Z; accepts RFC 2822 and date-only), `method` (default `workflow`), `tool`, `queue` (default on), `folder_id`, `dedupe_key` (§6) → `id`, `path`, `status`, `task {id, created}`, `readBack`, `deduped` | ✅ (V0 for safe lint, V8 for server dedupe) |
| `ingest-sources` | `POST sources` × N | `sources` (JSON array of the above; LLM or webhook output parsed tolerantly) → `ids[]`, `results[]` | ✅ |
| `create-source-folder` | `POST sources/folders` | `name` → `id`, `path`, `created` | ✅ |
| `convert-file` | `POST convert?job=<run-derived>`, polling `convert/progress` while waiting, retrying `503 CONVERT_BUSY` with backoff inside the step budget | `file` (FILE), `ocr` (`auto`/`on`/`off`; auto re-calls with `ocr=1` when `needsOcr`), `figures`, `min_section_chars`, `include_markdown` → `sections[]`, `markdown`, `pages`, `quality`, `textSource`, `figures[]` | ✅ (timeout ≥ 300 s; 8 MiB piece ceiling) |
| `ingest-file` | `convert-file` → `create-source-folder` (named after the file, or a given `folder_name`) → `ingest-source` per section → `upload-original` → `ATTACH_ORIGINAL_FILE` on each section's source | `file`, `source_type`, `queue`, `attach_original` (default on), `figures`, `dedupe_key` → `folder`, `sources[] {id, title, task}`, `original {ref, attached}` | ✅ Composite (V9 makes the attach part of the ingest) |
| `ingest-files` | `ingest-file` for each row | `files` (an ARRAY of FILE rows, for example every PDF on one email), `filter_extensions` (default `pdf`), `folder_name` (for example the email subject), shared metadata (`author`, `url`, `published_at`) → `folders[]`, `sources[]`, `skipped[] {filename, reason}` | ✅ (timeout scales with N; §8) |
| `ingest-web-page` | Egress `GET <url>` → convert (HTML) → `ingest-source`, `source_type: WEB_PAGE` | `url`, `dedupe_key` (default: the URL) | ✅ (convert handles HTML) |

### 5.4 Files

| Action | Calls | Output | Status |
|---|---|---|---|
| `upload-attachment` | sha256 → `POST /attachments/reservations` (409 `already_exists` → reuse its `ref`) → `PUT` | `file` → `ref`, `sha256`, `sizeBytes`, `mimeType`, `reused` | ✅ |
| `get-attachment` | `GET /attachments/:hash?documentId=` (dev.26+ read gate) → `ctx.files.write` | `document_id`, `ref` → `file` (a ref or data URI), `mimeType`, `fileName` — for example, to hand a source's original PDF to another piece | ✅ |
| `attach-original` | `POST actions` `ATTACH_ORIGINAL_FILE` (idempotent for the same ref) | `source_id`, `ref` or `file`, `converted_by` → `readBack` | ✅ |
| `add-source-attachment` | `POST actions` `ADD_ATTACHMENT` | `source_id`, `file`, `role`, `page`, `alt` → `attachment_id` | ✅ |

### 5.5 Author — notes, links, MoCs, observations

| Action | Calls | What it adds over raw actions | Status |
|---|---|---|---|
| `create-note` | `POST notes` → `POST relationships` per link → `ADD_EXTRACTED_CLAIM` on the source | Typed props: `title`, `description` (JS-length ≤ 200 checked before sending), `note_type`, `content`, `topics[]`, metadata fields, provenance (`DERIVED`/`IMPORT`/…), `derived_from` with `derived_reason` (the `DERIVED_FROM` edge), `moc_id` (`CORE_IDEA`), `links[] {target, type, reason, confidence}` → `id`, `links[] {target, ok, error}` | ✅ |
| `create-notes` | `POST notes` (≤ 25 per call, chunked) → links | `notes` as a JSON array, including one buried in an LLM's prose → `ids[]`, per-note results | ✅ |
| `update-note` | `POST actions` with typed `SET_*`, `ADD_TOPIC`/`REMOVE_TOPIC`, `SET_METADATA_*` | Only the fields given are sent | ✅ |
| `link-notes`, `update-link`, `unlink-notes` | `POST`, `PATCH`, `DELETE relationships` | `type` and `confidence` dropdowns; the articulation check runs on both client and server. A CONTRADICTS link returns the tension the indexer opens | ✅ |
| `add-to-moc` | `POST relationships` `CORE_IDEA` or `CHILD_MOC` | `moc_id`, `member_ids[]` | ✅ |
| `create-moc` | `POST notes` with `documentType: bai/moc` + `CREATE_MOC` | `title`, `description`, `orientation`, `tier`, `parent_id` (adds `CHILD_MOC`). Refuses when a MoC with the same title exists | ✅ |
| `create-observation` | `POST notes` with `documentType: bai/observation` + `CREATE_OBSERVATION` | `category` dropdown. This is how a workflow reports friction and failures into the vault's own signal (an `error`-port target) | ✅ |
| `submit-for-review` | `POST actions` `SUBMIT_FOR_REVIEW` | `actor` = the connection's address | ✅ |
| `review-note` | `POST actions` `APPROVE_NOTE`/`REJECT_NOTE` | Refuses to approve a note whose author is the connection's own address (the server also checks `canMutate`) | ✅ |
| `supersede-note` | `POST relationships` `SUPERSEDES` (new → old) + `ARCHIVE_NOTE` on the old note | The vault's "retire, don't delete" rule as one step | ✅ |
| `complete-extraction` | `POST actions` on the source: `RECORD_EXTRACTION_STATS` + `SET_SOURCE_STATUS EXTRACTED` | `claim_count`, `skipped_count` (skip rate computed) | ✅ |

### 5.6 Pipeline queue

| Action | Today | After V1 | Status |
|---|---|---|---|
| `list-tasks` | `GET notes/<driveId>` → find the `bai/pipeline-queue` node (id cached in `store`) → `GET notes/<queueId>`; filter by `status`, `phase`, `task_type` | `GET tasks?drive=&status=&phase=` | W / V1 |
| `claim-task` | `POST tasks/:id/claim`; `409` → a typed "already claimed" error | same | ✅ **but unsafe until V2** |
| `advance-task` | `POST actions` `ADVANCE_PHASE` with a handoff `{phase, work_done, files_modified}`. **Never** follows it with `COMPLETE_TASK`; the output says whether this advance completed the task | `POST tasks/:id/advance` | W / V1 |
| `fail-task`, `block-task`, `unblock-task` | `POST actions` on the queue | `POST tasks/:id/fail \| block \| unblock` | W / V1 |
| `queue-source` | `POST actions`: `SET_SOURCE_STATUS EXTRACTING` + `ADD_TASK claim` (fresh UUID, after checking for an existing task on the same `documentRef`) | `POST sources/:id/queue` | W / V1 |

### 5.7 Admin

| Action | Calls | Status |
|---|---|---|
| `reindex-drive` | `POST admin/reindex` (manage) | ✅ |
| `get-access-map` | `GET access-map` (manage) | ✅ |

### 5.8 Escape hatches

| Action | Calls |
|---|---|
| `dispatch-actions` | `POST actions` with a required `allowed_actions` whitelist (checked in the piece before sending) and `wait`, `allow_literal_escapes` |
| `graphql-query` | Any `knowledgeGraph*` **query** (mutations refused client-side), with `variables` |
| `custom-api-call` | Any vault REST path under the base, with the connection's bearer (written like paperless's own, not `createCustomApiCallAction`) |

### 5.9 Errors

There is one class, `VaultApiError`. Its fields are enumerable, so they survive IPC.

| Codes | `category` | `retryable` |
|---|---|---|
| `LINT_REACTOR`, `LINT_CONVENTION`, `BAD_REQUEST`, `UNKNOWN_FIELD`, `UNKNOWN_LINK_TYPE`, `UNSUPPORTED_DOCUMENT_TYPE`, `FOLDER_*`, `FILENAME_REQUIRED`, `EMPTY_BODY`, `INVALID_MIN_SECTION_CHARS`, host 413 | validation | no |
| `UNAUTHENTICATED` | credential | no ("mint a new token") |
| `FORBIDDEN` | permission | no ("ask for WRITE on the drive") |
| `NOT_FOUND`, `JOB_NOT_FOUND` | not found | no |
| `CONFLICT` | conflict | no |
| `CREATE_FAILED`, `CONTAINMENT_FAILED` (rolled back), `CONVERT_BUSY`, `CONVERT_UNAVAILABLE` | server | yes |
| `DISPATCH_FAILED`, `CONVERT_NOT_CONFIGURED`, rollback incomplete (`details[].orphaned`) | server | no |
| `READ_BACK_INCOMPLETE`, `readBack: "unconfirmed"` | unconfirmed | **no**; carries `jobId` |

---

## 6. Idempotency — the piece's job

The engine enforces no idempotency key, and `POST sources` has none, so a re-fired trigger or a
`rerun` seeds the same source twice. There are three layers, in order of strength:

1. **Server-side (V8):** `POST sources {idempotencyKey}`. The vault stores the key on the source
   (`provenance.method` is not enough) and answers `200 {deduped: true, id}` on a repeat. This is
   the only layer that works across workflows and hosts.
2. **Piece memo (today):** a `dedupe_key` prop (for example an email Message-ID, a Google Doc id, a
   URL, or a file's sha256). The key and the id it produced are kept in `ctx.store` at FLOW scope,
   with a bounded LRU because a value can hold at most 512 KB. A repeat returns the stored id with
   `deduped: true`. It covers reruns and trigger replays within one workflow.
3. **Structural (today):** `create-source-folder` is idempotent on name. `ingest-file` names the
   folder after the dedupe key, and skips sections when the folder already holds sources
   (`list-sources`). The attachment reservation's `409 already_exists` shows that the bytes were
   seen before, but not that a source exists.

---

## 7. Triggers

All triggers are POLLING. Each item carries `_dedupe_key`, and cursors live in `ctx.store`.
`onEnable` seeds the cursor so enabling does not replay history. `test` returns real samples from a
scratch store, and each trigger declares `sampleData`.

| Trigger | Source today | Cursor and dedupe | After |
|---|---|---|---|
| `new-pipeline-task` | Queue `tasks[]` via the §5.6 workaround. Props: `task_type`, `phase`, `only_unassigned` | The seen `(taskId, phase)` set; `_dedupe_key = taskId:phase`. Also fires when a task advances into a PENDING, unassigned phase, so one workflow per phase works | V1 (one call), V3 |
| `new-source` | Drive state: `bai/source` nodes under `/sources` (optionally one folder). Emits the source's state. Props: `status` (for example only `INBOX`, the app's "save without queueing") | The seen id set; `_dedupe_key = sourceId` | V3 |
| `note-changed` | GraphQL `knowledgeGraphRecent(driveId, since)`. Props: `document_type`, `status`, `note_type`, `topic` | Cursor is the max `updatedAt`; `_dedupe_key = documentId:updatedAt`. **Lossy under bursts** (newest N first); edge changes do not bump `updatedAt` | V3 |
| `note-became-canonical` | `note-changed` preset (`status = CANONICAL`) | The set of ids already emitted | V3 |
| `tension-opened` | `knowledgeGraphNodesByType("bai/tension")`, filtered to OPEN | The seen id set | V3 |
| `health-changed` | `GET health.json` | Last `generatedAt` and `overallStatus`; fires on a new report or only on a status change (prop) | — |

**Same-host alternative with no code:** `piece-reactor#trigger:document-created` with
`documentType: bai/source` and a `driveId` fires instantly from the operation stream. The vault
piece's actions then take `{{trigger.payload.documentId}}`.

**No webhook-strategy triggers.** The vault sends no outbound events (V6), and a piece's webhook
trigger cannot verify signatures anyway.

---

## 8. Files, sizes and timeouts

| Limit | Value | Handling |
|---|---|---|
| A file through a piece (hydrated input, or `ctx.files.write`) | 8 MiB (`PH_WORKFLOWS_PIECE_MAX_FILE_BYTES`) | Checked before convert, with a clear error naming the env var. V5 (convert by ref) lifts it on the same host |
| `POST convert` body | 30 MiB | Only reachable by a caller outside the piece |
| `POST sources`, `notes`, `actions` body | 2 MiB | Convert sections are ≤ 40 000 characters. `ingest-source` splits oversized content on headings |
| Step default | 30 s | Suggested `timeoutSeconds`: `convert-file` 300; `ingest-file` 600; `ingest-files` 600 plus 300 per file |
| Convert concurrency | 1 file at a time (`503 CONVERT_BUSY`) | Backoff within the step budget; `ingest-files` converts sequentially |
| Trigger hook | 60 s | Triggers do one bounded read per poll and emit; conversion never happens inside a trigger |

**Where files come from.** FILE props accept whatever an upstream step produces: an
`attachment://` ref (see the §1 risk), a data URI (what Activepieces triggers emit), an http(s) URL,
or `{filename, base64}` (for example a webhook body carrying base64 attachments).

**Where originals go.** The piece does not use the workflow's attachment ref. It uploads the bytes
to the **vault's** Switchboard through `/attachments/reservations`, so the original is stored where
the source lives, on any host.

**What `convert-file` returns.** It returns figures as `ctx.files.write` refs and never as
base64 in the output, which keeps the journal small.

---

## 9. The connection

```ts
PieceAuth.CustomAuth({
  displayName: "Knowledge Vault",
  description: "The Switchboard origin (https://host, no /graphql or /api) and a Renown bearer " +
    "(`ph access-token --expiry 90d`) for an identity with WRITE on the vault drive. " +
    "Use a dedicated workflow identity, not a person's.",
  props: {
    base_url: Property.ShortText({ displayName: "Switchboard URL", required: true }),
    token:    PieceAuth.SecretText({ displayName: "Access token", required: true }),
  },
  validate, getConnectionIdentifier,
});
```

The connection document holds `config.base_url`, and `secretRefs[{name: "token"}]` whose `name`
must equal the prop name. A mismatched name surfaces only as an auth failure.

**`validate`** fails with a message the user can act on:
- `base_url` ends in `/graphql` or `/api`: "use the origin only".
- A network error: say whether the host resolved to a loopback or private address, and so needs
  `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES`.
- `401` on `GET ping`: "the token expired or was revoked; mint a new one".
- `user: null`: "this Switchboard does not resolve caller identity; vault writes need it".
- `GET drives` returns nothing: "this identity can read no vault; ask for access".
- A check that the convert subgraph is present, run separately: `GET convert/health`. Report it
  in the label rather than failing, because convert is optional.

**`getConnectionIdentifier`** returns something like
`0x12…ab @ vault.example.com · 2 vaults · convert ready · token expires 2026-12-01`. The expiry is
read from the JWT `exp`.

**Token lifetime** is still the most likely production failure. A bearer passes only while its
`exp` holds *and* Renown still has the credential for the DID. Options, as in the first draft:
- (a) a long `--expiry` token for a dedicated identity, with the expiry shown in the label (start
  here);
- (b) a stored keypair from which the piece mints a short JWT per run (spike it);
- (c) a vault-issued, drive-scoped key (V4; decide together with slice 3).

---

## 10. Vault-side changes

| # | Change | Why | Size |
|---|---|---|---|
| **V0** ✅ done (`0c1d8ce5`) | `POST sources`: lint the `INGEST_SOURCE` payload **before** `createDocumentInDrive`, or roll back on a lint failure. Today `routes/sources.ts:118-184` creates and places the source, then `executeWrite` rejects it, for example a non-ISO `publishedAt` (`z.iso.datetime()`) or a literal `\n` in content, and the caller gets a 400 with an **empty source left in `/sources`**. Also accept `allowLiteralEscapes` | Correctness. A workflow feeding email dates or code-heavy transcripts will hit it daily | XS |
| V1 | `GET tasks?drive=&status=&phase=`; `POST tasks/:id/advance \| fail \| block \| unblock`; `POST sources/:id/queue` | Pipeline actions in one call, not two whole-drive reads | S |
| V2 | `ASSIGN_TASK` rejects a status other than `PENDING` (a new operation error: MCP **and** `src/`, tests ≥ 95%) | Automated claims must not resurrect DONE or BLOCKED tasks | S |
| V3 | A lossless change feed, `GET changes?drive=&after=<cursor>` (ascending, opaque cursor), covering sources, queue and relationship operations. Fix the `${documentId}-${index}` operation id that collides across scopes | Gap-free triggers | M |
| V4 | Long-lived service identity (§9, b or c) | Connections that do not expire silently | M, needs a decision |
| V5 | Document the convert routes in `http-api.md`; `POST convert` accepts `{ref}` of a stored attachment | Beats the 8 MiB piece ceiling on the same host; no double byte transfer | S/M |
| V6 | Outbound subscriptions (`POST subscriptions {drive, events, url}`) | Webhook-strategy triggers; only if polling latency matters | L |
| V7 | Docs: identity resolution is required, plus the §2 disagreements (`parentFolder` on sources is accepted; body caps; `llms.txt` is renown-optional; a mismatched signer is 403, not host-signed; relationship targets are not read-checked; search's `?format=md` hint is stale) | The rest-api skill's "auth off → send no header" advice fails | XS |
| V8 | `POST sources {idempotencyKey}`, stored on the source; a repeat returns `200 {deduped:true, id}`. The same for `POST notes` | Cross-workflow dedupe (§6) | S |
| V9 | `POST sources {original: {ref, fileName, mimeType, sizeBytes, convertedBy}}` dispatches `ATTACH_ORIGINAL_FILE` in the same write | One call instead of two, and one failure point | XS |
| V10 | `GET sources?drive=&url=&status=&folder=` from the drive tree plus source state (sources stay out of the graph index) | `list-sources` without the whole drive; dedupe by URL | S |
| V11 | Email-in endpoint owned by the vault (§13.2 C): a webhook family through reactor-api, 30 MiB cap, `token`/HMAC verification, Message-ID dedupe; raw MIME or Postmark JSON → body source plus converted attachment sources | Large or signed inbound email without a workflow's 1 MiB cap | M |

---

## 11. Consequences for `http-surface.md` slices 3 and 4

**Slice 3** planned rules, mappings, presets and an Integrations screen. The workflow engine already
provides all of that: triggers, encrypted connections, a run journal, Studio, and per-workflow
enable. `core#trigger:webhook` now also verifies HMAC signatures and dedupes deliveries.

What remains specific to the vault is small:
- a **vault-owned webhook family** (`this.http.webhooks.register` in a vault subgraph), only for
  senders whose scheme the core trigger does not cover (SendGrid's ECDSA, Pub/Sub OIDC JWTs), or
  when an event should become a source with no workflow at all;
- the **service-principal** decision (V4).

**Recommendation:** drop slice 3 as designed. Keep a small "verified inbound to source" endpoint as
an option for later.

**Slice 4** (vault-native MCP) is unaffected. It serves agents; the piece serves workflows. Both
sit on the same REST semantics.

---

## 12. Packaging, build and tests

**Packaging:**
1. `bun add -D @powerhousedao/pieces-framework@6.2.3-dev.24 @powerhousedao/reactor-workflow@6.2.3-dev.24`,
   pinned to the stack. Add `@powerhousedao/workflow` as well if local runs need the workflow and
   connection models.
2. `bunx ph generate piece knowledge-vault --id @powerhousedao/piece-knowledge-vault --auth custom`.
   Afterwards, **check that no second lockfile was written** (the generator syncs dependencies
   itself).
3. Add `"./pieces"` and `"./pieces/*"` (`types` + `node`) to `package.json` `exports`. The host
   resolves `import.meta.resolve("<pkg>/pieces")`.
4. `bun run build`. It emits `dist/node/pieces/knowledge-vault/index.mjs` plus `descriptor.json`.
   **As with subgraphs, a piece change is invisible until it is built.** Unbuilt entries are warned
   about and skipped.
5. Local run: `workflows.enabled: true`, `connect.app.workflowsEnabled: true`, then
   `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES=127.0.0.1/32,::1/128 bun run vetra`. The project loads
   itself from `cwd`. Expect `Loaded 1 piece(s) from package @powerhousedao/knowledge-note` and
   `Holding 1 package piece(s)`.
6. Coverage: add `pieces/**/lib/**` to `vitest.config.ts` `include`.

**Tests:**
- **Against the real handlers.** Mount `createSearchRoute(deps)`, `createIngestSourceRoute(deps)`
  and the others behind a node server with fake deps, and point the piece's client at it. The piece
  is then tested against the vault's actual request handling, not a mock that can drift.
- **Conformance,** as paperless does, with `@powerhousedao/reactor-workflow/testing`:
  - `PieceRegistry`
  - `loadPieceFromDir` (`constructor.name` must survive the build)
  - `buildDescriptor`, asserting the **full list of action and trigger names**
  - `PieceWorker.runAction` in a real fork
- **Auth hooks:** call `validate` and `getConnectionIdentifier` with the flat auth for each failure
  mode in §9.
- **Live e2e,** gated by an environment variable: `ph vetra`, a scratch vault, `ingest-file` on a
  PDF, `new-source` → `get-document`.

---

## 13. Integrating with Activepieces: email and Google Meet

The two target workflows, designed against the engine as it is. The facts they rest on:
- **Engine source (dev.24/dev.26):**
  - OAuth2 is rejected. An `auth` array runs from dev.25 on; dev.24 refuses one.
  - `core#trigger:webhook` caps a delivery at **1 MiB**. It uses reactor-api's `DEFAULT_MAX_BODY_BYTES`, and `WebhookConfig` has no field to raise it.
  - Its `token` scheme compares one configurable header with the secret.
- **Activepieces `main` (checked 28 Sep):** the auth type and trigger strategy of each piece.
- **Live tests on the local vault (§16):** convert (12 pages in 13 s) and `.eml` conversion. Convert reads an email's headers and body but **ignores its attachments**.

### 13.1 What each connector can do here

| Connector | Auth | Trigger | Works on this engine? |
|---|---|---|---|
| `@activepieces/piece-imap` 0.5.0 | CustomAuth (host, user, **app password**) | `new_email`, polling | **Yes.** Attachments come through `files.write`; inside a trigger that means inline data URIs (≤ 8 MiB each). The trigger output has **no filename or content type** for them |
| `@activepieces/piece-gmail` 0.17.0 | `[OAuth2, CustomAuth service account]` | `new_attachment` and four more, polling | **Yes on dev.28, service account only** (auth arrays run from dev.25). Needs a Workspace admin to grant domain-wide delegation |
| `@activepieces/piece-microsoft-outlook` | OAuth2 only | polling | **No** |
| `@activepieces/piece-google-docs` / `-drive` | `[OAuth2, CustomAuth service account]` | `new-document` / `new_file`, polling | **Yes on dev.28, service account only.** The folder filter matches direct children only, and Meet files land in per-meeting subfolders (July 2026), so they must be filtered by title instead |
| Google Meet piece | — | — | **Does not exist** |
| Inbound mail services (Postmark, Mailgun, SendGrid) posting to `core#trigger:webhook` | basic auth / HMAC in body fields / ECDSA | webhook | **Not with attachments.** Base64 attachments pass the 1 MiB cap at about 750 KB of files. The HMAC schemes read a header, so Mailgun's body-field signature cannot be checked |
| Cloudflare Email Worker or Google Apps Script → `core#trigger:webhook` | a header secret (`token` scheme) | webhook | **Yes, for payloads ≤ 1 MiB.** That fits transcripts and email bodies, not attachments |

Registry pieces install from the Activepieces CDN, or from npm with `npm install` on the host. No compatibility check runs. Whether `piece-imap` installs and runs in the worker is **the first thing to spike** (§15).

### 13.2 Email with PDFs → sources

A new vault-piece action does the whole job in one step, because the engine has no loops:

**`ingest-email`**
- **Props:**
  - `message_id` (the dedupe key)
  - `subject`, `from`, `date` (any format; normalised to UTC `…Z`)
  - `text`, `html` (optional)
  - `attachments` (an ARRAY of FILE rows: data URI, URL, `attachment://` or `{filename, base64}`)
  - `filter_extensions` (default: the formats convert supports)
  - `body_as_source` (default on)
  - `source_type` for attachments (default `DOCUMENTATION`)
- **Does:**
  1. Creates the folder `/sources/Email — <subject> (<date>)`, which is idempotent on the name.
  2. Ingests the body as a `CONVERSATION` source (author = sender, `url: mid:<message-id>`).
  3. For each attachment, sniffs the type from its magic bytes when it has no filename, converts it, ingests one source per section with the fallback titles, and attaches the original.
  4. Records `message_id` so a re-fired trigger returns the existing folder (§6).
- **Returns:** `folder`, `body_source`, `sources[]`, `skipped[] {name, reason}`.
- **Step timeout:** at least 60 s + 300 s per attachment.

There are three ways to feed it, in order of how little they need:

| Route | Chain | Needs | Limits |
|---|---|---|---|
| **A. IMAP polling** | `piece-imap#trigger:new_email` → `vault#ingest-email` with `attachments: {{trigger.payload.attachments}}` | An IMAP account with an app password (personal Gmail, or Workspace where app passwords are allowed; not Microsoft 365) | 8 MiB per attachment. No filenames (hence the type sniffing). Delivery latency = the poll interval |
| **B. Gmail with a service account** | `piece-gmail#trigger:new_attachment` (filter `pdf`) → `vault#ingest-file` | Workspace domain-wide delegation (the stack is already dev.28) | 8 MiB per attachment; Workspace only |
| **C. Email-in owned by the vault** (V11) | Mail service or Cloudflare Worker → a vault webhook endpoint, **no workflow** | Vault work (below) | Up to the endpoint's own cap (30 MiB, as convert) |

**V11: vault email-in.**
- **Registration:** the vault registers a webhook family (`this.http.webhooks.register({ name: "email-in", … })`, reactor-api, already in dev.24) and mints one endpoint per drive.
- **Policy:**
  - `maxBodyBytes: 30 MiB`;
  - `verify` per sender: `token` for a Cloudflare Worker or Postmark basic auth (`authorization` header, to verify live), or `hmac-prefixed` for a sender that signs a header;
  - dedupe on the Message-ID header.
- **Accepts:** raw MIME (`message/rfc822`, which is what a Cloudflare Email Worker forwards) or Postmark's JSON.
- **Does:** the same work as `ingest-email`, server-side.

This is the re-scoped slice 3 of `http-surface.md` (§11): the one thing a workflow cannot do is take a large, signed delivery. It also works for vaults that don't run workflows. Its cost is MIME parsing on the server (for example `postal-mime`) and an admin screen that shows the endpoint URL.

**Recommendation:** build `ingest-email` in the piece and prove it with **route A** first; it needs no admin. Add **C** when attachments above 8 MiB, Microsoft 365 or no-poll delivery matter. Use **B** only for Workspace tenants that can grant delegation.

### 13.3 Google Meet transcript or Gemini notes → source

No vault change is needed beyond the piece. `ingest-source` already takes `source_type: TRANSCRIPT` and `url`, and with the piece it gains `published_at` normalisation and `dedupe_key`.

| Route | Chain | Needs | Notes |
|---|---|---|---|
| **A. Apps Script push** | A time-driven Apps Script in the organizer's account finds new Docs whose title ends `- Transcript` or contains `Notes by Gemini` (searching Drive by name and modified time, **not** by folder), and POSTs `{docId, title, text, url, createdTime, organizer}` with an `x-webhook-token` header → `core#trigger:webhook` (`token` scheme, `dedupeField: {body: "docId"}`) → `vault#ingest-source` (`source_type: TRANSCRIPT`, `url`, `published_at: {{trigger.payload.body.createdTime}}`, `dedupe_key: {{trigger.payload.body.docId}}`) | `PUBLIC_URL` on the Switchboard; a one-time Apps Script consent inside Google | A transcript is far below 1 MiB. Files can appear up to 24 h after a meeting. Gemini notes have two tabs, so check that `getText()` reads both |
| **B. Docs piece with a service account** | `piece-google-docs#trigger:new-document` (no folder filter) → `core#branch` on the title → `#get_document_plaintext` → `vault#ingest-source` | Workspace domain-wide delegation impersonating the organizer (the stack is already dev.28) | Polling; one connection per organizer |
| C. Meet REST API and Workspace Events via Pub/Sub | — | A custom piece, Pub/Sub, subscription renewal | Only worth it at scale; transcript entries are kept only 30 days |

**Recommendation:** route **A**. It needs no Google credential in the engine, and `core#trigger:webhook`'s `token` scheme and dedupe cover it. The Apps Script ships as a documented snippet in this repo (`docs/integrations/meet-apps-script.gs`), with the endpoint URL and token set as script properties.

### 13.4 What these add to the plan

- **Piece actions:** `ingest-email` (new; phase 1), plus `ingest-source`'s `dedupe_key` and `published_at` normalisation (already phase 1).
- **Vault:** V11 email-in (optional, after route A works).
- **Stack:** already dev.28, so the Google service-account routes need no bump; they need a Workspace admin.
- **Spikes (phase 0):**
  1. `piece-imap` installs and polls in the worker (npm on PATH, egress to port 993).
  2. Its attachment data URIs hydrate into our FILE ARRAY prop.
  3. The `token` scheme with `header: authorization` accepts Postmark's basic auth.
  4. A 900 KB JSON delivery to `core#trigger:webhook` passes and a 1.1 MB one gets 413, to confirm the cap live.

## 14. Risks and open questions

- **Cross-step attachment refs: confirmed broken (§17).** A file one action writes is refused
  when a later step reads it. Composite actions keep conversion, ingest and attachment inside one
  step; trigger files (inline data URIs) are unaffected.
- **Bypass through piece-reactor.** `document-dispatch` writes into vault documents as the host,
  with no drive grant and no lint. Document "vault writes go through the vault piece", and ask the
  engine team for a per-drive policy on the reactor port.
- **Token expiry** (§9).
- **Automation can lower vault health.** `create-notes` alone does not meet the Definition of done
  (two typed links, MoC membership, CANONICAL). That is acceptable when `/health` says so.
  Auto-approval is not: `review-note` refuses self-approval.
- **The academy disagrees with the code** on policy (retry, concurrency, idempotency). Design
  against the code, and re-check at each stack bump.
- **Bundle size** of inlining the lint and zod schemas (§4). If it is too large, lint only the
  cheap rules on the client (JS length, enums, escapes).
- **Unverified:**
  - the Renown credential lifetime;
  - whether the source's `AttachmentRef` validation and the reference read model accept a ref the
    piece uploaded through `/attachments/reservations` (the UI does exactly this, so it is likely);
  - the installer `ph generate piece` uses.

---

## 15. Order

| Phase | Scope | Vault changes |
|---|---|---|
| 0 — spike (≈ 1–2 days) | Generate the piece; `exports`; connection with `validate` and identifier; `search`; build; the block visible in Studio. Test the cross-step ref risk, bundle size with the inlined lint, and an upload through `/attachments/reservations` followed by `ATTACH_ORIGINAL_FILE`. The four integration spikes of §13.4 | — |
| 1 — ingest | Client, errors, normalize, idempotency memo; `get-document`, `get-document-markdown`, `get-source`, `list-sources`; `ingest-source`, `ingest-sources`, `create-source-folder`, `convert-file`, `ingest-file`, `ingest-files`; `ingest-email`; `upload-attachment`, `attach-original`; `create-observation`; `dispatch-actions`, `custom-api-call`; trigger `new-source`; unit and conformance tests; §13's two workflows end to end: email by IMAP route A, Meet by Apps Script route A | **V0**, V7, V8, V9 |
| 2 — author and pipeline | `create-note(s)`, `update-note`, `link/update/unlink`, `add-to-moc`, `create-moc`, `submit-for-review`, `review-note`, `supersede-note`, `complete-extraction`; the task actions and `queue-source`; trigger `new-pipeline-task`; the extraction workflow (task → claim → `get-document-markdown` → LLM → `create-notes` → `complete-extraction` → `advance-task`) | V1, V2, V10 |
| 3 — graph and watch | `search` options, `get-related`, `find-nodes`, `export-context`, the graph and health reads, `graphql-query`, admin; triggers `note-changed`, `note-became-canonical`, `tension-opened`, `health-changed` | V5 |
| 4 — hardening | Lossless triggers; service identity; `ingest-web-page` | V3, V4 |
| Later | V11 email-in; Google service-account routes (dev.28 has them; they need a Workspace admin); outbound subscriptions and webhook triggers; publishing to the registries; a pieces-only package if cross-host use grows | V6, V11 |

---

## 16. Live test on the local vault (28 September 2026)

The calls the piece will make were run from a plain Node script with a bearer, against
`localhost:4001` (`REQUIRE_AUTHENTICATED_CALLER=true`), drive `my-personal-vault`. The file was a
12-page PDF of 772 KB. The flow followed the app's intake order:
1. convert
2. `sources/folders`
3. `POST sources` for each section
4. reserve the original, then upload it
5. `ATTACH_ORIGINAL_FILE` on each source
6. read back

**Result:** 9 of 9 sources were created in `/sources/KPMG 2026 Global Tech Report` (status
`INBOX`, `queue: false`). All nine carry the original PDF. The content has real newlines, and the
original downloads back byte for byte.

| Finding | Consequence for the piece |
|---|---|
| `ping` without a bearer → `401 {"error":"Authentication required"}`, even on `ping` | `validate` must send the bearer on `ping`; a 401 without one is not a "wrong token" diagnosis |
| `convert/health` re-probes live: `ok:false, backend:null` while docling was down, `ok:true` once it was started. The service lists **`email`** among 29 formats | The label can show convert status. An `.eml` may convert directly (to test), which would simplify the email workflow |
| Convert of 12 pages: **13.1 s** cold (7.2 s convert, 5.5 s chunking). `convert/progress/:job` reported `reading → structuring → done` with page counts | 30 s is too tight for anything bigger. Keep `timeoutSeconds ≥ 300`; progress can feed `output.update` |
| The first write after every boot takes **37–40 s**; warm writes take 0.2–1.4 s. **Root cause (traced 28 Sep; see the note below):** the sync manager rebuilds the outbox of every persisted sync remote from its last ack, and on PGlite those queries block the event loop | Nothing vault-side to fix in the write path. The piece allows ≥ 60 s on its first write and on `validate`. Local stores need their stale remotes cleared |
| Document ids are **not UUIDs** (`kuGM8ULBt5w4oXRTHZQxkUNcGMXwn_eIu7sI--9_UsI`); the drive and older documents are | Never validate ids as UUIDs in props or outputs. The skill docs that say "UUID" need a note |
| `POST /attachments/reservations` answers `201 {reservationId, ref, expiresAtUtc}` (the ref is returned up front); `PUT` answers `200 {hash, ref, header}`; `HEAD /attachments/:hash` answers 200 | `upload-attachment` is two calls, taking the ref from the reservation |
| Lint via `POST actions` rejects, **with nothing written**: an RFC 2822 date, a date-only value, **an ISO date with `+02:00`**, and a literal `\n`. The same checks run only *after* create in `POST sources` | V0 confirmed. Until it ships, the piece must normalise `published_at` to UTC `…Z` and check for literal escapes before calling `POST sources` |
| `POST sources` rejects `sourceType: EMAIL` and an `idempotencyKey` field (`UNKNOWN_FIELD`) before creating anything | No email type; V8 is a new field, not a flag |
| Section titles from convert include `07` and `kpmg.com` | `ingest-file` needs a title fallback (document title + part number) |
| `knowledgeGraphRecent` (last hour) and `FullSearch("Foreword")` return nothing for the new sources | Sources are invisible to graph-based triggers. `new-source` must diff the drive state (73 KB, 22 ms for 359 nodes) |
| Queue state: 227 tasks, 146 `PENDING`, 81 `DONE`, but `completedCount: 139` and `activeCount: 146` | Counter drift in this vault (double completes, or the task-id collision the rules warn about). `list-tasks` should count from `tasks[]`, not the counters. Worth a `/health` look |

### The first-write stall, traced

The first write after a boot always took about 40 s, measured under both `ph vetra` and `ph reactor`.

**What the measurements showed:**
- Reads, GraphQL POSTs and a vault POST that writes nothing all answered in under 50 ms during the same window.
- `timedRoute` shows the write request reached our handler on time and our handler finished in under 2 s.
- Pings sent every 100 ms froze for 39.9 s from the moment the write landed. When the process idled for 60 s after boot with no write, nothing froze.

**What the CPU profile of that window showed:**
- 94 % of the time is in PGlite `execProtocolRawSync`, which runs queries synchronously in WASM, plus the decoding of large result sets.
- The only JavaScript callers are `SyncManager.deriveOutbox` → `operationIndex.find` (paging) → `filterOperations`.

**The cause:**
- The store holds **272 sync remotes**. **239** of them are the knowledge-vault app's remote-first channels (filter `["remote-first-sync-nothing"]`, `PollBehavior.Manual`): 154 on the personal vault and 85 on the other vault.
- **252** remotes have no outbox cursor at all.
- The app registers one of these channels per Connect session (`editors/knowledge-vault/hooks/use-remote-first.ts` step 2, `lib/boot.ts`). It never polls it, so it never acknowledges anything.
- The reactor never prunes such a channel. `stalePollAgeMs` returns `undefined` for a channel that reports no poll: "a channel that reports nothing (or 0) is never pruned".
- After a restart, the first write to a drive rebuilds the outbox of every remote on that drive's collection. Each rebuild reads the operation index from the remote's cursor, which is 0 for most of them, and applies the document-id filter only afterwards, in JS.

**Ruled out along the way:**
- the attachment reference read model's parked checkpoint. That was real, and fixed with `scripts/repair-read-model-checkpoint.mjs --through-max`, but it was not the cause;
- the Apollo supergraph composition;
- the document-model loading gate;
- the host's auth and body buffering;
- a graph-indexer replay (its processor cursors are current).

**Result:**
- `scripts/prune-sync-remotes.mjs --apply` removed the 239 app channels and the orphan cursors.
- The first write after a boot then took **1.9 s instead of ~40 s**, and the longest ping stall fell from 39.9 s to 2.1 s.
- The remaining ~2 s come from the 33 ordinary Connect remotes, 7 of them on the personal vault with no cursor. `--stale-days N` clears those.
- `editors/knowledge-vault/lib/channel-ids.ts` now re-adds each neutralised channel under one stable id per (address, drive).
- The id is **derived** (a SHA-256 of address and drive, formatted as a UUID), so it survives clearing site data. Verified live: two rounds of "clear app data + re-add the drive" landed on the same server remote (`4516cbd6-…`, the id computed independently).
- **Still leaks, one per re-add:** the full-drive channel that Connect's own `addRemoteDrive` registers before the app neutralises it. The app does not control its id, and there is no client call that removes a server-side channel. Clear these with `scripts/prune-sync-remotes.mjs --stale-days N`, or upstream with a server-side channel removal.

**Follow-ups:**
1. **Local (done 2026-09-28):** clear the stale remotes. With the reactor stopped and the store backed up, delete the rows in `reactor.sync_remotes` and `reactor.sync_cursors` that the app created.
2. **This repo:** stop leaking one server-side remote per Connect session. Reuse a stable channel name per browser and drive, or remove the channel instead of re-adding it under the sentinel filter. This needs a design that keeps Connect showing the drive as remote.
3. **Upstream (reactor):**
   - `deriveOutbox` should push the document-id filter into the query, so the sentinel filter reads zero rows instead of the whole log.
   - A channel that has never polled should be prunable after a TTL.
4. **Deployments:** Postgres runs these queries asynchronously, so a hosted Switchboard should not freeze. It still accumulates one remote per Connect session and rebuilds all of their outboxes after each deploy. Check `select count(*) from reactor.sync_remotes` there.

**Also found:** `vetra --watch` hot-swaps subgraphs on a rebuild but skips re-registering REST routes (`route registration skipped: … already registered`). A change to a REST route needs a full restart. `[http] slow step` logging (`subgraphs/http/lib/slow.ts`) stays in: it is silent under 2 s, and it now covers time spent before the handler when a client sends `x-client-sent-at`.

## 17. Phase 0 on the workflow runtime (28 September 2026, dev.28)

The piece (`42b5cfb0`) was run inside a live workflow runtime: `ph vetra` with workflows enabled, over
`workflowRuntime` GraphQL, in a scratch drive named "Workflows (spike)", away from any vault.

| Check | Result |
|---|---|
| The runtime loads the piece | ✅ `Holding 2 package piece(s) on disk: @powerhousedao/piece-reactor, @powerhousedao/piece-knowledge-vault` |
| Catalogue entry | ✅ `@powerhousedao/piece-knowledge-vault#search`, with the connection form and its instructions |
| A connection with a minted secret passes the runtime's `checkConnection` | ✅ label `0xadbA…BcA4 @ localhost:4001 · 2 vaults · token expires 2026-10-05` |
| A webhook → `search` run | ✅ `{{trigger.payload.body.q}}` resolves; the step succeeds in 1.1 s; the run journal records the resolved input and the 1.4 KB output |
| Webhook `token` scheme | ✅ 202 with the token; 401 "Signature verification failed" without it or with a wrong one |
| `dedupeField: "body:id"` | ✅ a repeated id answers 200 and starts no run |
| The 1 MiB body cap | ✅ 900 KB → 202; 1.1 MB → **413 "Payload too large" in 4 ms** (with curl; Node's `fetch` hangs after an early 413, which is client-side) |
| A registry piece: `@activepieces/piece-imap@0.5.0` | ✅ downloaded to `.ph/ap-bundles`, runs in the worker (its own "Host not found" error through `checkConnection`). CustomAuth; `new_email` is POLLING with a `mailbox` dropdown. Polling a real mailbox is still untested |
| **A file from one action to the next** | ❌ `file-helper#createFile` → `read_file` with `{{steps.make.output.url}}` fails: `No staged file for reference "attachment://v1:…"` |
| Inlining the vault's lint in the piece | ✅ +109 KB minified (28 KB gzipped); inline it |

**Why files do not cross steps.** Before a step runs, the host downloads the files its config
references, but only those the **workflow document** references (`attachment-port.ts`: "a step's
refs come from its own run journal: the workflow document is what vouches for them"). A file an
earlier step wrote exists only in the run journal, so the check refuses it and the step finds
nothing. Consequences:
- The piece's composite actions (`ingest-file`, `ingest-files`, `ingest-email`) must convert, ingest
  and attach inside **one step**, as §5.3 already designs.
- Files from a **trigger** arrive as inline data URIs, not refs, so IMAP route A (§13.2) is
  unaffected.
- A workflow that needs a file from another piece's action must go through a data URI (for
  example `file-helper#read_file` with base64 output), which is itself blocked for action-written
  files today.

**Upstream reports this phase produced:**
1. **Webhook block type.** The catalogue (`pieceTriggers(packageName: "core")`) advertises
   `core#trigger:webhook`, but the runtime arms only `core#webhook` (`service.ts`,
   `trigger?.blockType === WEBHOOK_BLOCK`). A workflow built from the catalogue's string never arms:
   "No piece answers for the trigger block type…". Studio may map the name itself; the API does not.
2. **Files between steps.** Step-written files are refused by the next step in the same run
   (above).
3. **Shutdown.** After the Node client hung on a 1.1 MB upload, `ph vetra` ignored SIGTERM and
   SIGINT for 20+ minutes, with its piece workers already exited, and had to be killed. The client
   connection had closed by then, so something else held shutdown. Not reproduced yet.
4. **A hard kill loses recent PGlite writes.** Everything from the last few minutes before
   `kill -9` was gone after the restart: a `SET_TRIGGER` and two runs. Stop dev servers with
   Ctrl-C.

**Hosted Vetra: the workflows addon.** On Vetra, workflows are enabled per environment as an addon
("Runs workflow documents on this environment and adds the workflow editors and Workflow Studio to
Connect"), and its settings replace the local `.env` lines:

| Setting | Why it matters here |
|---|---|
| `PH_WORKFLOWS_SECRETS_MASTER_KEY` (required, 64 hex) | Without it every connection's saved token becomes unreadable at the next restart; changing it later has the same effect |
| `PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES` | Only needed when the vault is reached on a private address; the vault piece normally calls the Switchboard by its public origin |
| `PH_WORKFLOWS_PIECE_MAX_FILE_BYTES` (default 8 MB) | The per-file ceiling in §8; raise it for larger PDFs, since convert itself takes 30 MiB |
| `PH_WORKFLOWS_WEBHOOK_TIMEOUT_MS` (default 30 s) | Matters only for a webhook workflow in `responseMode: "sync"` that waits for a conversion |
| `PH_WORKFLOWS_POLL_INTERVAL_MS` (default 60 s) | The IMAP route's delivery latency unless the trigger sets `pollEverySeconds` |
| `PH_WORKFLOWS_RUN_CONCURRENCY` (default 4), `…_RUN_QUEUE_DEPTH` | Each run is its own process; convert serialises anyway (one file at a time) |
| `PH_ATTACHMENT_URL_SIGNING_SECRET` (Switchboard) | Unset, signed download URLs use a per-process secret and die at restart |

Locally, Workflow Studio also needs `connect.app.workflowsEnabled: true` in `powerhouse.config.json`;
there is no environment switch for it.

## 18. Vault agent jobs: an LLM that follows the pipeline

**Goal.** A workflow step that takes a job, such as "extract this source" or "connect these notes",
and has an LLM carry it out against the vault. It follows the same rules the Claude Code skills
enforce (`/powerhouse-knowledge:extract`, `:connect`, `:synthesize`, `:verify`, `:health`), so an
ingested source becomes atomic, linked, placed notes without a person running the pipeline.

**Why it lives in the piece.** The engine has no loop block, it hides Activepieces' AI and agent
pieces (`piece-ai`, `agent`, …), and a registry LLM step is a single call. An agent needs a loop:
send the job and the tool schemas, run each tool call against the vault, return the result,
repeat until the job is done or a budget runs out. That loop is a piece action: the **harness**.

### 18.1 Credentials and model choice

A step's props cannot hold secrets; only a connection can. The vault connection gains three
optional fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `llm_base_url` | ShortText | `https://openrouter.ai/api/v1` | Any OpenAI-compatible endpoint (OpenRouter, OpenAI, a local gateway) |
| `llm_api_key` | SecretText | — | Encrypted with the runtime's master key like the vault token. Absent: the agent actions refuse with a clear message; every other action works as before |
| `llm_default_model` | ShortText | — | Used when a step leaves its model empty. Connection props cannot be dynamic dropdowns (CustomAuth allows static props only), so this is a model id |

**The model picker.** Every agent action has a `model` prop, a **dynamic dropdown** filled live
from the provider with the connection's key, the same way the drive picker is filled:
- `GET {llm_base_url}/models?supported_parameters=tools` returns only models that can call tools.
  On OpenRouter (28 Sep): **369 of 458**. A provider that ignores the filter is filtered on
  `supported_parameters` client-side, and one without that field lists everything.
- Each option reads `Name — $in / $out per M tokens · N k context`, from the model's `pricing`
  and `context_length`, so cost is visible when choosing. The value is the model id
  (`anthropic/claude-sonnet-4.5`).
- `refreshOnSearch`, so typing narrows 369 options by name or id.
- Empty: the connection's `llm_default_model`.
- A standalone `list-models` action returns the same list for a workflow that picks a model itself.

`validate` also checks the LLM fields when they are set: OpenRouter's `GET /key` (free) confirms the
key and reports its limit. The connection label gains `· LLM: openrouter.ai (limit $X | no limit)`,
which puts a key with no spending limit in plain sight.

### 18.2 Jobs

One action per job. Each has fixed instructions, a tool whitelist and budgets (`max_steps`,
`max_cost_usd`, `timeout`); a `dry_run` checkbox swaps every write tool for a "propose" tool that
records what it would have done.

| Action | Skill it follows | Tools |
|---|---|---|
| `agent-extract` | `/extract` | read the source; search for near-duplicates; create notes with `DERIVED_FROM` + reason; record extraction stats |
| `agent-connect` | `/connect` | search, read neighbours; create or annotate links with a reason and confidence |
| `agent-reweave` | `/synthesize` | MoC membership (`CORE_IDEA`), create or update MoCs, `CHILD_MOC` placement |
| `agent-verify` | `/verify` | read-only checks; reports findings, fixes nothing on its own |
| `agent-health` | `/health` | stats, orphans, tensions; writes the health report |

- **Tools come from the piece's own client**, so every write keeps the vault's server-side
  guarantees: lint before dispatch, placement, rollback, read-back. A refused write returns the
  server's findings to the model (for example `actions[0].input.description: exceeds 200
  characters`) so it can correct and retry.
- **The harness, not the model, moves the pipeline.** It claims the task, runs the job, and
  advances the phase with a handoff built from the model's report. The model never advances,
  completes or fails a task, and never approves a note. Notes stay DRAFT for human review.
- **Instructions** are tool-shaped editions of the skills. The skills tell Claude Code to run
  `switchboard …`, which a workflow LLM cannot do. The editions keep the skills' rules (one claim
  per note, the 200-character description, a reason on every link, an honest skip rate) and name
  tools instead of commands. The plugin's skills stay the source of truth; the editions ship with
  the piece, and a vault skill document (`/powerhouse-knowledge:skills`) can override one so a vault
  can tune its agent without a redeploy.
- **Output**: what was done (notes created, links, skipped claims with reasons), the model used,
  token usage and cost (OpenRouter's `usage.cost`), steps taken, and why it stopped.

### 18.3 Workflows

One workflow per phase, so each run is short and a failure stays local:
`new-pipeline-task (phase)` → `claim-task` → `agent-<job>` → `advance-task`. `agent-health` runs on
`core#trigger:schedule`. A step timeout of 600–900 s covers a job on a 2–3 k-character section.

### 18.4 Reuse and risks

- **Reuse:** the vault app's chat already has an OpenRouter tool-calling client
  (`editors/knowledge-vault/lib/chat/completions-client.ts`), a text-tool-call fallback for models
  that emit calls as text, a system prompt and 17 read-only tool schemas (`vault-tools.ts`). The
  harness ports the client and adds write tools.
- **Quality:** automated extraction can lower vault health. Mitigations: notes stay DRAFT,
  `agent-verify` after each job, `/health` reports honestly, and nothing is auto-approved.
- **Cost:** about 10–30 model calls per extract on one section. `max_cost_usd` stops a run, and the
  provider key should carry its own spending limit.
- **Secrets:** the key lives only in the connection (encrypted); give workflows their own key.

**First spike:** `agent-extract` on one local source in `dry_run` mode, using the model picker above.
Nothing is written; the proposed notes, the steps taken and the cost show whether the approach
holds before any write tool is enabled.
