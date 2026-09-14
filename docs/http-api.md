# Vault HTTP API

The `subgraphs/http` subgraph serves these routes on the Switchboard under the package
namespace:

```
<origin>/api/@powerhousedao/knowledge-note/<path>
<origin>/api/%40powerhousedao/knowledge-note/<path>   (same routes; the host registers the `@` encoded — only `@`, the slash stays literal)
```

Every route matches in registration order and answers as a Fetch handler. `auth` is enforced by
the host; a route written as `renown` still checks `ctx.user` in its handler, because a host with
authentication disabled serves every route anonymously. The graph index is per drive, so every
route that reads the index takes `drive` (a document UUID).

## Routes

| Method | Path | `auth` | Parameters / body | Response |
|---|---|---|---|---|
| `GET` | `ping` | `renown` | — | `{ ok, subgraph, user }` |
| `GET` | `drives` | `renown` | — | `{ drives: [{ id, name, slug, nodes }] }` — only drives whose `preferredEditor` is `knowledge-vault` and that the caller may read; each `id` is the `drive` value for every other route |
| `GET` | `search` | `renown` | `drive` (required), `q` (required), `mode=hybrid\|semantic`, `limit` (default 6, max 25), `content=1`, `includeArchived=1` | `{ query, mode, hits: [{ similarity, score, matchedBy, node }] }`; `Accept: text/markdown` renders a digest |
| `GET` | `notes/:id` | `renown` | `drive` (required); `id` is a UUID | `{ id, name, documentType, state, edges }` |
| `GET` | `notes/:id.md` | `renown` | same | markdown with YAML frontmatter; edges as absolute links carrying `?drive=` |
| `POST` | `actions` | `renown` | body `{ documentId, actions[], wait?, allowLiteralEscapes? }` | `{ revision, operations: [{ index, type, error, attribution }] }`; `202 { jobId }` when `wait: false` |
| `POST` | `relationships` | `renown` | body `{ source, target, type, reason?, confidence? }` | `{ revision, operations }` |
| `PATCH` | `relationships` | `renown` | same body; replaces the stored `reason`/`confidence` | same |
| `DELETE` | `relationships` | `renown` | body `{ source, target, type }` | same |
| `POST` | `tasks/:id/claim` | `renown` | `drive` (required); body `{ assignedTo? }` (defaults to the caller) | `{ taskId, assignedTo }`; `409` when already assigned, `404` unknown task, `503` when the read-back cannot confirm |
| `GET` | `stats` / `density` / `topics` | `renown` | `drive` (required) | the graph aggregate, as `createGraphQuery` produces it |
| `GET` | `topics/:name` | `renown` | `drive` | notes tagged with the topic |
| `GET` | `orphans` / `triangles?limit=` / `graph.json` | `renown` | `drive`; `triangles` defaults 20, max 100 | nodes with no incoming edge / synthesis opportunities / `{ nodes, edges }` |
| `GET` | `embeddings/missing` | `renown` | `drive` | document ids without an embedding |
| `GET` | `notes/:id/similar?limit=` / `links` / `backlinks` / `connections?depth=` | `renown` | `drive`, `id` | semantic neighbours / forward edges / back edges / BFS, each with edge reasons |
| `GET` | `activity?since=&limit=` / `notes/:id/history` | `renown` | `drive`; **requires `canWrite`** | the audit log (`inputJson`, signer, signature) |
| `GET` | `bridges` | `renown` | `drive`; **requires `canManage`** (O(V·E)) | articulation points |
| `GET` | `access-map` | `renown` | `drive`; **requires `canManage`** | grants, protections, operation grants |
| `POST` | `admin/reindex` | `renown` | `drive`; **requires `canManage`** | `{ indexedNodes, indexedEdges, errors }` (reindex does not re-embed) |
| `GET` | `llms.txt` | `renown-optional` | `drive` | MoC index as plain text; anonymous only when the drive is anonymously readable, titles only |
| `GET` | `llms-full.txt` | `renown-optional` | `drive`; `includeDrafts=1` to inline every non-archived note, not just canonical ones | canonical notes plus the scope-of-work and WBS outlines; signed-in only |
| `GET` | `health.json` | `renown` | `drive` | the last health report |
| `GET` | `badge.svg` | `public` | `drive` | SVG status word (`PASS`/`WARN`/`FAIL`/`UNKNOWN`, 5-minute cache); public because it carries the status word only |

### Write semantics

`POST actions` and the relationship routes run, in order: shape validation, identity and
document resolution (`canWrite`, `canMutate` for `SUBMIT_FOR_REVIEW` / `APPROVE_NOTE` /
`REJECT_NOTE` / `ARCHIVE_NOTE` / `RESTORE_NOTE`), lint (`REACTOR_REJECTS` and `VAULT_CONVENTION`
findings returned as `400` with the JSON path of each), envelope stamping (`id`/`timestampUtcMs`
only when absent; `input` forwarded byte-for-byte), attribution (a signed `context.signer` must
match the caller, otherwise the action is host-signed and reported as `attribution: "server"`),
dispatch, and a per-action read-back. A `400` means nothing was dispatched.

Relationship actions are stamped with `scope: "document"` (required by the reactor) and are
authorized on the **source** document. Knowledge link types (`RELATES_TO`, `BUILDS_ON`,
`CONTRADICTS`, `SUPERSEDES`, `DERIVED_FROM`) require a specific `reason` of at least 20
characters; `CORE_IDEA` and `CHILD_MOC` may be bare.

## Unauthenticated routes

Grepping this document for `"public"` lists every unauthenticated route: **`GET badge.svg`** is
the only one (status word only, never vault content). `llms.txt` is `renown-optional`: anonymous
callers get MoC titles when the drive is anonymously readable and a `401` hint otherwise.

## Deferred (not yet served)

The vault-native MCP endpoint (`mcp`, planned in `docs/plans/http-surface.md` slice 4) and
webhooks (slice 3, plus its GitHub/Slack/generic-token presets and the Integrations screen).

## Operational notes

- Subgraph changes only take effect after `bun run build` and a Switchboard restart.
- `dryRun` is not implemented: `evaluateActions` answers `AUTH_EVALUATION_UNSUPPORTED` unless the
  reactor runs with `authEnforcement`.
- Body cap on `POST actions` is 2 MiB; the host default (1 MiB) applies elsewhere.
- Rate limiting is not implemented; it belongs in front of the reactor (the plan's slice list).