# Upstream bug report — Powerhouse `6.2.3-dev.90`

Two defects behind a ~6-minute stall after every Switchboard restart, and one
that keeps the trigger alive. Found 2026-11-02 while investigating why the first
write after `ph vetra` restarts froze every read and write for minutes.
**Recorded here, not filed upstream.**

| | Field | Value |
|-|-------|-------|
| Reported against | `@powerhousedao/*` `6.2.3-dev.90` |
| Environment | Arch Linux, node 26, PGlite stores in worker threads (default), reactor store 930 MB / 103,456 operations, vault drive of 2,825 documents |
| Reproduced | on a copy of the store, under a plain `startSwitchboard` (no Vetra, workflows off), every PGlite request timed by wrapping `ThreadedPGlite.prototype.request` |

## Summary

| # | Defect | Severity | Where |
|---|--------|----------|-------|
| 1 | PGlite stores never get planner statistics | **minutes-long stalls**, grows with the store | `reactor-api` `DurableNodeFs` maintenance |
| 2 | An outbox rebuild reads the collection's whole history, then applies the remote's document filter in JS | multiplies #1; repeats after every restart | `reactor` `SyncManager.deriveOutbox`, `KyselyOperationIndex.find` |
| 3 | A served remote that never polls is never pruned after a restart | keeps #2 alive indefinitely | `reactor` `SyncManager.stalePollAgeMs` |

Measured effect, same store, same first write (a document created in the vault drive):

| | First write | Window of slow reads/writes | Steady state |
|-|-------------|-----------------------------|--------------|
| As shipped | 21.7 s | 349 s (writes 17–32 s, reads 3–25 s) | write 37 ms, read 8 ms |
| After one `ANALYZE` | 0.7 s | 6 s | write 24 ms, read 8 ms |

---

## 1. PGlite stores never get planner statistics

**What happens.** PGlite has no autovacuum, and the store maintenance in
`reactor-api` (`DurableNodeFs`, every 300 s when there were writes) runs
`VACUUM` and `CHECKPOINT` only:

```js
for (const statement of [full ? "VACUUM FULL" : "VACUUM", "CHECKPOINT"]) { … }
```

`VACUUM` updates `pg_class.reltuples` but never collects column statistics, so
`pg_statistic` stays empty for every table, for the life of the store. Postgres
then estimates from its defaults.

**Why it matters.** On the store above the planner estimated **9** rows for
`document_collections where "collectionId" = <vault>` (actual 2,825) and **516**
for the operation range (actual 46,853), and chose a nested loop that runs a
bitmap scan over the whole ordinal range once per document:

```
Nested Loop (rows=8) (actual rows=46212)
  -> Bitmap Heap Scan on document_collections (rows=9) (actual rows=2825)
  -> Bitmap Heap Scan on operation_index_operations (loops=2825)
       -> Bitmap Index Scan on idx_operation_index_operations_ordinal
            (rows=516) (actual rows=46853 loops=2824)
Execution Time: 5099 ms
```

After `ANALYZE` the same query is a hash join: **105 ms**. `ANALYZE` itself
takes 0.8 s on the 930 MB reactor store and 0.3 s on the 183 MB read store.

**Reproduce.** On any store that has run for a while:

```sql
select count(*) from pg_class c
  left join (select distinct starelid from pg_statistic) s on s.starelid = c.oid
 where c.relkind = 'r' and c.reltuples > 0 and s.starelid is null
   and c.relnamespace = 'reactor'::regnamespace;   -- every table with rows
```

**Suggested fix.** Run `VACUUM (ANALYZE)` in the maintenance pass, and `ANALYZE`
once when a store opens with tables that have rows but no statistics (a store
imported or grown before the fix).

## 2. An outbox rebuild reads the whole history to apply a filter in JS

**What happens.** After a restart, the first write to a drive runs
`SyncManager.processCompleteBatch → updateOutbox → deriveOutbox` for each
remote on the drive's collection. `deriveOutbox` pages through
`operationIndex.find(collectionId, startOrdinal, { excludeSourceRemote,
throughOrdinal })` 500 operations at a time and only then applies the remote's
filter: `filterForRemote(operations, remote.meta.filter)`. `find` takes no
document filter, so a remote scoped to a few documents — or to none — reads
every operation in the collection.

When the filter leaves nothing to send, nothing is acknowledged, so no outbox
cursor is ever stored (`outbox.advanceOrdinal` is in memory). The next restart
starts from ordinal 0 again.

**Why it matters.** Here: one remote whose filter is `documentId:
["<a sentinel no document has>"]` made every restart read 103k operations in 94
pages. With #1 each page took ~5 s, and a page's cost grows with the range
still ahead of it (the plan rescans it), so the total is quadratic. Every other
request on the store waits behind it.

**Suggested fix.** Pass `filter.documentId` (and scope, branch) into `find` as
SQL conditions, and persist the derived position after a derivation, not only
after an acknowledgement.

## 3. A served remote that never polls is never pruned after a restart

**What happens.** `stalePollAgeMs(remote)` returns `undefined` when the channel
reports no last poll, and the last poll is held in memory. After a restart no
served remote has one, so none is ever pruned, however old. The store above
held 37 durable polling remotes from Connect tabs between 2026-09-13 and
2026-10-06, none with a successful pull.

**Suggested fix.** Persist the holder's last poll (the `sync_remotes` row has
`pull_last_success_utc_ms`, unset for all 37), or treat a remote with no
recorded poll older than the stale window as stale.

---

## Local workarounds

- `node scripts/analyze-stores.mjs --apply` — `ANALYZE` both `.ph` stores (Switchboard stopped).
- `node scripts/prune-sync-remotes.mjs --stale-days 7 --apply` — remove dead remotes.
- The desktop app (`knowledge-vault-app`, `patches/@powerhousedao%2Freactor-api@6.2.3-dev.85.patch`) patches the maintenance: every pass runs `VACUUM (ANALYZE)`, and a first pass 15 s after open runs `ANALYZE` when a table with rows has no statistics.
