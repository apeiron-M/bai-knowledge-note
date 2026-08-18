/** Read-only forensic check: do these documents exist in a given store? */
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";
const dir = process.argv[2];
const ids = process.argv.slice(3);
const db = new PGlite({ fs: new AtomicNodeFs(dir) });
await db.waitReady;
await db.query(`SET search_path TO reactor, public`);
console.log(`\n=== ${dir} ===`);
for (const id of ids) {
  const ops = await db.query(
    `SELECT count(*)::int AS n, min(ordinal) AS lo, max(ordinal) AS hi
       FROM reactor.operation_index_operations WHERE "documentId" = $1`, [id]);
  const legacy = await db.query(
    `SELECT count(*)::int AS n FROM reactor."Operation" WHERE "documentId" = $1`, [id]);
  const r = ops.rows[0], l = legacy.rows[0];
  console.log(`${id}\n   index ops: ${r.n} (ordinal ${r.lo ?? "-"}..${r.hi ?? "-"})   Operation rows: ${l.n}`);
}
const tail = await db.query(
  `SELECT ordinal, "documentType", "documentId", (action->>'type') AS action
     FROM reactor.operation_index_operations ORDER BY ordinal DESC LIMIT 12`);
console.log("\nlast 12 operations in this store:");
for (const r of tail.rows)
  console.log(`  ${r.ordinal}  ${String(r.documentType).padEnd(22)} ${String(r.action).padEnd(18)} ${r.documentId}`);
await db.close();
