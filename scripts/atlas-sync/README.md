# atlas-sync — snapshot, rebuild and verify the Atlas knowledge vault

The Atlas vault is 1,533 documents mined from `next-gen-atlas/content`:
1,484 knowledge notes, 23 MoCs, 18 sources, 5 tensions and the three
singletons. This folder holds the tooling to copy that vault between
reactors and to prove the copy is faithful.

It is a sibling of [`../drive-sync`](../drive-sync), not a fork.
The GraphQL transport, the id-map, the per-type handlers and the four
upload phases are **imported** from drive-sync; only the Atlas-specific
parts live here.

---

## Quick start

```bash
# 1. snapshot the live remote vault to disk        (~1 min, read-only)
python3 scripts/atlas-sync/atlas.py download --from remote

# 2. rebuild it on a local reactor                 (ph vetra running)
python3 scripts/atlas-sync/atlas.py upload --to local --structural-only

# 3. prove the rebuild matches the snapshot
python3 scripts/atlas-sync/atlas.py verify --at local
```

`verify` exits non-zero if anything is missing, so it is safe to chain
with `&&`.

---

## Targets

Endpoints are **named**, so a rebuild cannot be aimed at the wrong
reactor by a mistyped URL. A full `https://` URL is also accepted.

| Name | Endpoint |
|---|---|
| `local` | `http://localhost:4001/graphql` |
| `remote` | `https://jade-bat-19425107-switchboard.vetra.io/graphql` |

`--drive` defaults to the known drive for the target (for `remote`,
`688dbf68-…`); after an upload it falls back to the drive id recorded in
`upload-summary.json`.

---

## Commands

| Command | What it does |
|---|---|
| `download --from <target>` | Snapshot a live drive into `data/atlas-vault/`. Read-only. |
| `upload --to <target>` | Replay a snapshot into a reactor. Resumable. |
| `verify --at <target>` | Diff a live drive against the snapshot. Exits 1 on drift. |
| `repair --at <target>` | Drift check: re-dispatch any edges the projection is missing. |
| `stats --at <target>` | Document counts by type. The cheapest sanity check. |
| `reindex --at <target>` | Rebuild the graph projection from the relationship table. |

Useful flags:

- `upload --structural-only` — replay only `DERIVED_FROM`, `CORE_IDEA`
  and `CHILD_MOC`. See "Why structural-only" below.
- `upload --link-types RELATES_TO,BUILDS_ON` — arbitrary allow-list.
- `upload --existing-drive <uuid>` — import into a drive you already
  created instead of creating one.
- `verify --sample 100` — field-check only the first N documents
  (document and edge checks always cover everything).

---

## Why this is separate from drive-sync

Two requirements drive-sync does not have.

**1. `bai/tension` documents.** drive-sync has no handler for the type,
so a tension would be skipped at creation. [`atlaslib/tension.py`](atlaslib/tension.py)
adds one. Unlike notes and MoCs, a tension's `involvedRefs` are a
*required* argument of `CREATE_TENSION`, so they cannot be deferred to
phase 4 — they are remapped during phase 3, which is safe because
phase 2 finishes creating every document first.

**2. A history-clean rebuild.** The live Atlas drive accumulated
`ADD_RELATIONSHIP` → `REMOVE_RELATIONSHIP` churn: 4,396 similarity edges
were written and then purged, so ~1,400 documents carry both the add and
the remove. Connect's inbox scheduler dead-letters on that drive with
`Dependency cycle detected involving key: …`, reporting pairs of
operation keys within a single document that depend on each other.

Replaying a snapshot reproduces the *state* without the churn. Every
document in the rebuilt drive has a linear history:

```
CREATE_DOCUMENT → MOVE_NODE → one mutateDocument batch → N × addRelationship
```

No removes, so no add/remove pair can form a cycle. Whether that is
sufficient is what the local rebuild is for — it is a hypothesis under
test, not a proven fix.

---

## Reindex (fixed — was destructive)

`knowledgeGraphReindex` used to **destroy edges**, and the tooling here
still carries a `repair` command because of it. It is fixed; this is
recorded because the failure was silent and the shape is worth knowing.

| | edges | verify |
|---|---|---|
| after upload | 7,537 | PASS |
| after `reindex` (before fix) | 6,408 | FAIL — 1,129 `CORE_IDEA` missing |
| after `repair` | 7,537 | PASS |
| after `reindex` (after fix) | 7,537 | PASS |

**Root cause.** `IReactorClient.getOutgoingRelationships` cannot return
more than 100 targets and offers no way to ask for more:

```js
const targetIds = (await this.documentIndexer.getOutgoing(
  sourceId, [relationshipType], void 0, void 0, signal   // paging: void 0
)).results.map((rel) => rel.targetId);
return this.find({ ids: targetIds }, view, paging, signal);
```

`documentIndexer.getOutgoing` defaults to `limit = paging?.limit || 100`
and *does* return a usable `next()` / `nextCursor` — but the client passes
no paging and discards both. The caller's own `paging` reaches only
`find()`, which pages the already-truncated 100-item id list. Hence
`totalCount: 100` and `hasNextPage: false`: to `findByIds` there really
are only 100 ids. **No caller-side argument lifts the cap.**

This was destructive rather than merely incomplete because reindex
*deletes* a document's edges before writing back what it read — so a
truncated read became a truncated write, and running the advertised
repair tool was what caused the damage.

**The fix** ([`relationship-paging.ts`](../../subgraphs/knowledge-graph/helpers/relationship-paging.ts))
reads the other end. An edge is the same row from either side, and the
fan-out is asymmetric:

| type | max OUT | max IN |
|---|---:|---:|
| `CORE_IDEA` | **430** | **5** |
| `DERIVED_FROM` | 1 | 285 |
| `RELATES_TO` | 11 | 11 |
| `CHILD_MOC` | 15 | 1 |

For every type at least one direction fits under 100. Reindex now runs
two passes: pass 1 reads outgoing and records which types came back
*saturated* (exactly 100 rows, no cursor, no `next` — the cap's
signature); pass 2 re-derives only those types from the target side. The
fallback is triggered by observed saturation, so a drive with no
oversized fan-out pays nothing — which is why this stayed invisible on
smaller vaults.

Reindex also now **prunes projection rows for documents that have left
the drive**. `deleteDocument` removes the document and its drive node but
leaves the `graph_nodes` row, so deleted notes lingered as titleless
entries in `knowledgeGraphOrphans`.

`repair` is kept as a drift check — it reports `nothing to do` on a
healthy drive and can restore edges if the live processor ever falls
behind.

---

## The 100-row cap (read this before trusting any edge count)

`documentOutgoingRelationships` **clamps `paging.limit` to 100
server-side** and returns neither a total nor a `hasNextPage` flag.
A MoC with 374 core ideas returns exactly 100 rows and looks complete.

The first snapshot taken here reported 1,676 `CORE_IDEA` edges. The true
number is 2,672. Summing `min(n, 100)` over the 23 MoCs gives exactly
1,676 — 996 edges would have been silently dropped from the rebuild,
and because `verify` read the graph the same truncated way, **both sides
would have agreed**.

[`atlaslib/snapshot.py`](atlaslib/snapshot.py) therefore:

- always sends `paging: {limit: 100, offset: N}` explicitly rather than
  relying on the server default;
- treats a full page as "possibly truncated" and walks `offset` until a
  short page arrives (`saturated_pairs` / `fetch_relationships`);
- shares that one reader with `verify`, so the two sides cannot be
  truncated in agreement.

⚠️ **`drive-sync/download.py` reads relationships the same per-document
way** and so has the same latent ceiling. It has not bitten only because
no knowledge-vault MoC has more than 100 core ideas.

---

## Request shape

The naive download is 1 state query + 7 relationship queries per
document — ~12,000 round trips. GraphQL aliases collapse that to ~150:

| Pass | Batching | Requests |
|---|---|---|
| states | 20 documents per query (`d0 … d19`) | 77 |
| relationships | 10 documents × 7 types per query (`r0_0 … r9_6`) | 154 |
| pagination | only the sets that came back full | ~10 |

All of it goes over **one** keep-alive connection from
`drive-sync/lib/gql.py`. `upload` reports this at the end so the claim
is checked rather than assumed — a full local rebuild reads:

```
[upload] transport: 10250 requests over 1 connection(s), 0 reconnect(s)
``` Opening a connection per request is what made
the earlier bulk runs fail: 20 sequential requests took 48s with ~15%
`handshake operation timed out`, versus 1.2s and zero failures pooled.

Document ids are interpolated into the query string rather than passed
as variables (hundreds of aliases would mean hundreds of variable
definitions), so `atlaslib.safe_identifier` rejects anything that is not
a UUID before it reaches the query.

---

## What's in `data/atlas-vault/`

| File | Purpose |
|---|---|
| `manifest.json` | folders[] + documents[] (id, name, type, parentFolder) + counts |
| `drive-info.json` | source drive id / slug / name |
| `tree.json` | raw node list |
| `states/<id>.json` | `state.global`, with `links[]` / `coreIdeas[]` / `childRefs[]` rebuilt from the relationship table |
| `id-map.json` | old id → new id, written incrementally by `upload`. **Also the resume marker** — delete it to force a clean re-run |
| `upload-summary.json` | drive id + counts from the last upload |

There is deliberately **no `ops/` directory**. drive-sync records
operation history for reference; here the whole point is to leave the
old history behind, so downloading it would be misleading weight.

---

## Why structural-only

The live drive currently has:

| Type | Count | Meaning |
|---|---|---|
| `DERIVED_FROM` | 1,479 | note → the source it was extracted from |
| `CORE_IDEA` | 2,672 | MoC → member note |
| `CHILD_MOC` | 22 | hub → domain MoC |
| `RELATES_TO` | 20 | remnants of the purged similarity layer |

`CORE_IDEA` and `CHILD_MOC` are what `GraphView` renders; `DERIVED_FROM`
is the provenance chain. Those three are editorial — each one was
decided, not inferred.

The 4,396 `RELATES_TO` edges were generated by cosine similarity at a
threshold that was never measured before use. Measured afterwards: p50
similarity 0.903, max 0.977, so the 0.86 threshold kept 99.2% of all
pairs — it was not a filter. `--structural-only` leaves that layer out.
It can be re-added later as a curated set via `--link-types`, once
there is a threshold someone has actually looked at.

The 20 surviving `RELATES_TO` edges are purge stragglers and are not
replayed under `--structural-only`.

---

## De-duplicated claims

Source A.2 carries 19 duplicate `claimRefs` — a close-out batch was
retried after a 502 whose commit landed anyway, so the retry appended
refs that were already there. `ADD_EXTRACTED_CLAIM` has no removal
operation, so a replay is the only way to drop them.
[`atlaslib/source.py`](atlaslib/source.py) collapses repeats while
preserving first-seen order: 281 refs → 262, all unique.

---

## Verification

`verify` runs three independent checks against the live drive:

| Check | Covers |
|---|---|
| documents | every snapshot doc has a live counterpart of the same type |
| fields | `title`, `description`, `content`, `noteType`, `status`, topic count |
| edges | the relationship set matches after id remapping, fully paged |

A rebuild that passes all three looks like:

```
[verify] live drive Atlas Vault — 1533 documents
[verify] documents: 1533 matched, 0 missing, 0 wrong type
[verify] fields: 1533/1533 documents match
[verify] edges: 4173 matched, 0 missing, 0 unexpected
[verify] PASS
```

It compares against the **snapshot**, never against a log of what was
dispatched. A 502 whose commit lands after the client gives up is
indistinguishable from success in a dispatch log — that is precisely how
the live vault ended up with a MoC whose `CREATE_MOC` never applied,
which silently dropped a 181-note branch from the app.

Fields absent from the snapshot are not required live: the handlers only
emit a setter when there is a value, so a model default is not drift.

---

## Troubleshooting

**`upload` skips phase 2 / "already-uploaded ids found".**
Stale `id-map.json` from a run against a different reactor.
`rm data/atlas-vault/id-map.json`.

**Documents land in duplicate folders.**
The knowledge-vault drive app seeds `/knowledge/`, `/ops/`, `/sources/`
the first time a drive is opened in Connect. Phase 1 reuses folders
matching on `(name, parent)` and phase 2 adopts existing singletons, so
uploading into an already-opened drive is safe — but only if the folder
names match exactly.

**Edge counts disagree between two tools.**
Check whether the other tool paginates. See "The 100-row cap" above.

**`Unknown argument "meta" on DocumentDrive.createDocument`.**
The reactor predates dev.246. `lib/gql.py` uses `preferredEditor`.

---

## Tests

```bash
python3 -m pytest scripts/atlas-sync/tests -q
```

Covers the tension handler, the batched query builders and parsers, the
identifier guard, offset-walking against a stub that enforces the real
100-row cap, the relationship allow-list, and the field comparison.
No network access.
