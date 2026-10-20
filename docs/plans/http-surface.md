# Plan: the vault's HTTP surface — safe agent writes, LLM-readable notes, inbound ingestion

Status: proposed · 2026-09-10 · **revised 2026-09-11** against the installed stack · pin bumped 2026-09-12
Owner: liberuum
Prereqs: Powerhouse stack ≥ `6.2.3-dev.0` (per-package HTTP routes + webhooks).
**This repo is on `6.2.3-dev.4`** (npm's current `dev` dist-tag, published
2026-09-12 06:56 UTC; upgraded 2026-09-12); it compiles, lints, tests and builds.
`feat/vault-authorization` is merged into `remote-first-vault` (Layer-2
permissions, `subgraphs/access`). Every upstream fact below was read from the
`dev.3` dist and from `main` @ `e4d590b` — the record is in the appendix — and
holds at `dev.4`: no commit touched `reactor-api/src/http` or
`shared/processors/http.ts` between the two releases.

## Goal

Give the vault a REST/webhook surface of its own, served by the Switchboard
under `/api/@powerhousedao/knowledge-note/…`, so that:

1. **Agent writes are safe by construction.** Today `AGENT.md`'s golden rule
   is "read however you like, write ONLY through the CLI", because one raw
   action without `id` + `timestampUtcMs` bricks sync for every client and the
   reactor skips invalid actions *silently* while the job reports success. A
   validated `POST actions` route accepts the agent's **signed** actions,
   stamps what the signature does not cover, lints every action the reactor's
   way, and answers 4xx — before anything is dispatched. Relationships
   (`docs link` / `annotate` / `unlink`) get the same treatment: they are not
   document actions, so they need their own route.
2. **Knowledge is served the way LLMs and tools consume it.** One `GET` for a
   search with content inline; one `GET` for a note as markdown-with-frontmatter;
   `llms.txt` for discovery; the graph's structure (stats, topics, neighbours)
   as plain URLs instead of GraphQL recipes.
3. **Any service can trigger a vault operation, under the same auth.** One
   webhook strategy — endpoints are configuration, providers are presets, the
   operations an endpoint may cause are an allow-list — with GitHub as the
   first preset. A merged PR does what *Queue for Processing* does; the
   pipeline runs.

## What upstream shipped (the facts the design rests on)

Read from the installed `6.2.3-dev.3` dist — `@powerhousedao/shared`
`dist/types-*.d.ts` (`processors/http.d.ts`, lines ~966–1109) and
`@powerhousedao/reactor-api` `dist/index.mjs` (`src/http/route-service.ts`,
`webhook-service.ts`, `webhook-store.ts`, `server.ts`) — and the academy
guides `07-HostingHttpRoutes.md` / `08-ReceivingWebhooks.md` on `main`
(`e4d590b`, 2026-09-11). The API landed in `235829f`/`ee06213`; `e3f7792`
renamed the caller to `ctx.user`; nothing under `src/http` has changed since.

- **One `IHttpScope` per package**, namespaced by npm name and mounted under
  `<basePath>/api`: `https://<host>/api/@powerhousedao/knowledge-note/<path>`.
  **Both spellings answer** — verbatim and percent-encoded
  (`/api/%40powerhousedao%2Fknowledge-note/…`). A subgraph reads it as
  `this.http` (always set; register in `onSetup()`); a processor receives it
  as `module.http: IHttpScope | undefined` — **`undefined` in browser hosts**,
  so everything here is Switchboard-only. When the package name cannot be
  resolved to a routable namespace the scope is an `UnroutableScope` whose
  `get()/post()/…` **throw** — wrap registration in `try/catch` so a
  namespace problem cannot take the GraphQL subgraph down with it. Handlers
  are Fetch-shaped: `(request: Request, ctx: RouteContext) => Response`.
- **Auth is identity, not authorization — and `renown` does not guarantee an
  identity.** `auth: "renown"` (default) 401s only when the host has auth
  enabled *and* no verified bearer arrived
  (`#authenticate`: `if (result.auth_enabled && !result.user && auth === "renown")`).
  On a host with `AUTH_ENABLED` off every caller is anonymous and a `renown`
  route serves them with `ctx.user === undefined`, `ctx.authEnabled === false`.
  **Every write route must check `ctx.user` itself.** `"renown-optional"`
  yields the anonymous actor instead of 401. `"public"` skips identity. A
  custom `RouteAuthorizer(req)` gates but **resolves no principal**
  (`ctx.user` stays `undefined`) — for "identity *and* an extra rule" use
  `renown` and apply the rule in the handler. `ctx.user = { address, chainId,
  networkId, appKey }` — the same shape as a resolver's `ctx.user`; `appKey`
  is the `did:key` of the app instance that issued the token. **Per-document
  permission checks remain ours** (`subgraph.authorizationService`).
- **`REQUIRE_AUTHENTICATED_CALLER` covers GraphQL only.** The
  `requireAuthFetchMiddleware` is handed to `graphqlManager.init(...)` and
  nowhere else (`index.mjs:7704`); package routes never see it. Their
  identity comes from the route's `auth` mode and the handler's own check.
- **Bodies:** `parsed` (default; buffered, readable via `request.json()`),
  `raw` (bytes on `ctx.rawBody`), `stream`, `none`; `maxBodyBytes` → 413,
  **default 1 MiB**. `prefix: true` (no param for the sub-path) and `*rest`
  wildcards (path-to-regexp 8; segments joined with `/`). Routes match in
  **registration order** — register a specific path before a prefix route
  that would swallow it. `ctx.signal` aborts on client disconnect;
  `ctx.transport = { proto, host, prefix, baseUrl }` is the request's public
  origin resolved through the proxy (use it to build absolute links).
  `head()` is registered independently of `get()`. `OPTIONS` belongs to the
  CORS layer. `nodeRoute()` is the escape hatch for protocols that own the
  socket (no body cap, no uniform errors).
- **Webhooks:** `this.http.webhooks.register({ name, defaults?, policyFor?, onRequest })`
  returns `{ endpointFor(key) → { token, url, createdAt }, list(), revoke(key) }`.
  Token URLs are `/webhooks/<32 hex>` at the **host root**, outside the
  package prefix (the package and key live in the token record). Schemes:
  `none`, `token`, `hmac`, `hmac-prefixed` (GitHub), `hmac-timestamped`
  (Stripe: one header `t=<unix>,v1=<hex>`, digest over `<unix>.<body>`);
  each with `algorithm` (sha1/256/512), `encoding` (hex/base64), `prefix`,
  `header`, `toleranceSeconds` (default 300). Verification is constant-time
  over the raw bytes and **fails closed** on a missing secret. Order of
  checks: unknown/disarmed token → 404 (byte-identical); package not loaded →
  **503**; method → 405; size → 413; signature → 401; `challengeField` →
  `200 text/plain` echo (after verify, before dedupe); `dedupe.field`
  (`"id"` | `{ header }` | `{ body: "a.b.c" }`) → repeat within TTL answers
  200 empty. Bodies arrive parsed (JSON and `+json` → object,
  `x-www-form-urlencoded` → object, else text) with credential headers
  redacted. Tokens persist in `reactor_webhooks.webhook_endpoints`; dedupe
  keys in `reactor_webhooks.webhook_deliveries` (dedupe only — no payloads).
  Tokens survive package reload and are **not revoked on teardown**;
  `revoke(key)` is the only retirement.
- **Public origin:** `resolvePublicOrigin()` (`index.mjs:8131`) reads
  `PUBLIC_URL` → `RENDER_EXTERNAL_URL` → `HEROKU_APP_DEFAULT_DOMAIN_NAME` →
  **`http://localhost:<port>`**, so `hasPublicOrigin` is *always true* on the
  built-in server; the real check is whether the URL is right. The server
  constructs `HttpRouteService` with **`trustProxy: true`** (`index.mjs:7946`).
- Registering the same method+path twice on a scope **throws**. The **host
  disposes a package's whole scope** when the package is replaced, removed or
  the server stops; `handle.dispose()` / `scope.dispose()` exist for tests and
  for stopping a route while the package stays loaded.
- **Core already hosts `/mcp`** at the host root with an admin-only authorizer
  (`createMcpRequestAuthorizer`, `index.mjs:7397`). Slice 4's vault MCP is a
  separate endpoint under our namespace.

### What the reactor client gives a route (`IReactorClient`, `@powerhousedao/reactor` `dist/index.d.ts:1983+`)

- `execute(id, branch, actions, signal?, subject?: AuthSubject{ address?, key? })`
  and `executeAsync(...) → JobInfo`; `waitForJob(jobId)`; `executeBatch(...)`
  for several documents in one submission.
- `getOperations(id, view?, { sinceRevision?, actionTypes?, timestampFrom? }, paging?)`
  — the read-back.
- `evaluateActions(id, branch, candidates, subject?) → { allAllowed, evaluations: [{ allow } | { deny, reason }] }`
  — an authorization dry-run (the auth-scope model decides, with reasons).
- `context.signer` on an incoming action passes through **untouched**
  (`toSubmittableActions`, `index.mjs:3016`); nothing in the installed reactor
  dist verifies action signatures — the wire records them.
- `ReactorClient` is constructed with **one `ISigner`** (the host's,
  `dist/index.d.ts:3780`); `execute` has no signer parameter. Unsigned actions
  are therefore host-signed; a different principal must either arrive
  pre-signed or go through a second client (`ReactorClientBuilder`).
- `addRelationship(source, target, type, branch?)` carries **no metadata**.
  The CLI's `docs link --reason` builds a signed `ADD_RELATIONSHIP` action
  with `{ reason, confidence }` metadata and dispatches it itself; a REST
  relationship route does the same.

## Non-goals

- Replacing GraphQL. The graph queries, subscriptions and the Connect editors
  stay on the existing subgraphs; REST is for agents, tools and machines.
- Re-implementing what the graph-indexer computes. Routes call
  `createGraphQuery(db)` (`processors/graph-indexer/query.ts:278`) and the
  subgraph helpers; a REST answer and a GraphQL answer come from one function.
- Outbound notifications (vault → Slack etc.). A processor can already `fetch`;
  nothing here changes that.
- Public anonymous access to protected content. `public` is reserved for
  content that is public *anyway* (badge, llms.txt index of a public vault).

## Architecture

```
subgraphs/http/                      ← new subgraph, routes only (scaffold with codegen,
  index.ts                              which registers it in subgraphs/index.ts — never
  routes/                               hand-edit that barrel)
    actions.ts                        POST actions                                (slice 1)
    relationships.ts                  POST / PATCH / DELETE relationships         (slice 1)
    search.ts                         GET  search                                 (slice 1)
    notes.ts                          GET  notes/:id(.md), notes/:id/{similar,links,backlinks,connections} (slice 1–2)
    graph.ts                          GET  stats, topics(/:name), orphans, triangles, bridges,
                                           graph.json, activity, embeddings/missing   (slice 2)
    llms.ts                           GET  llms.txt, llms-full.txt                (slice 2)
    health.ts                         GET  health.json, badge.svg                 (slice 2)
    tasks.ts                          POST tasks/:id/claim                        (slice 2)
    admin.ts                          POST admin/reindex, admin/re-embed, admin/tensions/scan;
                                      GET  access-map                             (slice 2 / 5)
    work.ts                           GET  scopes/:id.md, wbs/:id.md              (slice 5)
    mcp.ts                            nodeRoute mcp                               (slice 4)
  webhooks/
    registry.ts                       ONE webhooks.register("ingest"); policyFor(key) reads
                                      the endpoint's config; onRequest → trigger  (slice 3)
    triggers/                         the operations a webhook may cause — an allow-list:
      ingest-source.ts                  Record step (INGEST_SOURCE → EXTRACTING → ADD_TASK)
      queue-task.ts                     re-run the pipeline on a document
      create-observation.ts             ops signal from a monitor
      advance-phase.ts                  an agent runner reports a phase done
    presets/                          per-provider verify + field mapping, as data
      github.ts  slack.ts  generic-token.ts
  lib/
    envelope.ts                       id + timestampUtcMs stamping, only when absent (port of
                                      the plugin's scripts/sync-skills.mjs `envelope()`)
    lint.ts                           two rule classes — REACTOR_REJECTS and VAULT_CONVENTION
                                      (see slice 1); NOT a verbatim port of the plugin's list
    articulation.ts                   the link-reason rule (port of hooks/pre-link-articulation.py)
    authorize.ts                      thin: BaseSubgraph.assertCanRead / assertCanWrite /
                                      resolveCanonicalDocumentId(identifier, requestKey) +
                                      authorizationService.canMutate / canCreate
    respond.ts                        one JSON error envelope; never a raw ClientError
```

Why a dedicated subgraph rather than routes on `knowledge-graph`: the REST
surface has its own auth decisions, its own tests, and will be the place the
MCP transport mounts; keeping it apart keeps `knowledge-graph` a pure GraphQL
subgraph. Both get the *same* `IHttpScope` (idempotent per package), so this is
organisation, not isolation.

**Prerequisite extraction.** The shared SEMANTIC/HYBRID search body
`searchWithEmbedding` (`subgraphs/knowledge-graph/resolvers.ts:131`) and the
HYBRID keyword fallback inlined at `:511–545` are module-private. Move them to
`subgraphs/knowledge-graph/helpers/search.ts` so the resolver and `GET search`
call one implementation. Everything else a route needs is already exported:
`createGraphQuery` (`processors/graph-indexer/query.ts:278`), `getDb` /
`getQuery` / `resolveCanonicalDriveId` (`helpers/db.ts`), `reindexDrive`
(`helpers/reindex.ts:76`), `searchSimilar` / `getEmbedding`
(`processors/graph-indexer/embedding-store.ts`), `embedQuery`
(`helpers/query-embedder.ts:19`), `renderScope` / `renderWbs`
(`processors/graph-indexer/work-outline.ts:453/180`), `readAccessMap`
(`subgraphs/access/access-map.ts:118`).

Every route lives in `dist/node/subgraphs/index.mjs`: **`bun run build` +
restart the Switchboard after each change** (the `CLAUDE.md` gotcha applies to
all of this work).

### Authorization model (applies to every slice)

| Route | `auth` | Then |
|---|---|---|
| `POST actions` | `renown` | **require `ctx.user`** (401 when absent — the mode alone does not guarantee it); `canWrite(canonicalId, address)` per target document; `canMutate(canonicalId, action.type, address)` for lifecycle ops (`APPROVE_NOTE`, `ARCHIVE_NOTE`, …); `canCreate(address)` when a batch creates documents; supreme admin passes; 403 lists the refused ids and types |
| `relationships` | `renown` | require `ctx.user`; `canWrite` on the **source** document (the edge is recorded there) |
| `GET search`, `GET notes/:id…`, `GET graph.*` | `renown` | require `ctx.user`; run as the caller — call the shared helpers with the subgraph so the same `assertCanRead` the GraphQL guard (`withDriveGuards`, `resolvers.ts:82`) applies; `activity` / `history` stay in the privileged (`canWrite`) set, as in GraphQL |
| `GET llms.txt` | `renown-optional` | anonymous → MoC titles only if the drive is readable anonymously, else 401 hint; signed-in → full index |
| `GET health.json` | `renown` | full report; `badge.svg` is `public` (status word only) |
| `POST admin/*`, `GET access-map` | `renown` | `canManage(driveId, address)` |
| webhooks | n/a (signature) | the handler writes as a service identity (decision in slice 3); **record the sender in provenance** (`author: "webhook:<endpointId>"`, `sourceOrigin: IMPORT`, url) |
| `mcp` | `renown-optional` | inside the handler: accept `ctx.user` **or** a valid `x-vault-admin-key` (`VAULT_MCP_ADMIN_KEY`). Not a custom authorizer — that would erase `ctx.user`. Tools re-use the same gates as the routes |

`authorize.ts` is deliberately thin: `BaseSubgraph` already has
`assertCanRead` / `assertCanWrite` (no admin skip on the canonical-id
resolution, fail-closed on unknown ids) and
`resolveCanonicalDocumentId(identifier, requestKey)`; `IAuthorizationService`
has `isSupremeAdmin`, `canCreate`, `canRead`, `canWrite`, `canManage`,
`canMutate`. Nothing to re-implement.

## Slice 1 — foundation: validated, attributable writes + two reads

### `POST actions` — body `{ documentId, actions: Action[], wait?: boolean, dryRun?: boolean }`

1. **Lint** (`lib/lint.ts`). Any finding → **400 with the JSON path of each
   problem and nothing dispatched.** Two rule classes, reported with distinct
   codes so the 400 tells the truth about *who* would reject:

   | Class | Rule | Source of truth |
   |---|---|---|
   | `REACTOR_REJECTS` | enum-typed input fields (`SourceOrigin`, `LinkType`, `MocTier`, `ObservationCategory`, `SourceType`, `SourceStatus`, `HealthStatus`, `HealthCategory`, `PipelineDepth`, `GoalStatus`, the scope-of-work `*Input` enums, `Unit` = `StoryPoints\|Hours`) | the models' **generated zod input schemas** (`document-models/*/v1/gen/schema/zod.ts`) — reuse them, do not hand-list; verify they are exported from the barrels |
   | `REACTOR_REJECTS` | knowledge-note `description.length ≤ 200` (UTF-16 units); `SET_METADATA_FIELD.field` whitelist **per model** (knowledge-note: 18 fields + 9 list fields; **moc: only `"version"`**, `moc-management.ts:108`); lifecycle guards (`SUBMIT` from DRAFT, `APPROVE`/`REJECT` from IN_REVIEW, `ARCHIVE` from CANONICAL, `RESTORE` from ARCHIVED, `APPROVE` actor ≠ author); `PATCH_CONTENT.offset ≥ 0`; scope-of-work bounds (`workProgress.percentage` 0–100, non-negative budgets/margins/expenditure/quantities); `SET_GOAL_STATUS` BLOCKED ⇒ non-blank `blockReason`; `ADD_DELIVERABLE_IN_SET` exactly one of `milestoneId\|projectId` | the reducers (`document-models/*/v1/src/reducers/*.ts`) — hand rules, each with the reactor's error class name |
   | `VAULT_CONVENTION` | `noteType` ∈ the ten lowercase values; `taskType` ∈ `claim\|enrichment`; phase names; literal `\n`/`\t` in strings unless `allowLiteralEscapes` | `AGENT.md` — these fields are `String!` and **the reducers do not check them** (`SET_NOTE_TYPE` stores whatever arrives; a foreign `taskType` yields a task that can never advance) |

   State-dependent guards (lifecycle, task ids) are linted against the
   document's current state, which the route has anyway for the read-back.

2. **Stamp** (`lib/envelope.ts`): `id` = UUID, `timestampUtcMs` = now, per
   action, only when absent. Safe on **signed** actions too: the signature
   covers `sha256(scope + type + JSON.stringify(input))` — not `id`, not
   `timestampUtcMs` (`switchboard-cli/src/identity.rs:15-22`, mirroring
   `@renown/sdk`). Consequence: **forward `input` byte-for-byte** — key order
   is part of the hash; never normalise or re-serialise it.
3. **Attribution.** If an action carries `context.signer`, require
   `signer.user.address === ctx.user.address` (403 otherwise, supreme admin
   excepted) and dispatch it untouched — the operation is recorded as the
   agent's key, exactly as `docs apply` does today. If absent, the write is
   host-signed; the response says so (`attribution: "server"`). This is the
   line that lets the plugin — whose `pre-write-identity.py` hook **blocks
   unsigned writes** — replace `docs apply` without losing the Activity view's
   "powerhouse-knowledge · did:key for 0x…" line.
4. **Authorize** (`lib/authorize.ts`): as the table above.
5. **Dispatch** through `this.reactorClient.execute(id, "main", actions,
   ctx.signal, { address: ctx.user.address, key: ctx.user.appKey })` — or
   `executeAsync` + `waitForJob` when `wait` — the same path the CLI's
   `executeAsync` takes. `dryRun: true` → `evaluateActions(...)` instead and
   return its per-action allow/deny with reasons (check during implementation
   whether it also exercises reducers; if not, say so in the response).
6. **Read back** the operations since the prior revision
   (`getOperations(id, undefined, { sinceRevision })`) and return them:
   `{ revision, attribution, operations: [{ index, type, error }] }`. A
   reducer rejection the reactor recorded is reported *by us*, per action —
   the exact thing the plugin's `post-apply-check.py` does client-side today.
7. `maxBodyBytes` 2 MiB (default is 1 MiB; a source body fits, a runaway loop
   does not). Several documents in one call: `executeBatch` exists — check its
   request shape before promising it.

### `POST / PATCH / DELETE relationships` — body `{ source, target, type, reason?, confidence? }`

`docs link` is a signed `ADD_RELATIONSHIP` on the source document with
`{ reason, confidence }` metadata — **not** a document action, so `POST
actions` cannot carry it and `IReactorClient.addRelationship` cannot carry the
metadata. The route builds the action as the CLI does and dispatches it through
step 3–6 above. `lib/articulation.ts` enforces the plugin's rule server-side
(`hooks/pre-link-articulation.py`): `RELATES_TO | BUILDS_ON | CONTRADICTS |
SUPERSEDES | DERIVED_FROM` need a `reason` of ≥ 20 characters that is not a
placeholder (`because`, `todo`, `tbd`, …) and not the type name; `CORE_IDEA` /
`CHILD_MOC` may be bare; `confidence ∈ grounded | established | speculative`.
`PATCH` = `UPDATE_RELATIONSHIP` (what `docs annotate` does); `DELETE` = remove.
Idempotent on `(source, target, type)`, like the reactor.

### `GET search?q=&mode=hybrid|semantic&limit=6&content=1`

Calls the extracted `searchWithEmbedding` (see *Prerequisite extraction*) —
do not re-implement; returns `similarity`, `matchedBy`, and `content` when
asked. `Accept: text/markdown` renders the hits as a markdown digest for agents
that paste tool output straight into context.

### `GET notes/:id` / `GET notes/:id.md`

JSON state, or markdown with YAML frontmatter (`title, description, noteType,
status, topics, provenance, links`) in the same shape as
`data/methodology/*.md`, so a note is readable by Obsidian and by any LLM
without a client. Edges come from the graph (`backlinks` / `forwardLinks`
with `reason` / `confidence` from `edge-metadata.ts`), not the legacy
`links[]`. Absolute links use `ctx.transport.baseUrl`.

**Tests:** `lib/lint.ts`, `lib/envelope.ts`, `lib/articulation.ts` are pure —
table-driven vitest against the plugin's fixtures (copy them in) plus the
reducer error classes. Route handlers are tested with a fake `IHttpScope` that
records registrations and a fake `reactorClient`. Two tests that pin the
attribution design: sign an action with a test P-256 key, `POST` it, read the
operation back through `knowledgeGraphHistory` and assert `signerKey` is the
test key; and an `input` with non-alphabetical key order survives the round
trip unchanged. One integration smoke against `ph reactor` with `curl` +
`switchboard docs get` read-back, recorded in the PR.

**Done when:** the knowledge-agent plugin can replace `docs apply --file`
**and `docs link` / `annotate`** with `POST actions` / `POST relationships`,
keeps its signed attribution, and gets *every* rejection as a 4xx line instead
of a silent skip; `AGENT.md`'s golden rule is rewritten to name both safe
paths.

## Slice 2 — discovery, structure and ops (cheap, mostly formatting)

- `GET llms.txt`: title, description, one line per MoC (HUB → DOMAIN → TOPIC)
  linking to `notes/:id.md`; `llms-full.txt` inlines CANONICAL notes and the
  scope-of-work / WBS outlines (`renderScope` / `renderWbs` already emit
  markdown with `[[docId#itemId]]` anchors). Same convention upstream adopted
  for the academy (`apps/academy/llms.txt`).
- `GET health.json`: the singleton health report's last run. `GET badge.svg`:
  PASS/WARN/FAIL, `public`, 5-minute cache header.
- **Structure reads** — all backed by `createGraphQuery(db)`; each is a
  one-line handler once slice 1's plumbing exists:

  | Route | Backing (`query.ts`) | Note |
  |---|---|---|
  | `GET stats`, `GET density` | `stats`, `density` | what `/health` reads |
  | `GET topics`, `GET topics/:name` | `topicStats`, `nodesByTopic` | |
  | `GET notes/:id/similar` · `/links` · `/backlinks` · `/connections?depth=` | `searchSimilar`, `forwardLinks`, `backlinks`, `connections` | the "rich context in two calls" recipe as URLs |
  | `GET orphans`, `GET triangles`, `GET bridges` | `orphanNodes`, `triangles`, `bridges` | bridges is O(V·E) — cap or admin-only |
  | `GET graph.json` | `allNodes` + `allEdges` | for external visualisers |
  | `GET activity?since=`, `GET notes/:id/history` | `activity`, `history` | **privileged** (`canWrite`), as in the GraphQL guard set |
  | `GET embeddings/missing` | `documentIdsWithoutEmbeddings` | health probe |
  | `GET access-map` | `readAccessMap` | admin |
  | `POST admin/reindex` | `reindexDrive` | admin; note reindex **does not re-embed** |

- `POST tasks/:id/claim`: `ASSIGN_TASK` only if the task is unassigned — so
  two agents never take the same queue item. **A read-check-write in the
  handler is not race-free**: `ASSIGN_TASK` today throws only
  `TaskNotFoundError` (`pipeline-queue/v1/src/reducers/queue-management.ts:33`),
  so two concurrent claims both pass the read and both land. The guard belongs
  in the reducer: add `TaskAlreadyAssignedError` (and, in the same change,
  `DuplicateTaskIdError` on `ADD_TASK`, which retires `AGENT.md` rule 5) via
  the two-step model change in `CLAUDE.md` (MCP `ADD_OPERATION_ERROR` +
  reducer + tests ≥ 95 %). The route then answers 409 from the read-back
  rejection, and the CLI gets the same protection for free.

## Slice 3 — a general webhook strategy (GitHub is only the first preset)

**In one sentence:** any external service POSTs the vault an event; the vault
verifies *who sent it*, checks *what that endpoint is allowed to cause*, and
performs that one operation as a recorded, attributable write. "Ingest a
source" is the first such operation, not the design.

### Three layers, each with its own auth

| Layer | Question | Mechanism |
|---|---|---|
| **Sender authentication** | Is this really the provider? | Upstream verifies the signature over the raw bytes per endpoint (`verify` in `policyFor`): `hmac-prefixed` (GitHub), `hmac-timestamped` (Stripe layout, replay window), `hmac`, `token` (Zapier/Make/anything that can set a header), `none`. Dedupe by the provider's delivery id. Unsigned, replayed or oversized → 401 / 200-dup / 413 before our code runs. |
| **Endpoint authorization** | What may this endpoint cause? | Each endpoint is created with a **trigger** (one of the allow-listed operations below) and a **target** (drive, folder, document types). The handler refuses anything outside that declaration. Creating or changing an endpoint is a write to the vault's config document, so **Layer-2 permissions decide who may wire a webhook at all** (MANAGE on the vault). |
| **Attribution** | Who did this, in the record? | Every produced document carries `provenance { author: "webhook:<endpointId>", sourceOrigin: IMPORT, method: "webhook", tool: <provider>, url }`. Whether the *operation signature* also names a service principal is the decision below. |

### The service-principal decision (take it at the start of this slice)

`this.reactorClient` signs unsigned actions with the **host's** key and
`execute` has no signer parameter, so a webhook handler cannot sign "as a
service principal" through it. Two options:

- **(a) Dedicated principal.** Build a second client with
  `ReactorClientBuilder` and an `ISigner` for a vault-webhooks keypair; grant
  its address WRITE on `/sources` and `/ops/queue` only (never supreme admin).
  History tab reads *"vault-webhooks · did:key … for 0x…"*. Costs a keypair
  on the Switchboard and a one-day spike to confirm the builder wires cleanly.
- **(b) Host-signed, truth in provenance.** Zero plumbing; the Activity view
  attributes the write to the Switchboard's identity and only the provenance
  fields name the webhook. This is what the graph-indexer's own automation
  does today (`automation.ts` writes via `client.execute` with no signer).

Default to **(b)** for the first preset, spike **(a)** in the same slice, and
record which one shipped in `docs/http-api.md`.

### The endpoint as configuration

Stored on the vault (proposal: a `webhooks[]` list on `bai/vault-config`;
if it grows, its own `bai/webhook-endpoint` document type), one entry per
endpoint:

```
{ id, name, enabled,
  provider: "github" | "slack" | "generic-token" | …,   // picks the preset
  secretRef: "env:GITHUB_WEBHOOK_SECRET",               // never the secret itself
  trigger: "ingest-source" | "queue-task" | "create-observation" | "advance-phase",
  target: { folder: "/sources", sourceType?: "DOCUMENTATION" },
  rules: [ { when: { "action": "closed", "pull_request.merged": true },
             map:  { title: "pull_request.title", content: "pull_request.body",
                     url: "pull_request.html_url", author: "pull_request.user.login" } } ],
  createdBy: <address>, createdAt }
```

`policyFor(key)` (key = `<driveId>:<endpointId>`) resolves `verify`, `dedupe`,
`methods`, `challengeField` from the preset + the entry, or returns `undefined`
when `enabled` is false — upstream then answers 404 without calling us, so a
disabled endpoint is dark, not merely ignored. **Because `secretRef` is
per-endpoint, `verify` belongs in `policyFor`, not `defaults`**: `defaults`
is fixed at boot, `policyFor` runs on every delivery and sees the current
document. Resolve the ref inside `policyFor`, never cache the plaintext; an
unresolvable ref returns `secret: undefined` and verification refuses the
delivery (a broken secret store then looks like a wrong key — the log line
carries the reason, the response never does). `endpointFor(key).url` is the
token URL the operator pastes into the provider; `list()` / `revoke(key)`
back the Integrations screen — *disable* = `policyFor → undefined` (404,
token kept), *delete* = `revoke` (token gone). `when`/`map` use the same
dot-path notation upstream's `WebhookField` uses, so a new provider whose
payload is JSON is **data, not code**; a preset exists for the ones with
quirks.

### The operations a webhook may cause (the allow-list)

| trigger | what it does | first user |
|---|---|---|
| `ingest-source` | `bai/source` in the target folder → `INGEST_SOURCE` → `EXTRACTING` → `ADD_TASK(claim)` with a fresh UUID after checking for an existing task on the same `documentRef` | GitHub PR merged / release published / issue labelled `knowledge` |
| `queue-task` | re-queue a document (`claim` or `enrichment`) | a docs repo push touching a note's source |
| `create-observation` | `bai/observation` in `/ops` (category from the rule) | uptime monitor, CI failure |
| `advance-phase` | `ADVANCE_PHASE` with the handoff from the payload | an agent runner (CI job) finishing a pipeline phase |
| *(later)* `sow.deliverable-status` | deliverable/goal status on a scope of work | Linear/Jira/GitHub issue closed |

Every trigger writes through slice 1's `lib/envelope.ts` + `lib/lint.ts`, so a
webhook cannot produce the silent-skip class of failure either. Replies: `202
{ produced: [ids] }`, `204` when no rule matched, `422` when a rule matched but
the mapped fields fail lint (logged with the delivery id). Reply first, work
after (upstream's "async" pattern) — providers time out in seconds and retry,
and `dedupe` absorbs the retry.

### Operator surface

Vault app → gear menu → **Integrations** (admin only): the home is already
decided — an entry in `SettingsMenu` / `SETTINGS_ITEMS`
(`editors/knowledge-vault/components/DriveExplorer.tsx:442` / `:532`, auth
spec decision #5). List endpoints (`list()`); create one (provider, trigger,
target, rules); show the URL once; enable/disable; delete (`revoke`); last
delivery (time, event, verdict, produced ids). A small
`vault_webhook_deliveries` table in the **package's** relational namespace
keeps the last N deliveries per endpoint for debugging — id, event, verdict,
produced ids; never headers or bodies. (Core's
`reactor_webhooks.webhook_deliveries` is dedupe-only and not ours to read.)

### Presets to ship first

1. **GitHub** — `hmac-prefixed` on `x-hub-signature-256`, dedupe
   `{ header: "x-github-delivery" }`; rules for `pull_request` (merged),
   `release` (published), `issues` (label `knowledge`). `push` on `docs/**`
   deferred: the payload names files, not contents, so it needs a
   `GITHUB_TOKEN` — decide separately whether that secret belongs on the
   Switchboard.
2. **generic-token** — `token` scheme, `x-webhook-token`; makes
   Zapier/Make/n8n/curl first-class with zero code.
3. **Slack** — **confirmed not to fit `hmac-timestamped`** (Slack signs
   `v0:<ts>:<body>` with the timestamp in a second header; upstream's scheme
   parses `t=,v1=` from one header). Preset omits `verify` and checks the
   signature itself in `onRequest` over `request.raw` — no `nodeRoute` needed.
   Slash commands arrive form-encoded, which core already parses to an
   object; the `url_verification` round is `challengeField: "challenge"` in
   `policyFor` (JSON body).

Operational notes: the provider must reach the Switchboard (hosted; smee/ngrok
locally). **`PUBLIC_URL` must be set on the hosted Switchboard** — without it
`endpointFor().url` is `http://localhost:<port>/webhooks/…`, and
`hasPublicOrigin` will *not* tell you (it is always true on the built-in
server). At `onSetup`, log loudly when `this.http.baseUrl` starts with
`http://localhost` on a non-dev host. Secrets from env via `secretRef`, never
from document state; log delivery id + event, never the signature.

**Done when:** an admin creates a GitHub endpoint in Integrations, pastes the
URL into a repo, merges a PR, and a source in `EXTRACTING` with a queued task
appears attributed to `webhook:<id>`; a replayed delivery is a no-op; a
disabled endpoint answers 404; and adding the generic-token preset for a
Zapier zap needs no code change.

## Slice 4 — vault-native MCP endpoint

`this.http.nodeRoute({ method: ["GET","POST"], path: "mcp", auth: "renown-optional",
handler: (req, res, ctx) => … })` with the MCP Streamable HTTP transport, at
`/api/@powerhousedao/knowledge-note/mcp`. Distinct from core's `/mcp` (generic
document surgery, admin-only): ours has vault semantics. Tools: `search`,
`get_note`, `seed`, `create_note` (through slice-1 validation), `link`
(through the relationship route's articulation rule), `queue_status`,
`health`. Auth inside the handler: `ctx.user` **or** `x-vault-admin-key ===
VAULT_MCP_ADMIN_KEY` — not a custom `RouteAuthorizer`, which would leave
`ctx.user` undefined. A node route has no `maxBodyBytes`: the transport must
bound its own reads. The knowledge-agent plugin then gets tools with vault
semantics instead of generic reactor document surgery, and every write is
validated the same way.

## Slice 5 — later, if wanted

- `GET export.zip` (Obsidian vault) — moves the `/export` skill server-side.
- `GET scopes/:id.md`, `GET wbs/:id.md` — `renderScope` / `renderWbs` already
  produce the markdown (it is what the indexer stores as those nodes'
  `content`); the route is a content-type.
- `POST admin/re-embed` — no manual trigger exists today:
  `backfillMissingEmbeddings` runs detached at processor boot only
  (`processors/graph-indexer/index.ts:164-218`) and `knowledgeGraphReindex`
  does not embed. `POST admin/tensions/scan` — `automation.ts` opens a tension
  only for a *live* `CONTRADICTS`; historical pairs never get one.
  `POST admin/prune-edges` — `pruneNonKnowledgeEdges` as a standalone repair.
- Scope-of-work webhooks: PR merged → deliverable `DELIVERED`, issue closed →
  goal progress on `bai/wbs`; payload recorded as a `bai/observation`.
- Slack slash command / inbound mail parser as further ingestion families —
  same handler, different `verify` block.

## Cross-cutting

- **Disposal:** the host releases the package's scope on unload and shutdown,
  so leaked handles do not break hot-reload. Keep handles for tests and for
  stopping a route while the package stays loaded. What *does* need care:
  registration order (specific before `prefix: true`) and the
  `UnroutableScope` `try/catch` around every `this.http.*` call in `onSetup`.
- **Rate limiting** is not provided by the scope; upstream's position is that
  it belongs in front of the reactor (load balancer / CDN, shared across
  instances). Still put a per-address token bucket in front of `POST actions`
  and `POST relationships` — the failure mode is one runaway agent, and the
  bucket is where the 429 message can tell it what to do.
- **CORS — likely gap, verify before any Connect code calls REST.** Package
  node routes are claimed in a Fastify `onRequest` hook and `reply.hijack()`ed
  (`adapter-http-fastify-*.mjs`), while `@fastify/cors` sets its headers on
  the Fastify reply — which a hijacked raw response never writes. Preflight
  probably works (OPTIONS is not claimed); the actual response probably lacks
  `access-control-allow-origin`. Test with `curl -H 'Origin: …'`; if
  confirmed, `respond.ts` sets the headers itself for allowed origins, and we
  report upstream.
- **Errors:** one JSON envelope `{ error, code, details? }` — a superset of
  core's own `{ error }` (401/404/413/500); never echo request bodies or bearer
  headers (the toast bug we just fixed was a raw client error leaking through).
- **Docs and config:** update `AGENT.md` (golden rule, "Create a note",
  "Relationships") and `skills/cli-reference` once slice 1 lands; add
  `docs/http-api.md` listing every route with its `auth` (both URL spellings)
  — grepping for `"public"` must list every unauthenticated route, as upstream
  intends. Extend `powerhouse.manifest.json` `config` (the auth vars were
  added in `4c5013d`) with `PUBLIC_URL` (webhooks), `VAULT_MCP_ADMIN_KEY`
  (slice 4), the provider secrets referenced by `secretRef`, and mention
  `RESOLVE_CALLER_IDENTITY` (lets a dev host know who is calling while the
  policy stays `OPEN` — the combination these routes want locally).
- **Naming drift:** the auth spec calls the GraphQL guard
  `withCanonicalDriveIds`; it is `withDriveGuards`
  (`subgraphs/knowledge-graph/resolvers.ts:82`). Fix the spec when touching it.

## Risks and open questions

Answered since 2026-09-10 (kept for the record): `REQUIRE_AUTHENTICATED_CALLER`
does **not** gate `/api`; `trustProxy` is always on; `hasPublicOrigin` is always
true on the built-in server (check `PUBLIC_URL` instead); Slack does **not** fit
`hmac-timestamped`; the reactor client cannot sign as another principal per
call; the signature excludes `id`/`timestampUtcMs`.

Still open:

- Dev-line churn: four `6.2.3-dev.*` releases in two days. Pin the stack
  version per slice and re-run the trial before each bump.
- **Service principal for webhook writes** — option (a) or (b) above; the
  `ReactorClientBuilder` spike decides.
- **CORS on hijacked node routes** — likely broken for browser callers;
  unverified.
- `evaluateActions` semantics — authorization-only, or does it run reducers?
  Decides how much `dryRun` can promise.
- Whether the generated zod input schemas are exported from the
  `document-models/<name>` barrels (if not, `lint.ts` imports the `gen/`
  module directly — read-only, never edited).
- `push`-event content fetch needs a `GITHUB_TOKEN` with `contents:read`;
  decide whether that secret belongs on the Switchboard at all, or whether
  doc-push ingestion waits for a GitHub App.
- Our own tension: the vault app runs Connect as a *thin client* (SYNC_NOTHING)
  — nothing here depends on sync, which is the point, but a route that writes
  must go through the reactor, not the graph index.

## Suggested order

1. Pin the stack (`6.2.3-dev.4` today; own commit per bump) →
2. prerequisites: extract `searchWithEmbedding`; add the two pipeline-queue
   reducer guards (`TaskAlreadyAssignedError`, `DuplicateTaskIdError`) via the
   MCP model change →
3. slice 1 (`actions`, `relationships`, `search`, `notes`) →
4. slice 2 (`llms.txt`, health, structure reads, `tasks/:id/claim`) →
5. slice 3 (registry + GitHub and generic-token presets; principal decision) →
6. slice 4 → 7. the rest as needed.

Slices 1–2 are a few days; 3 is one day plus deployment plumbing (`PUBLIC_URL`,
secrets); 4 depends on how much of the plugin's skill logic moves server-side.

## Appendix — what was verified on 2026-09-11, and where

| Claim | Read from |
|---|---|
| Installed stack `6.2.3-dev.3` = npm `dev` dist-tag; published 2026-09-11 07:04 UTC | `package.json`, `node_modules/@powerhousedao/*/package.json`, `npm view @powerhousedao/reactor-api dist-tags time` |
| `feat/vault-authorization` merged | `git branch --merged HEAD`; `git log HEAD..feat/vault-authorization` empty |
| HTTP API commits: `235829f`, `ee06213` (feature), `e3f7792` (`ctx.user`); none later under `src/http` | GitHub commits API, `path=packages/reactor-api/src/http`, `since=2026-09-10T09:00Z`; `main` = `e4d590b` |
| `IHttpScope`, `RouteContext`, `RouteAuth`, webhook types | `@powerhousedao/shared/dist/types-*.d.ts` ~966–1109, 1119–1139 (`IProcessorHostModuleBase.http?`) |
| `#authenticate` semantics; 1 MiB default; `routeParams` join; `trustProxy: true`; `resolvePublicOrigin`; `REQUIRE_AUTHENTICATED_CALLER` → `graphqlManager.init` only; core `/mcp` authorizer | `@powerhousedao/reactor-api/dist/index.mjs` ~802–830, 590–600, 7397, 7704, 7935–7949, 8131–8145 |
| Webhook delivery order, 503 when unloaded, `list`/`revoke`, store tables, form-body parsing, header redaction | same file ~1079–1350 (`webhook-service.ts`, `webhook-store.ts`) |
| Hijacked node routes vs `@fastify/cors` | `@powerhousedao/reactor-api/dist/adapter-http-fastify-*.mjs` ~45–75, 115–142 |
| `BaseSubgraph.http`, `assertCan*`, `resolveCanonicalDocumentId`; `IAuthorizationService.canMutate/canCreate` | `@powerhousedao/reactor-api/dist/index.d.mts` 265–288, 766–880 |
| `IReactorClient` methods, `AuthSubject`, `ActionEvaluations`, `JobInfo`, `OperationFilter`; single `ISigner` on `ReactorClient` | `@powerhousedao/reactor/dist/index.d.ts` 1983–2270, 3780, 5031; `@powerhousedao/shared/dist/index-*.d.ts:187` |
| Signature covers `scope+type+JSON.stringify(input)`; signed path = `executeAsync`; `prevStateHash` empty | `switchboard-cli/src/identity.rs:15-22`, `src/cli/docs.rs:1683-1760` |
| Plugin rules ported: lint enums, articulation (≥ 20 chars, placeholders), identity block, post-apply read-back | `powerhouse-knowledge/scripts/lint-actions.mjs`, `hooks/pre-link-articulation.py`, `hooks/pre-write-identity.py`, `hooks/post-apply-check.py` |
| GraphQL surface: 30 queries + 2 mutations, no subscriptions; `withDriveGuards`; private `searchWithEmbedding` | `subgraphs/knowledge-graph/schema.ts`, `resolvers.ts:48-55, 82-111, 131, 511-545` |
| Indexer capabilities: tables, `createGraphQuery`, `renderScope`/`renderWbs`, boot-only backfill, live-only tension automation, `module.http` unused | `processors/graph-indexer/{migrations,query,work-outline,index,automation,factory}.ts` |
| Reducer constraints and unvalidated `String!` fields (`noteType`, `taskType`); per-model metadata whitelist; no `ASSIGN_TASK` guard | `document-models/*/v1/schema.graphql`, `document-models/*/v1/src/reducers/*.ts` (knowledge-note `content.ts:17-102`, `lifecycle.ts`; moc `moc-management.ts:108`; pipeline-queue `queue-management.ts:9,33`) |
| Integrations home | `editors/knowledge-vault/components/DriveExplorer.tsx:442,532`; `docs/superpowers/specs/2026-09-09-vault-authorization-design.md` §10 |
| Manifest `config` precedent | `powerhouse.manifest.json`, commit `4c5013d` |
| `dev.4` (2026-09-12): tag `v6.2.3-dev.4` → `457b5f8`; no `src/http` / `processors/http.ts` commits since `dev.3`; `tsc`, lint, 1210 tests and build green after the upgrade | GitHub compare/commits API; `bun run tsc\|lint\|test\|build` |
