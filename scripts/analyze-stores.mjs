#!/usr/bin/env node
/**
 * Collect planner statistics (ANALYZE) on the local PGlite stores.
 *
 * PGlite has no autovacuum, and the Switchboard's store maintenance runs
 * VACUUM and CHECKPOINT but never ANALYZE (checked on 6.2.3-dev.90), so a
 * store's tables never get column statistics and Postgres plans from its
 * defaults. Measured 2026-11-02 on this repo's Vetra store (930 MB, 103k
 * operations): the planner estimated 9 documents in a 2,825-document vault and
 * chose a nested loop that rescanned the whole operation range once per
 * document — 5 s for each 500-operation page of the sync outbox rebuild that
 * follows the first write after a restart, ~350 s during which every read and
 * write waited. After one ANALYZE the same page took 105 ms and the window was
 * 6 s. Statistics are stored in the store itself (pg_statistic), so they
 * survive restarts; re-run after a large import.
 *
 * Usage (reactor STOPPED; PGlite is single-writer):
 *   node scripts/analyze-stores.mjs                  # report which stores lack statistics
 *   node scripts/analyze-stores.mjs --apply          # ANALYZE them
 *   node scripts/analyze-stores.mjs --store <dir>    # repeatable; default: both .ph stores
 *
 * Node only — no bun APIs.
 */
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { openStore } from "./lib/open-store.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const stores = args.flatMap((a, i) => (a === "--store" && args[i + 1] ? [resolve(args[i + 1])] : []));
if (stores.length === 0) stores.push(resolve("./.ph/reactor-storage"), resolve("./.ph/read-storage"));
const portAt = args.indexOf("--port");
const port = Number(portAt >= 0 ? args[portAt + 1] : 4001);

const listening = await new Promise((done) => {
  const socket = createConnection({ port, host: "127.0.0.1" });
  socket.once("connect", () => (socket.destroy(), done(true)));
  socket.once("error", () => done(false));
});
if (listening) {
  console.error(`REFUSED: something is listening on :${port} — stop the reactor first (two PGlite instances on one store corrupt it).`);
  process.exit(1);
}

// Tables that hold rows but have no column statistics. An empty table gets no
// pg_statistic rows even after ANALYZE, so it is not counted as missing.
const COVERAGE = `
  select count(*)::int as tables,
         count(*) filter (where s.starelid is null)::int as missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join (select distinct starelid from pg_statistic) s on s.starelid = c.oid
   where c.relkind = 'r' and c.reltuples > 0
     and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')`;

for (const store of stores) {
  if (!existsSync(store)) {
    console.log(`${store}: not found, skipped`);
    continue;
  }
  const db = await openStore(store);
  try {
    const before = (await db.query(COVERAGE)).rows[0];
    console.log(`${store}: ${before.tables} tables with rows, ${before.missing} without statistics`);
    if (!apply) continue;
    const started = performance.now();
    await db.exec("ANALYZE");
    const after = (await db.query(COVERAGE)).rows[0];
    console.log(`  ANALYZE took ${Math.round(performance.now() - started)} ms; ${after.missing} without statistics now`);
  } finally {
    await db.close(); // a clean close leaves the store checkpointed
  }
}
if (!apply) console.log("report only — nothing changed. Re-run with --apply (reactor stopped).");
