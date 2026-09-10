# Plan: the vault's HTTP surface — safe agent writes, LLM-readable notes, inbound ingestion

Status: proposed · 2026-09-10
Owner: liberuum
Prereqs: Powerhouse stack ≥ `6.2.3-dev.0` (per-package HTTP routes + webhooks;
trial upgrade of this repo to `6.2.3-dev.2` compiles, tests and builds —
see `docs/upstream-bugs-6.2.2-dev.85.md` for the verification method);
`feat/vault-authorization` landed (Layer-2 permissions, `subgraphs/access`).

## Goal

Give the vault a REST/webhook surface of its own, served by the Switchboard
under `/api/@powerhousedao/knowledge-note/…`, so that:

1. **Agent writes are safe by construction.** Today `AGENT.md`'s golden rule
   is "read however you like, write ONLY through the CLI", because one raw
   action without `id` + `timestampUtcMs` bricks sync for every client and the
   reactor skips invalid actions *silently* while the job reports success. A
   validated `POST actions` route stamps the envelope, lints every action the
   reactor's way, and answers 4xx — before anything is dispatched.
2. **Knowledge is served the way LLMs and tools consume it.** One `GET` for a
   search with content inline; one `GET` for a note as markdown-with-frontmatter;
   `llms.txt` for discovery.
3. **Any service can trigger a vault operation, under the same auth.** One
   webhook strategy — endpoints are configuration, providers are presets, the
   operations an endpoint may cause are an allow-list — with GitHub as the
   first preset. A merged PR does what *Queue for Processing* does; the
   pipeline runs.

## What upstream shipped (the facts the design rests on)

Read from `packages/shared/processors/http.ts`, `reactor-api/src/http/*` and
the academy guides `07-HostingHttpRoutes.md` / `08-ReceivingWebhooks.md`
(main @ `4f706b7`).

- **One `IHttpScope` per package**, namespaced by npm name:
  `https://<host>/api/@powerhousedao/knowledge-note/<path>`. A subgraph reads
  it as `this.http` (register in `onSetup()`); a processor receives it in its
  constructor as `IHttpScope | undefined` — **`undefined` in browser hosts**, so
  everything here is Switchboard-only. Handlers are Fetch-shaped:
  `(request: Request, ctx: RouteContext) => Response`.
- **Auth is identity, not authorization.** `auth: "renown"` (default) requires a
  verifiable bearer and gives `ctx.user = { address, chainId, networkId, appKey }`
  — the same shape as a resolver's `ctx.user`. `"renown-optional"` yields an
  anonymous actor instead of 401. `"public"` skips identity. A custom
  `RouteAuthorizer(req)` covers admin keys. **Per-document permission checks
  remain ours** (`subgraph.authorizationService.canRead/canWrite/canManage`).
- **Bodies:** `parsed` (default), `raw` (bytes on `ctx.rawBody`), `stream`,
  `none`; `maxBodyBytes` → 413. `prefix: true` and `*rest` params for sub-paths.
  `ctx.signal` aborts on client disconnect. `nodeRoute()` is the escape hatch
  for protocols that own the socket (the guide's example is an MCP transport).
- **Webhooks:** `this.http.webhooks.register({ name, defaults?, policyFor?, onRequest })`
  returns `endpointFor(key) → { url }` with token URLs `/webhooks/<32 hex>`
  (never a document id); core verifies HMAC over raw bytes (`token`, `hmac`,
  `hmac-prefixed` = GitHub, `hmac-timestamped` = Stripe), dedupes by a
  sender field (header/body/query), answers provider "challenge" probes, caps
  size, and persists tokens in the reactor DB (`RelationalWebhookStore`), so
  they survive restarts and work behind `switchboard-lb`. Requires the host to
  know its **public origin** (`hasPublicOrigin`).
- Registering the same method+path twice on a scope **throws**; handles must be
  **disposed** on teardown (packages hot-reload).

## Non-goals

- Replacing GraphQL. The graph queries, subscriptions and the Connect editors
  stay on the existing subgraphs; REST is for agents, tools and machines.
- Outbound notifications (vault → Slack etc.). A processor can already `fetch`;
  nothing here changes that.
- Public anonymous access to protected content. `public` is reserved for
  content that is public *anyway* (badge, llms.txt index of a public vault).

## Architecture

```
subgraphs/http/                      ← new subgraph, routes only (scaffold with codegen,
  index.ts                              which registers it in subgraphs/index.ts — never
  routes/                               hand-edit that barrel)
    actions.ts                        POST actions            (slice 1)
    search.ts                         GET  search             (slice 1)
    notes.ts                          GET  notes/:id(.md)     (slice 1)
    llms.ts                           GET  llms.txt, llms-full.txt   (slice 2)
    health.ts                         GET  health.json, badge.svg    (slice 2)
    mcp.ts                            nodeRoute mcp           (slice 4)
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
    envelope.ts                       id + timestampUtcMs stamping (port of the plugin's
                                      scripts/sync-skills.mjs `envelope()`)
    lint.ts                           the reactor's own rejection rules (port of the
                                      plugin's scripts/lint-actions.mjs): description
                                      ≤ 200 UTF-16 units, every enum, literal \n
    authorize.ts                      canRead/canWrite gates around
                                      `subgraph.authorizationService` +
                                      `resolveCanonicalDocumentId` (same helpers
                                      `subgraphs/access/resolvers.ts` uses)
    respond.ts                        one JSON error envelope; never a raw ClientError
```

Why a dedicated subgraph rather than routes on `knowledge-graph`: the REST
surface has its own auth decisions, its own tests, and will be the place the
MCP transport mounts; keeping it apart keeps `knowledge-graph` a pure GraphQL
subgraph. Both get the *same* `IHttpScope` (idempotent per package), so this is
organisation, not isolation.

Every route lives in `dist/node/subgraphs/index.mjs`: **`bun run build` +
restart the Switchboard after each change** (the `CLAUDE.md` gotcha applies to
all of this work).

### Authorization model (applies to every slice)

| Route | `auth` | Then |
|---|---|---|
| `POST actions` | `renown` | `canWrite(canonicalDocId, user.address)` per target document; supreme admin passes; 403 lists the refused ids |
| `GET search`, `GET notes/:id` | `renown` | search runs as the caller: filter hits to documents `canRead` (or call the graph resolvers with the caller's `ctx`, which already gate) |
| `GET llms.txt` | `renown-optional` | anonymous → MoC titles only if the drive is readable anonymously, else 401 hint; signed-in → full index |
| `GET health.json` | `renown` | full report; `badge.svg` is `public` (status word only) |
| webhooks | n/a (signature) | the handler writes as a service identity; **record the sender in provenance** (`author: "github-webhook"`, `sourceOrigin: IMPORT`, url) |
| `mcp` | custom authorizer: renown bearer **or** `VAULT_MCP_ADMIN_KEY` | tools re-use the same gates as the routes |

`REQUIRE_AUTHENTICATED_CALLER` is fetch middleware on the **GraphQL** routes;
verify during slice 1 whether it also covers `/api` (read
`reactor-api/src/server.ts` on the upgraded version). Our routes must not rely
on it either way — the `renown` default is what enforces identity here.

## Slice 1 — foundation: validated writes + two reads

**`POST actions`** — body `{ documentId, actions: Action[], wait?: boolean }`.

1. Lint every action (`lib/lint.ts`): description `.length ≤ 200`; `noteType`,
   `sourceOrigin`, `SourceStatus`, `taskType`, `HealthCategory`, `MocTier`,
   `relationshipType` against the models' enums; strings containing literal
   `\n`/`\t` rejected unless `allowLiteralEscapes`. **Any failure → 400 with
   the JSON path of each problem and nothing dispatched.**
2. Stamp (`lib/envelope.ts`): `id` = UUID, `timestampUtcMs` = now, per action,
   only when absent.
3. Authorize (`lib/authorize.ts`): `canWrite` on the canonical id.
4. Dispatch through `this.reactorClient` (the same path the CLI's `docs apply`
   uses). Then **read back the operations since the prior revision** and return
   them: `{ revision, operations: [{ index, type, error }] }`. A reducer
   rejection the reactor recorded is reported *by us*, per action — the exact
   thing the CLI's PostToolUse hook does client-side today.
5. `maxBodyBytes` 2 MiB (a source body fits; a runaway loop does not).

**`GET search?q=&mode=hybrid|semantic&limit=6&content=1`** — calls the existing
`knowledgeGraphSemanticSearch` logic (import the resolver's implementation, do
not re-implement); returns `similarity`, `matchedBy`, and `content` when asked.
`Accept: text/markdown` renders the hits as a markdown digest for agents that
paste tool output straight into context.

**`GET notes/:id` / `GET notes/:id.md`** — JSON state, or markdown with YAML
frontmatter (`title, description, noteType, status, topics, provenance,
links`) in the same shape as `data/methodology/*.md`, so a note is readable by
Obsidian and by any LLM without a client.

**Tests:** `lib/lint.ts` and `lib/envelope.ts` are pure — table-driven vitest
against the same fixtures the plugin's hook uses (copy them in). Route handlers
are tested with a fake `IHttpScope` that records registrations and a fake
`reactorClient`; one integration smoke against `ph reactor` with `curl` +
`switchboard docs get` read-back, recorded in the PR.

**Done when:** the knowledge-agent plugin can replace `docs apply --file` with
one `POST actions` call and gets *every* rejection as a 4xx line instead of a
silent skip; `AGENT.md`'s golden rule is rewritten to name both safe paths.

## Slice 2 — discovery and ops (cheap, mostly formatting)

- `GET llms.txt`: title, description, one line per MoC (HUB → DOMAIN → TOPIC)
  linking to `notes/:id.md`; `llms-full.txt` inlines CANONICAL notes. Same
  convention upstream adopted for the academy in this release.
- `GET health.json`: the singleton health report's last run. `GET badge.svg`:
  PASS/WARN/FAIL, `public`, 5-minute cache header.
- `POST tasks/:id/claim`: `ASSIGN_TASK` only if the task is unassigned —
  read-check-write in one handler so two agents never take the same queue item.

## Slice 3 — a general webhook strategy (GitHub is only the first preset)

**In one sentence:** any external service POSTs the vault an event; the vault
verifies *who sent it*, checks *what that endpoint is allowed to cause*, and
performs that one operation as a recorded, attributable write. "Ingest a
source" is the first such operation, not the design.

### Three layers, each with its own auth

| Layer | Question | Mechanism |
|---|---|---|
| **Sender authentication** | Is this really the provider? | Upstream verifies the signature over the raw bytes per endpoint (`verify` in `policyFor`): `hmac-prefixed` (GitHub), `hmac-timestamped` (Stripe-style, with replay window), `hmac`, `token` (Zapier/Make/anything that can set a header). Dedupe by the provider's delivery id. Unsigned or replayed → 401/dup before our code runs. |
| **Endpoint authorization** | What may this endpoint cause? | Each endpoint is created with a **trigger** (one of the allow-listed operations below) and a **target** (drive, folder, document types). The handler refuses anything outside that declaration. Creating or changing an endpoint is a write to the vault's config document, so **Layer-2 permissions decide who may wire a webhook at all** (MANAGE on the vault). |
| **Attribution** | Who did this, in the record? | The write runs under a **service principal** — an address for the vault's webhooks, granted explicit WRITE on exactly the folders it needs via the access map, never supreme admin — and every produced document carries `provenance { author: "webhook:<endpointId>", sourceOrigin: IMPORT, method: "webhook", tool: <provider>, url }`. The Activity view and History tab then read like any other signed write. |

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
disabled endpoint is dark, not merely ignored. `endpointFor(key).url` is the
token URL the operator pastes into the provider. `when`/`map` use the same
dot-path notation upstream's `WebhookField` uses, so a new provider whose
payload is JSON is **data, not code**; a preset exists for the ones with quirks
(GitHub's header-borne delivery id, Slack's `url_verification` challenge and
its own signature layout — check fit against `hmac-timestamped` before
assuming).

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
the mapped fields fail lint (logged with the delivery id).

### Operator surface

Vault app → gear menu → **Integrations** (admin only): list endpoints; create
one (provider, trigger, target, rules); show the URL once; enable/disable;
last delivery (time, event, verdict, produced ids). A small `webhook_deliveries`
table in the package's relational DB keeps the last N deliveries per endpoint
for debugging — id, event, verdict, produced ids; never headers or bodies.

### Presets to ship first

1. **GitHub** — `hmac-prefixed` on `x-hub-signature-256`, dedupe
   `{ header: "x-github-delivery" }`; rules for `pull_request` (merged),
   `release` (published), `issues` (label `knowledge`). `push` on `docs/**`
   deferred: the payload names files, not contents, so it needs a
   `GITHUB_TOKEN` — decide separately whether that secret belongs on the
   Switchboard.
2. **generic-token** — a shared-secret header; makes Zapier/Make/n8n/curl
   first-class with zero code.
3. **Slack** — slash command or channel message → `ingest-source`; verify the
   signature layout fits before promising it.

Operational notes unchanged: the provider must reach the Switchboard (hosted;
smee/ngrok locally); `hasPublicOrigin` must be true or `endpointFor` returns a
bare path — fail loudly at `onSetup`; secrets from env via `secretRef`, never
from document state; log delivery id + event, never the signature.

**Done when:** an admin creates a GitHub endpoint in Integrations, pastes the
URL into a repo, merges a PR, and a source in `EXTRACTING` with a queued task
appears attributed to `webhook:<id>`; a replayed delivery is a no-op; a
disabled endpoint answers 404; and adding the generic-token preset for a
Zapier zap needs no code change.

## Slice 4 — vault-native MCP endpoint

`this.http.nodeRoute({ method: ["GET","POST"], path: "mcp", auth, handler:
(req, res) => transport.handleRequest(req, res) })` with the MCP Streamable
HTTP transport. Tools: `search`, `get_note`, `seed`, `create_note` (goes
through the slice-1 validation), `link`, `queue_status`, `health`. The
knowledge-agent plugin then gets tools with vault semantics instead of generic
reactor document surgery, and every write is validated the same way. Auth:
renown bearer or `VAULT_MCP_ADMIN_KEY` via a custom authorizer.

## Slice 5 — later, if wanted

- `GET export.zip` (Obsidian vault), `GET graph.json` for external visualisers
  (moves the `/export` skill server-side).
- Scope-of-work webhooks: PR merged → deliverable `DELIVERED`, issue closed →
  goal progress on `bai/wbs`; payload recorded as a `bai/observation`.
- Slack slash command / inbound mail parser as further ingestion families —
  same handler, different `verify` block.

## Cross-cutting

- **Disposal:** keep every `ScopedRouteHandle` and call `dispose()` in
  `onDisconnect`; registration throws on a duplicate path, so a leaked handle
  breaks hot-reload.
- **Rate limiting** is not provided by the scope: a per-address token bucket in
  front of `POST actions` and `search`.
- **CORS:** the scope owns `OPTIONS`; confirm browser-caller behaviour against
  the guide's "What the scope does not have" before any Connect code calls REST.
- **Errors:** one JSON envelope `{ error, code, details? }`; never echo request
  bodies or bearer headers (the toast bug we just fixed was a raw client error
  leaking through).
- **Docs:** update `AGENT.md` (golden rule, "Create a note" section) and
  `skills/cli-reference` once slice 1 lands; add `docs/http-api.md` listing
  every route with its `auth` — grepping for `"public"` must list every
  unauthenticated route, as upstream intends.

## Risks and open questions

- Dev-line churn: the HTTP API is days old; pin the stack version per slice and
  re-run the trial before each bump.
- `publicUrl` on the hosted Switchboard: webhooks need it; confirm how the
  deployment sets it (`resolvePublicOrigin` in `reactor-api/src/server.ts`,
  `trustProxy: true` behind `switchboard-lb`).
- Whether `REQUIRE_AUTHENTICATED_CALLER` also gates `/api` — verify, don't assume.
- **Service principal for webhook writes:** Layer-2 grants are per address; the
  cleanest attribution is a dedicated address granted WRITE on `/sources` and
  `/ops/queue` only. Confirm the reactor client in a subgraph can dispatch *as*
  that principal (signed with its key) rather than as the server — otherwise
  the writes are server-signed and only the provenance fields carry the truth.
- Slack's signature layout (`v0=` over `v0:<ts>:<body>`, timestamp in a second
  header) may not fit `hmac-timestamped`; a custom verifier via `nodeRoute`
  is the fallback.
- `push`-event content fetch needs a `GITHUB_TOKEN` with `contents:read`;
  decide whether that secret belongs on the Switchboard at all, or whether
  doc-push ingestion waits for a GitHub App.
- Our own tension: the vault app runs Connect as a *thin client* (SYNC_NOTHING)
  — nothing here depends on sync, which is the point, but a route that writes
  must go through the reactor, not the graph index.

## Suggested order

1. Upgrade the stack (own commit) → 2. slice 1 → 3. slice 2 → 4. slice 3
(registry + GitHub and generic-token presets) → 5. slice 4 → 6. the rest as needed. Slices 1–2
are a few days; 3 is one day plus deployment plumbing; 4 depends on how much of
the plugin's skill logic moves server-side.
