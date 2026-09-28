#!/usr/bin/env node
/**
 * Remove the server-side sync remotes that the knowledge-vault app leaked.
 *
 * Remote-first mode keeps each vault drive's channel registered under the
 * sentinel filter `["remote-first-sync-nothing"]` with manual polling. Before
 * `editors/knowledge-vault/lib/channel-ids.ts`, every re-add minted a new
 * channel id, and the Switchboard kept a remote for each one forever: a remote
 * that never polls is never pruned. On the first write after every boot the
 * sync manager re-derives each remote's outbox from its last ack (0 for most),
 * and on PGlite those reads block the event loop — measured 2026-09-28 at ~40 s
 * with 239 of them. See docs/plans/workflow-piece.md §16.
 *
 * Deleting them is safe: they deliver nothing by construction, and a browser
 * still holding one re-creates it through `touchChannel` on its next init.
 *
 * Usage (reactor STOPPED; back the store up first):
 *   node scripts/prune-sync-remotes.mjs                       # dry run
 *   node scripts/prune-sync-remotes.mjs --apply
 *   node scripts/prune-sync-remotes.mjs --stale-days 7        # also unfiltered remotes silent for 7+ days
 *   node scripts/prune-sync-remotes.mjs --store <dir>
 *
 * `--stale-days` widens the net to ordinary Connect channels (full-drive
 * filter) with no outbox cursor or none synced within N days. A browser that
 * still uses one re-registers it on its next boot and re-syncs that drive.
 * Node only — no bun APIs.
 */
import { resolve } from "node:path";
import { createConnection } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const apply = args.includes("--apply");
const store = resolve(flag("--store", "./.ph/reactor-storage"));
const staleDays = args.includes("--stale-days") ? Number(flag("--stale-days", "NaN")) : undefined;
if (staleDays !== undefined && !(staleDays >= 0)) {
  console.error("--stale-days needs a number of days");
  process.exit(2);
}
const SENTINEL = JSON.stringify(["remote-first-sync-nothing"]);

// PGlite is single-writer: opening a store the reactor holds corrupts it.
const port = Number(flag("--port", "4001"));
const listening = await new Promise((done) => {
  const socket = createConnection({ port, host: "127.0.0.1" });
  socket.once("connect", () => (socket.destroy(), done(true)));
  socket.once("error", () => done(false));
});
if (listening && apply) {
  console.error(`REFUSED: something is listening on :${port} — stop the reactor before --apply.`);
  process.exit(1);
}

const db = new PGlite({ fs: new AtomicNodeFs(store, {}) });
await db.waitReady;
const rows = async (sql, params) => (await db.query(sql, params)).rows;
try {
  const all = await rows(`
    select r.name, r.collection_id, r.filter_document_ids::text as filter,
           c.cursor_ordinal, c.last_synced_at_utc_ms
      from reactor.sync_remotes r
      left join reactor.sync_cursors c on c.remote_name = r.name and c.cursor_type = 'outbox'`);
  const cutoff = staleDays === undefined ? undefined : Date.now() - staleDays * 86_400_000;
  const reason = (r) => {
    if (r.filter === SENTINEL) return "app sentinel channel";
    if (cutoff === undefined) return undefined;
    const last = r.last_synced_at_utc_ms ? Date.parse(r.last_synced_at_utc_ms) : undefined;
    if (last === undefined) return "no outbox cursor";
    return last < cutoff ? `silent since ${r.last_synced_at_utc_ms}` : undefined;
  };
  const doomed = all.map((r) => ({ ...r, why: reason(r) })).filter((r) => r.why);
  const [{ orphans }] = await rows(
    `select count(*)::int as orphans from reactor.sync_cursors c
      where not exists (select 1 from reactor.sync_remotes r where r.name = c.remote_name)`,
  );

  const summary = new Map();
  for (const r of doomed) {
    const k = `${r.collection_id}  (${r.why.startsWith("silent") ? "silent" : r.why})`;
    summary.set(k, (summary.get(k) ?? 0) + 1);
  }
  console.log(`store: ${store}`);
  console.log(`remotes: ${all.length} total, ${doomed.length} to remove, ${all.length - doomed.length} kept; orphan cursors: ${orphans}`);
  for (const [k, n] of [...summary].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

  if (!apply) {
    console.log(`dry run — nothing changed. Re-run with --apply (reactor stopped, store backed up).`);
  } else {
    const names = doomed.map((r) => r.name);
    await db.transaction(async (tx) => {
      if (names.length) {
        await tx.query(`delete from reactor.sync_cursors where remote_name = any($1)`, [names]);
        await tx.query(`delete from reactor.sync_remotes where name = any($1)`, [names]);
      }
      await tx.query(`delete from reactor.sync_cursors c
        where not exists (select 1 from reactor.sync_remotes r where r.name = c.remote_name)`);
    });
    const [{ left }] = await rows(`select count(*)::int as left from reactor.sync_remotes`);
    console.log(`applied — removed ${names.length} remote(s) and orphan cursors; ${left} remote(s) remain.`);
  }
} finally {
  await db.close(); // AtomicNodeFs writes the snapshot atomically on close
}
