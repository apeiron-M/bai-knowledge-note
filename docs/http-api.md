# Vault HTTP API

The `subgraphs/http` subgraph serves these routes on the Switchboard under the package
namespace:

```
<origin>/api/@powerhousedao/knowledge-note/<path>
<origin>/api/%40powerhousedao%2Fknowledge-note/<path>   (same routes, encoded @ and /)
```

Every route matches in registration order and answers as a Fetch handler. `auth` is enforced by
the host; a route written as `renown` still checks `ctx.user` in its handler, because a host with
authentication disabled serves every route anonymously. The graph index is per drive, so every
route that reads the index takes `drive` (a document UUID).

## Routes

| Method | Path | `auth` | Parameters / body | Response |
|---|---|---|---|---|
| `GET` | `ping` | `renown` | — | `{ ok, subgraph, user }` |
| `GET` | `search` | `renown` | `drive` (required), `q` (required), `mode=hybrid\|semantic`, `limit` (default 6, max 25), `content=1`, `includeArchived=1` | `{ query, mode, hits: [{ similarity, score, matchedBy, node }] }`; `Accept: text/markdown` renders a digest |
| `GET` | `notes/:id` | `renown` | `drive` (required); `id` is a UUID | `{ id, name, documentType, state, edges }` |
| `GET` | `notes/:id.md` | `renown` | same | markdown with YAML frontmatter; edges as absolute links carrying `?drive=` |
| `POST` | `actions` | `renown` | body `{ documentId, actions[], wait?, allowLiteralEscapes? }` | `{ revision, operations: [{ index, type, error, attribution }] }`; `202 { jobId }` when `wait: false` |
| `POST` | `relationships` | `renown` | body `{ source, target, type, reason?, confidence? }` | `{ revision, operations }` |
| `PATCH` | `relationships` | `renown` | same body; replaces the stored `reason`/`confidence` | same |
| `DELETE` | `relationships` | `renown` | body `{ source, target, type }` | same |

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

Grepping this document for `"public"` must list every unauthenticated route. Currently there are
**none** in this slice: `ping`, `search`, `notes`, `actions` and `relationships` are all
`renown`. `badge.svg`, `llms.txt` and `health.json` arrive in the slice-2 tasks with their own
modes.

## Deferred (not yet served)

`llms.txt` / `llms-full.txt`, `health.json` / `badge.svg`, the structure reads (`stats`,
`density`, `topics`, `topics/:name`, `orphans`, `triangles`, `bridges`, `graph.json`,
`embeddings/missing`, `notes/:id/similar|links|backlinks|connections`, `activity`,
`notes/:id/history`), `access-map`, `admin/reindex`, `POST tasks/:id/claim`, and the MCP endpoint
— each is specified in `docs/plans/http-surface.md` and `docs/superpowers/plans/2026-09-13-http-surface-slice1.md`.

## Operational notes

- Subgraph changes only take effect after `bun run build` and a Switchboard restart.
- `dryRun` is not implemented: `evaluateActions` answers `AUTH_EVALUATION_UNSUPPORTED` unless the
  reactor runs with `authEnforcement`.
- Body cap on `POST actions` is 2 MiB; the host default (1 MiB) applies elsewhere.
- Rate limiting is not implemented; it belongs in front of the reactor (the plan's slice list).