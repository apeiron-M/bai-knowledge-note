# Vault HTTP surface — slice 1 design

Status: proposed · 2026-09-13
Branch: `feat/http-surface`
Parent plan: [`docs/plans/http-surface.md`](../../plans/http-surface.md) — this document narrows it to slice 1 and corrects it against the running stack.
Scope: **slice 1 implemented; extended by owner direction (2026-09-13) to carry the atomic claim guard and slice 2** (see `docs/superpowers/plans/2026-09-13-http-surface-slice1.md` Tasks 14–19). The `powerhouse-knowledge` plugin is not touched in this branch.

## Goal

Give the vault a validated, attributable HTTP write path and two LLM-shaped reads, served by the
Switchboard under `/api/@powerhousedao/knowledge-note/…`:

- `POST actions` — a batch of document actions that is linted before dispatch, stamped, attributed,
  authorized, dispatched, and read back, with every rejection surfaced as a response line.
- `POST` / `PATCH` / `DELETE relationships` — the `docs link` / `annotate` / `unlink` operations,
  including the articulation rule (a reason on the edge) enforced server-side.
- `GET search` — semantic/keyword search with content inline, plus a markdown rendering.
- `GET notes/:id` and `GET notes/:id.md` — JSON state with graph edges, or markdown with
  YAML frontmatter and absolute links.

## Non-goals

- Replacing GraphQL. The editors, subscriptions and analytical reads stay on the existing
  subgraphs; REST and GraphQL call the same helpers.
- Plugin changes (`AGENT.md`, skills, hooks) — proven separately, per the scope decision.
- `dryRun` — `evaluateActions` is unavailable on this reactor (see findings).
- Rate limiting, webhooks, MCP, `llms.txt`, health/badge, structure reads — later slices.
- Public/anonymous access to protected content.

## What the live probe established

Run on 2026-09-13 against the running `ph vetra` reactor (stack `6.2.3-dev.4`, vault drive
`cf9b51d2-2915-45be-be2c-0ad939bfc1ae`). Test artefacts: a `bai/source`
(`03cfe1ab-5beb-4add-823f-17dfb7ff8a7b`, left in `/sources`, status `INBOX`, documenting the
experiment) and three scratch notes, all deleted.

### The four silent failure classes on the raw path

| # | Trigger | API response | Operation log | State |
|---|---|---|---|---|
| 1 | Reducer throws (`REMOVE_EXTRACTED_CLAIM` unknown ref) | HTTP 200, success payload | `error: "Claim … is not listed on this source"` | unchanged; **sibling actions still applied** |
| 2 | Zod input rejection (`SET_SOURCE_STATUS: "BOGUS_STATUS"`, missing required field) | HTTP 200, success payload | `error` = zod issue with allowed values/paths | unchanged |
| 3 | Unknown action type (`NOT_A_REAL_ACTION`) | HTTP 200, success payload | **`error: null`, `skip: 0`** — pure no-op | unchanged |
| 4 | Convention violation (`SET_NOTE_TYPE: "WRONG_CASE"`) | HTTP 200, success payload | no error | **persisted in state** |
| 5 | Knowledge-note description > 200 chars | HTTP 200, success payload | `error: "Description exceeds 200 characters"` | unchanged |

A missing `id` / `timestampUtcMs` / `scope` is refused **before dispatch** by `mutateDocument`'s
hand-written guard (`reactor-api/dist/index.mjs` `validateActionStructure`), but as a GraphQL
`errors` payload with `code: INTERNAL_SERVER_ERROR` and `data: null` — not a 4xx.
Scope mismatches fail the whole job after 4 retries with a GraphQL error.

### Other findings

- **Per-action isolation is real**: one rejected action does not roll back its batch — the actions
  before and after it land. The comments claiming whole-batch rollback in
  `editors/shared/remote-reactor.ts:122-124` and `scripts/drive-sync/lib/gql.py` are stale.
- **Relationship actions require `scope: "document"`**. `ADD_RELATIONSHIP` / `UPDATE_RELATIONSHIP` /
  `REMOVE_RELATIONSHIP` in `global` fail the job after 4 retries. With `document` scope, the full
  lifecycle works, including `metadata: { reason, confidence }`, indexed and readable through
  `knowledgeGraphForwardLinks` within ~1 s.
- The native `addRelationship` GraphQL mutation creates edges **without metadata** (`reason: null`);
  there is no native mutation for `UPDATE_RELATIONSHIP`.
- **Raw writes are host-signed.** Without `context.signer`, operations record
  `signerApp: "switchboard"`, the server's `did:key`, and the caller's address — the plugin's
  "powerhouse-knowledge · did:key for 0x…" attribution is not reproduced by bearer alone.
- **`evaluateActions` is unavailable**: `AUTH_EVALUATION_UNSUPPORTED` — the reactor runs without
  the `authEnforcement` feature flag. `dryRun` is cut from slice 1.
- **HTTP scope verified live**: `/api/@powerhousedao/knowledge-note/ping` and the
  `%40` spelling (`/api/%40powerhousedao/knowledge-note/…`; only the `@` is encoded — the slash
  stays literal) both reach the mounted namespace (404 "Cannot GET" — no routes yet).
  `ph generate subgraph` scaffolds a GraphQL subgraph; there is no HTTP-specific generator — HTTP
  endpoints are code registered in `onSetup()`.
- All planned reads have working GraphQL backing today (stats/density/topics/orphans/triangles/
  bridges/edges/nodes/activity/history/missing-embeddings/access-map), latencies 74 ms–2.5 s;
  whole-graph reads are heavy (`knowledgeGraphEdges` = 1.46 MB, `knowledgeGraphNodes` = 223 KB).
  `llms.txt`, `badge.svg`, and webhooks have no GraphQL equivalent.

## Architecture

### The subgraph

`subgraphs/http/` is scaffolded with `ph-cli generate subgraph --name http`, which emits
`index.ts` / `schema.ts` / `resolvers.ts` / `lib.ts` and appends `HttpSubgraph` to the
codegen-owned `subgraphs/index.ts` barrel. The generated GraphQL surface stays minimal
(`type Query { http: HttpQueries! }` placeholder): `BaseSubgraph` requires `typeDefs` and
`resolvers`, and preserving the scaffold keeps `ph generate all` idempotent. The subgraph is
REST-only in use.

`onSetup()` is the single route registry. Every `this.http.*` call is wrapped in one `try/catch`,
because an `UnroutableScope` throws on registration and must not take the GraphQL surface down.
`onDisconnect()` stays empty — the host disposes the whole scope when the package unloads.

```
subgraphs/http/
  index.ts              scaffold: HttpSubgraph, minimal typeDefs/resolvers, onSetup() registry
  schema.ts             scaffold placeholder (untouched)
  resolvers.ts          scaffold placeholder (untouched)
  lib.ts                scaffold placeholder (untouched)
  routes/
    actions.ts          createActionsRoute(deps)        → POST actions
    relationships.ts    createRelationshipsRoute(deps)  → POST/PATCH/DELETE relationships
    search.ts           createSearchRoute(deps)         → GET search
    notes.ts            createNotesRoute(deps)          → GET notes/:id, notes/:id.md
  lib/
    deps.ts             HttpRouteDeps — narrow interface the handlers receive
    envelope.ts         stamp id/timestampUtcMs only when absent
    lint.ts             REACTOR_REJECTS + VAULT_CONVENTION rule classes
    articulation.ts     reason/confidence rules for knowledge edges
    authorize.ts        assertCanRead/Write, resolveCanonicalDocumentId, canMutate wrappers
    respond.ts          one JSON error envelope + status mapping
```

### Dependency injection

Each route is a factory taking `HttpRouteDeps`:

```ts
export interface HttpRouteDeps {
  reactorClient: {
    get(id, view?, signal?): Promise<DocumentRecord | undefined>;
    executeAsync(id, branch, actions, signal?, subject?): Promise<{ id: string }>;
    waitForJob(jobId: string): Promise<unknown>;
    execute(id, branch, actions, signal?, subject?): Promise<DocumentRecord>;
    getOperations(id, view?, filter?, paging?): Promise<{ items: OperationRecord[] }>;
  };
  resolveCanonicalDocumentId(identifier: string, requestKey: unknown): Promise<string>;
  assertCanRead(identifier: string, ctx: RouteContext): Promise<string>;
  assertCanWrite(identifier: string, ctx: RouteContext): Promise<string>;
  authorization: {
    canWrite(canonicalId: string, address: string): Promise<boolean>;
    canMutate(canonicalId: string, actionType: string, address: string): Promise<boolean>;
    isSupremeAdmin(address: string): Promise<boolean>;
  };
  getQuery(driveId: string): GraphQuery;
  search: SearchWithEmbedding;
  now(): Date;
  uuid(): string;
}
```

`onSetup()` passes the live subgraph; tests pass fakes. Handlers never reach past this interface.

### Prerequisite extraction

Move `searchWithEmbedding` (`subgraphs/knowledge-graph/resolvers.ts:131-178`) and the HYBRID
keyword fallback (`:530-545`) into `subgraphs/knowledge-graph/helpers/search.ts`. The resolver
imports them; `routes/search.ts` calls the same function. No duplication, no drift.

### Namespace and build

- URL: `<basePath>/api/@powerhousedao/knowledge-note/<path>`, plus the host-registered
  `/api/%40powerhousedao/knowledge-note/<path>` spelling (only `@` percent-encoded; the slash
  stays literal).
- Routes match in registration order; registering the same method+path twice throws.
- Subgraphs load from built output: every change requires `bun run build` and a Switchboard
  restart before it is visible.

## Write path

### `POST actions`

Body: `{ documentId: string, actions: Action[], wait?: boolean, allowLiteralEscapes?: boolean }`.
`allowLiteralEscapes` is the server-side equivalent of the CLI's `--allow-literal-escapes`: with
it, the `VAULT_CONVENTION` literal-`\n` check is skipped.

`POST actions` targets **existing** documents: creation and upgrade base actions
(`CREATE_DOCUMENT`, `UPGRADE_DOCUMENT`) are out of scope and are linted as unknown, so a slice-1
caller cannot create a document through this route. The three relationship base actions
(`ADD_RELATIONSHIP`, `UPDATE_RELATIONSHIP`, `REMOVE_RELATIONSHIP`) are recognized by the lint — no
model defines them — and validated by the relationship route.

Pipeline, in order — steps 1–6 refuse before anything is dispatched:

1. **Shape** — body parses; `documentId` is a string; `actions` is a non-empty array → else 400.
2. **Identity and document** — `ctx.user` required (the `renown` mode alone does not guarantee it
   when host auth is off); `resolveCanonicalDocumentId`; `assertCanWrite` → 401/403/404.
3. **Lint** (`lib/lint.ts`) — findings → 400 with every finding's JSON path and rule code; nothing
   dispatched. Two classes, reported with distinct codes:
   - `REACTOR_REJECTS` — the reactor would refuse or silently skip the action:
     - `UNKNOWN_ACTION`: the action type must exist in the target model's operation set.
     - `INVALID_INPUT`: reuse the model's generated zod schema
       (`document-models/<name>` barrel exports `gen/schema/zod.js`), returning issue paths.
     - Hand rules keyed by model and guarded by current state: knowledge-note
       `description.length ≤ 200` (UTF-16 units), `SET_METADATA_FIELD` whitelists (18 string + 9
       list fields for knowledge-note; only `"version"` for moc), lifecycle guards (`SUBMIT` from
       `DRAFT`, `APPROVE`/`REJECT` from `IN_REVIEW`, `ARCHIVE` from `CANONICAL`, `RESTORE` from
       `ARCHIVED`, `APPROVE` actor ≠ author), `PATCH_CONTENT.offset ≥ 0`, scope-of-work bounds
       (`workProgress.percentage` 0–100, non-negative amounts), `SET_GOAL_STATUS` BLOCKED requires
       a non-blank `blockReason`, `ADD_DELIVERABLE_IN_SET` exactly one of `milestoneId|projectId`.
   - `VAULT_CONVENTION` — valid to the reactor, wrong for the vault: `noteType` one of the ten
     lowercase values; `taskType ∈ claim|enrichment`; phase names; literal `\n`/`\t`/`\r` in
     strings unless `allowLiteralEscapes`. These are `String!` fields the reducers do not check.
4. **Stamp** (`lib/envelope.ts`) — set `id` (UUID) and `timestampUtcMs` (now) only when absent;
   `input` is forwarded byte-for-byte (key order is part of the signature hash).
5. **Attribution** — if an action carries `context.signer`, require
   `signer.user.address === ctx.user.address` (403 otherwise; supreme admin excepted) and forward
   it untouched; otherwise the action is host-signed. Each result reports
   `attribution: "agent" | "server"`.
6. **Per-action authorization** — `canWrite(canonicalId, address)`; for lifecycle operations
   (`SUBMIT_FOR_REVIEW`, `APPROVE_NOTE`, `REJECT_NOTE`, `ARCHIVE_NOTE`, `RESTORE_NOTE`)
   additionally `canMutate(canonicalId, actionType, address)`. A refusal lists the refused action
   indexes.
7. **Dispatch** — `executeAsync` + `waitForJob` by default (the CLI's path); `execute` when
   `wait: false`. `ctx.signal` is passed through. `maxBodyBytes` = 2 MiB.
8. **Read back** — capture the document's current revision before dispatch, then
   `getOperations(canonicalId, undefined, { sinceRevision })`; respond with
   `{ revision, attribution, operations: [{ index, type, error }] }`. Every reactor rejection is
   reported per action — this is the contract that replaces the silent-skip behaviour.

### `POST` / `PATCH` / `DELETE relationships`

- Body: `{ source: string, target: string, type: string, reason?: string, confidence?: string }`.
- `POST` builds an `ADD_RELATIONSHIP` action:
  `{ sourceId, targetId, relationshipType, metadata: { reason, confidence } }`, **scope
  `"document"`**, stamped by `lib/envelope.ts`, then follows the same steps 2, 3 (articulation),
  5, 6, 7, 8 as `POST actions`.
- `PATCH` builds `UPDATE_RELATIONSHIP`; `DELETE` builds `REMOVE_RELATIONSHIP`.
- `lib/articulation.ts`: `RELATES_TO | BUILDS_ON | CONTRADICTS | SUPERSEDES | DERIVED_FROM`
  require a `reason` of ≥ 20 characters that is neither a placeholder (`because`, `todo`, `tbd`,
  …) nor the link-type name; `CORE_IDEA` / `CHILD_MOC` may be bare; `confidence` ∈
  `grounded | established | speculative` when present.
- Authorization is checked on the **source** document (the edge is recorded there).
- Repeated `POST` for the same `(source, target, type)` is a reactor no-op, metadata included;
  metadata changes are `PATCH`.

## Read path

### `GET search`

- Params: `q` (required), `drive` (required; document UUID — the graph index is namespaced per
  drive), `mode=hybrid|semantic` (default `hybrid`), `limit` (default 6, max 25),
  `content=1`, `includeArchived=1`.
- Backed by the extracted `searchWithEmbedding` — the same function the GraphQL resolver calls.
- JSON: `{ query, mode, hits: [{ similarity, score, matchedBy, node }] }` with
  `node = { documentId, title, description, content?, noteType, status, documentType }`.
  `similarity` is 0–1 in both modes; `score` is raw and never rendered as a percentage. Per-hit
  `topics` is deliberately not selected (per-row resolver).
- `Accept: text/markdown` renders the hits as a ranked markdown digest.
- Auth: `renown`, `ctx.user` required, `assertCanRead` on the canonical drive.

### `GET notes/:id` and `GET notes/:id.md`

- JSON: document state plus `forwardLinks` and `backlinks` with `reason` / `confidence` read from
  the graph index — explicitly not the legacy `links[]` array.
- Both forms take `drive` (required; the index is per drive) and an `id` that is a document UUID;
  slug resolution is deferred. Markdown links carry `?drive=`.
- Markdown: YAML frontmatter (`title, description, noteType, status, topics, provenance, links`)
  in the `data/methodology/*.md` convention, body = `content`. Edges render as absolute links
  built from `ctx.transport.baseUrl` pointing at `notes/<target>.md`.
  `Content-Type: text/markdown; charset=utf-8`.
- Two registrations in this order: `notes/:id.md` first (the specific form), then `notes/:id`;
  the `.md` handler strips the suffix before the document lookup.
- The renderer is generic: knowledge-notes get full frontmatter; other indexed types get
  `{ id, name, documentType, status }` plus `content` when the model has one.
- Auth: `renown`, `ctx.user` required, `assertCanRead`; unknown or unreadable ids are a uniform
  404.

## Error handling

`lib/respond.ts` emits one envelope: `{ error, code, details? }` (superset of core's `{ error }`).

| Status | Code | When |
|---|---|---|
| 400 | `LINT_REACTOR` / `LINT_CONVENTION` | lint findings; `details = [{ path, rule, message }]` |
| 401 | `UNAUTHENTICATED` | `ctx.user` missing |
| 403 | `FORBIDDEN` | permission refusal; lists refused action indexes |
| 404 | `NOT_FOUND` | unknown or unreadable document |
| 413 | `BODY_TOO_LARGE` | host body cap |
| 500 | `INTERNAL` | otherwise; never echoes bodies, bearers, or signature material |

Reactor errors are mapped (`DocumentNotFoundError` → 404, permission refusals → 403), never passed
through raw.

**CORS:** the plan flags that hijacked node routes likely bypass `@fastify/cors`. The smoke test
sends an `Origin` header and checks whether the response carries `access-control-allow-origin`; if
it does not, `respond.ts` sets it for allowed origins and we report upstream. No speculative code
before the check.

## Testing

- **Pure libs, table-driven vitest**: `envelope` (stamp only when absent; non-alphabetical `input`
  key order survives unchanged), `lint` (one case per rule and per reducer error code; fixtures
  adapted from the plugin's `scripts/lint-actions.mjs` and `hooks/pre-apply-lint.py`),
  `articulation` (all seven types, placeholder reasons, each confidence value).
- **Route tests with fakes** (new helpers `tests/helpers/fake-http-scope.ts` and
  `tests/helpers/fake-reactor-client.ts`): refusal before dispatch (assert `execute` is never
  called, 400 shape), read-back surfaces recorded op errors, signed-vs-server attribution branch,
  relationships stamping `scope: "document"` and returning 400 on a bare knowledge edge.
- **Integration smoke** (manual, recorded in the PR): against the running `ph vetra` reactor after
  `bun run build` + restart — `POST actions` source write + read-back, relationship lifecycle with
  reason/confidence, `GET search`, `GET notes/:id.md`, verified with a graph read.
- **Coverage**: add `subgraphs/http/lib/**` to `vitest.config.ts` coverage `include` (reducers
  stay as they are), targeting 100% on the pure modules so the 95% aggregate cannot regress. Add
  the missing `test:coverage` script (`vitest run --coverage`).

## Definition of done

- `HttpSubgraph` registered; all seven route registrations (actions; relationships POST/PATCH/
  DELETE; search; `notes/:id.md`, `notes/:id`) answer under both namespace spellings.
- `bun run tsc`, `bun run lint:fix`, `bun run test` green; `bun run build` succeeds and the
  rebuilt subgraph loads on restart.
- Live smoke passes, including the regression case: the batch that previously returned HTTP 200
  with a silently rejected action now returns 400 with that action's path and dispatches nothing.
- `docs/http-api.md` written (every route, its `auth`, both URL spellings); the stale claims in
  `docs/plans/http-surface.md` corrected (scope `"document"`, `dryRun` unavailable, unknown-action
  no-op, stale editor line references, per-action isolation comment).

## Deferred (explicit)

Plugin changes, `dryRun`, rate limiting, webhooks + triggers + presets, MCP endpoint,
`llms.txt`, health/badge, structure reads, `tasks/:id/claim` and its reducer guards.

## References

- Parent plan: `docs/plans/http-surface.md`.
- Stack sources (main @ `6.2.3-dev.5`): academy `03-Build/04-WorkWithData/07-HostingHttpRoutes.md`;
  `reactor-api/src/http/{route-service,namespace,types}.ts`; `reactor-api/src/graphql/{graphql-manager,types}.ts`;
  `codegen/src/templates/subgraphs/`; `vetra/document-models/subgraph-module/v1/schema.graphql`.
- Installed dist checked at `6.2.3-dev.4`: `validateActionStructure`, `UnroutableScope`,
  `scopeForOrNull`, `IHttpScope`.
