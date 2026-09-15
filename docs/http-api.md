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
| `GET` | `search` | `renown` | `drive` (required), `q` (required), `mode=semantic` (the only mode), `limit` (default 6, max 25), `related` (default 10, max 50, `0` disables), `content=1`, `includeArchived=1` | `{ query, mode, hits: [{ similarity, score, matchedBy, node }], related, links, expansion }`; `Accept: text/markdown` renders a digest. See [Search expands the graph](#search-expands-the-graph) |
| `GET` | `notes/:id` | `renown` | `drive` (required); `id` is a UUID | `{ id, name, documentType, state, edges }` |
| `GET` | `notes/:id.md` | `renown` | same | markdown with YAML frontmatter; edges as absolute links carrying `?drive=` |
| `POST` | `actions` | `renown` | body `{ documentId, actions[], wait?, allowLiteralEscapes? }` | `{ revision, operations: [{ index, type, error, attribution }], readBack, jobId }`; `202 { jobId }` when `wait: false` |
| `POST` | `notes` | `renown` | body `{ drive, documentType?, notes: [{ name, actions? }] }` (max 25) | `201 { drive, parentFolder, notes: [{ id, name, parentFolder, path, readBack, operations }] }` — creates many documents and places them in **one** containment dispatch |
| `POST` | `sources` | `renown` | body `{ drive, title, content, sourceType?, description?, author?, url?, publishedAt?, method?, tool?, queue? }` | `201 { id, parentFolder, path, status, revision, operations, readBack, jobId, task? }` — ingests a source from content alone; **the route places it in `/sources` itself** |
| `POST` | `relationships` | `renown` | body `{ source, target, type, reason?, confidence? }` | `{ revision, operations, readBack, jobId }` |
| `PATCH` | `relationships` | `renown` | same body; replaces the stored `reason`/`confidence` | same |
| `DELETE` | `relationships` | `renown` | body `{ source, target, type }` | same |
| `POST` | `tasks/:id/claim` | `renown` | `drive` (required); body `{ assignedTo? }` (defaults to the caller) | `{ taskId, assignedTo }`; `409` when already assigned, `404` unknown task, `503` when the read-back cannot confirm |
| `GET` | `stats` / `density` / `topics` | `renown` | `drive` (required) | the graph aggregate, as `createGraphQuery` produces it |
| `GET` | `topics/:name` | `renown` | `drive` | notes tagged with the topic |
| `GET` | `orphans` / `triangles?limit=` / `graph.json` | `renown` | `drive`; `triangles` defaults 20, max 100 | nodes with no incoming edge / synthesis opportunities / `{ nodes, edges }` |
| `GET` | `embeddings/missing` | `renown` | `drive` | document ids without an embedding |
| `GET` | `notes/:id/similar?limit=` / `links` / `backlinks` / `connections?depth=` | `renown` | `drive`, `id` | semantic neighbours / forward edges / back edges / BFS, each with edge reasons |
| `GET` | `activity?since=&limit=` / `notes/:id/history` | `renown` | `drive`; **requires `canWrite`** | the audit log (`inputJson`, signer, signature) |
| `GET` | `bridges` | `renown` | `drive`; **requires `canWrite`** | articulation points — notes whose removal would split the graph (Tarjan, one DFS pass, O(V+E)). A curation tool: it answers what structural work needs doing, so it sits with `activity`/`history` rather than with discovery |
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

#### A failed write never leaves the vault worse than it found it

Creating a document and placing it in its folder cannot be one transaction —
the reactor runs them as two jobs. A failure in between strands the document at
the drive root, where folder views and the pipeline will never find it. So
**every route that creates documents undoes its own work on failure**, rather
than reporting the stranded ids and making them the caller's problem.

| failure | what happens |
|---|---|
| creation fails partway | everything created so far is deleted |
| containment does not land | everything created is deleted; **verified by reading the drive back**, not by trusting the job result |
| a write *after* containment succeeded | reported, **not** rolled back — the document is visible and in the right folder, its per-action errors are returned, and deleting it would discard the actions that did apply |

A `502 CREATE_FAILED` or `502 CONTAINMENT_FAILED` therefore means nothing was
left behind. In the one case where the rollback *itself* fails, the response
says `Rollback INCOMPLETE` and lists the stranded ids in
`details[].orphaned` — the absence of that field is the caller's assurance the
vault is clean.

Routes that only mutate existing documents (`POST actions`, the relationship
verbs, `tasks/:id/claim`, `admin/reindex`) create nothing and cannot strand
anything; operations are append-only and their errors are reported per action.

#### Placement is the API's job

`POST sources` takes **content, not a location**. The route resolves `/sources` from the drive's
own tree at request time and creates the document there; a `parentFolder` in the body is rejected
with `400`, so no client can put a source anywhere else. The folder *rule* is fixed in
`subgraphs/http/lib/vault-folders.ts`; the folder **id** is never hardcoded, because ids differ per
drive and this package serves several.

| documentType | folder |
|---|---|
| `bai/source` | `/sources` |
| `bai/knowledge-note` | `/knowledge/notes` |
| `bai/moc` | `/knowledge` |
| `bai/tension`, `bai/observation` | `/ops` |
| `powerhouse/scopeofwork`, `bai/wbs` | `/projects` |

If the target folder does not exist the request fails `400 FOLDER_UNRESOLVED` **having created
nothing** — it never falls back to the drive root, because a document at the root is invisible to
the pipeline and to the app's folder views. The response reports `parentFolder` and `path` as read
back from the drive, not echoed from the request, so a create whose containment silently failed
cannot look like a success.

`queue` (default `true`) mirrors the app's *Queue for Processing*: it sets the source to
`EXTRACTING` and adds a `claim` task referencing it. A task is only added when no existing task
already has that `documentRef`, and its id is always freshly generated — a duplicate task id is
unrecoverable, since every queue operation resolves by first match and there is no `REMOVE_TASK`.

#### Request validation

A request is either accepted or refused with the JSON path of what is wrong.
Nothing is silently reinterpreted.

- **Unknown body fields are a `400`**, naming the offending key and listing the
  allowed ones. A misspelt optional field cannot quietly change what the request
  does.
- **Envelope fields are optional, and checked when supplied.** `id`,
  `timestampUtcMs` and `scope` are generated for you when absent. If you send
  them they must be valid: `id` a UUID and unique within the batch,
  `timestampUtcMs` an ISO 8601 instant, `scope` one of `global`, `local`,
  `document`, `auth`. A duplicate `id` is refused — two operations sharing one
  is the case that corrupts sync for connected clients.
- **Model validation** runs before dispatch: unknown action types, bad enum
  values and the 200-character description limit all return `400`.
- These are checked **before anything is dispatched**, so a malformed envelope
  is a `400` here rather than a `422` from the reactor after the fact.

#### `readBack` — the write may be dispatched but unverified

Every synchronous write reports `readBack`:

| value | meaning |
|---|---|
| `confirmed` | the dispatched actions were found in the operation log; `operations[]` describes them |
| `unconfirmed` | the job reported success but the log could not be read back in time; `operations[]` is **empty** |
| `skipped` | `wait: false` — no read-back was attempted (surfaces as `202`) |

**`unconfirmed` is not a failure and must not be retried.** The actions were dispatched and the
job reported success; re-sending them would re-apply non-idempotent operations. Poll the returned
`jobId`, or re-read the document, instead. `operations[]` is therefore empty in two distinguishable
cases — nothing matched (`unconfirmed`) and an async dispatch (`skipped`) — and never silently
empty on a confirmed write.

The read-back derives its floor from the **per-scope** revision of the scopes actually being
written. (It previously took `Math.min` across the whole revision map, which mixed scopes: a
freshly created document is `{ document: 2 }` with no `global` entry, so the first global write to
any new document read back empty and was reported as clean. Fixed 2026-09-14.)

Relationship actions are stamped with `scope: "document"` (required by the reactor) and are
authorized on the **source** document. Knowledge link types (`RELATES_TO`, `BUILDS_ON`,
`CONTRADICTS`, `SUPERSEDES`, `DERIVED_FROM`) require a specific `reason` of at least 20
characters; `CORE_IDEA` and `CHILD_MOC` may be bare.

## Search expands the graph

A flat ranked list is not what this vault holds. A six-hit search over 983 notes sits next to
about 105 notes one link away that the caller never sees — most of what the vault knows about
the question is in the edges, not in the ranking. So `GET search` returns the neighbourhood of
its hits **by default**, and a caller that only knows how to search still gets told what to read
next.

```
GET search?drive=<uuid>&q=how+do+document+models+work
```

```jsonc
{
  "query": "how do document models work",
  "mode": "semantic",
  "hits": [ { "similarity": 0.96, "score": 0.96, "matchedBy": ["semantic"], "node": { … } } ],

  // Nodes one knowledge link from the hits, ranked, excluding the hits themselves.
  "related": [
    {
      "documentId": "…", "title": "…", "description": "…",
      "noteType": "concept", "status": "CANONICAL", "documentType": "bai/knowledge-note",
      "hitCount": 3,        // how many hits point at it — convergence is signal
      "score": 2.71,        // rank within THIS response only
      "via": [              // always source -> target, so there is no direction to decode
        { "from": "<hit id>", "fromTitle": "…", "to": "<this node>", "toTitle": "…",
          "linkType": "BUILDS_ON", "reason": "…", "confidence": "grounded" }
      ]
    }
  ],

  // Edges BETWEEN hits — the shape of the result set itself.
  "links": [ { "from": "…", "to": "…", "linkType": "RELATES_TO", "reason": null } ],

  "expansion": { "hops": 1, "relatedTotal": 105, "relatedShown": 10, "truncated": true }
}
```

**One hop, not two.** Two hops from six hits reaches most of the vault and stops being context.

**Ranking.** A neighbour's score is the sum, over every edge joining it to a hit, of
`hit similarity × link-type weight`, with a 1.15× bonus for an articulated edge (one carrying a
`reason`). Summing means a node several hits point at outranks a node one hit points at, without
a separate rule for convergence. The link-type weights live in
`subgraphs/knowledge-graph/helpers/neighbourhood.ts` and encode one judgement: a link that
changes whether an answer is **correct** outranks one that merely adds material — `CONTRADICTS`
(1.6) and `SUPERSEDES` (1.4) above `BUILDS_ON` (1.2) above `RELATES_TO` (0.8), with
`DERIVED_FROM` (0.4) last because it points at a source document rather than at an answer.

**Per-hit cap.** Any single hit contributes at most 15 edges, chosen by weight. A MoC is a
legitimate hit and carries a `CORE_IDEA` edge to every note it holds — 60+ on this vault's domain
MoCs — which would otherwise fill the list from one result.

**Cost.** Two extra queries for the whole response, not two per hit: one `IN (…)` over
`graph_edges` for every hit at once, one over `graph_nodes` for the neighbours it found.

**Failure is not fatal.** If the graph read fails the search still answers; `related` comes back
empty and the route logs a warning rather than returning 500.

`related=0` opts out when a caller wants the ranking alone.

In GraphQL the same expansion is a selectable field, `SemanticResult.related(limit: Int = 5)`,
computed once for the whole result set and sliced per hit — selecting it on twenty hits costs the
same two queries, and selecting nothing costs none.

## Unauthenticated routes

Grepping this document for `"public"` lists every unauthenticated route: **`GET badge.svg`** is
the only one (status word only, never vault content). `llms.txt` is `renown-optional`: anonymous
callers get MoC titles when the drive is anonymously readable and a `401` hint otherwise.

## Deferred (not yet served)

The vault-native MCP endpoint (`mcp`, planned in `docs/plans/http-surface.md` slice 4) and
webhooks (slice 3, plus its GitHub/Slack/generic-token presets and the Integrations screen).

## Operational notes

- **After deploying a change to the graph indexer, reindex once.** The
  projection is built by the indexer's code, so existing rows were written by
  the previous version. Restarting does not rebuild them: the processor cursor
  advances past history and never revisits it, and the only boot-time backfill
  is for embeddings (`processors/graph-indexer/index.ts`, `initAndUpgrade`).
  One call, `POST admin/reindex?drive=<UUID>`. This is episodic — do not put it
  on a timer. The live processor already indexes every write, and a rebuild
  blocks every read while it runs: measured 18 s on a local PGlite vault and
  **3 m 26 s on a hosted one** of the same size. Hourly, that is ~6% of all
  wall-clock time spent unresponsive to reproduce work already done.
  `node scripts/check-index-drift.mjs --drive <UUID>` reports whether it is needed.


- Subgraph changes only take effect after `bun run build` and a Switchboard restart.
- `dryRun` is not implemented: `evaluateActions` answers `AUTH_EVALUATION_UNSUPPORTED` unless the
  reactor runs with `authEnforcement`.
- Body cap on `POST actions` is 2 MiB; the host default (1 MiB) applies elsewhere.
- Rate limiting is not implemented; it belongs in front of the reactor (the plan's slice list).