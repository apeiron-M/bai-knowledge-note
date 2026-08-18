/**
 * Repair tool: unwedge the attachment-reference read model from a hole in
 * the operation-index ordinal sequence.
 *
 * WHY THIS IS NEEDED
 * `operation_index_operations.ordinal` is a Postgres `serial`. Sequence
 * values are not transactional — a rolled-back or failed insert burns a
 * number permanently and leaves a hole. The attachment-reference read
 * model asserts the sequence is gapless:
 *
 *   if (expectedOrdinal <= incomingMax)
 *     throw new Error(`... cannot advance past missing ordinal ${n}`);
 *
 * At runtime that throw is caught per-job and merely logged, but the
 * read model's `init()` replay is UNGUARDED, so once a hole exists the
 * reactor crashes on boot and the vault cannot start.
 *
 * WHAT THIS DOES
 * Moves that one read model's persisted cursor (`ViewState.lastOrdinal`)
 * past the hole. Nothing else is touched: no operations, no documents,
 * no other read model. Attachment references for operations at or before
 * the new cursor will not be indexed — harmless on a vault with no
 * attachments, and the only alternative is a reactor that will not boot.
 *
 * USAGE  (the reactor MUST be stopped — PGlite is single-writer)
 *   node scripts/reactor-repair/ordinal-gap.mjs --inspect
 *   node scripts/reactor-repair/ordinal-gap.mjs --apply
 */
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";

const DATA_DIR = "./.ph/reactor-storage";
const READ_MODEL_ID = "attachment-reference-read-model";
const apply = process.argv.includes("--apply");

const db = new PGlite({ fs: new AtomicNodeFs(DATA_DIR) });
await db.waitReady;
// The reactor keeps its tables in a dedicated schema, not `public`.
await db.query(`SET search_path TO reactor, public`);

async function q(sql, params) {
  const res = await db.query(sql, params);
  return res.rows;
}

console.log(`\n=== reactor store: ${DATA_DIR} ===`);

const viewState = await q(
  `SELECT "readModelId", "lastOrdinal" FROM reactor."ViewState" ORDER BY "readModelId"`,
);
console.log("\nViewState cursors:");
for (const r of viewState) console.log(`  ${r.readModelId.padEnd(34)} ${r.lastOrdinal}`);

const [{ min_ord, max_ord, total }] = await q(
  `SELECT min(ordinal) AS min_ord, max(ordinal) AS max_ord, count(*) AS total
     FROM reactor.operation_index_operations`,
);
console.log(`\noperation_index_operations: ${total} rows, ordinal ${min_ord}..${max_ord}`);
const expected = Number(max_ord) - Number(min_ord) + 1;
console.log(`  contiguous would be ${expected} rows -> ${expected - Number(total)} missing`);

// Every hole, not just the one the error names.
const gaps = await q(
  `SELECT prev + 1 AS gap_start, ordinal - 1 AS gap_end
     FROM (SELECT ordinal, lag(ordinal) OVER (ORDER BY ordinal) AS prev
             FROM reactor.operation_index_operations) t
    WHERE prev IS NOT NULL AND ordinal <> prev + 1
    ORDER BY gap_start`,
);
console.log(`\ngaps found: ${gaps.length}`);
for (const g of gaps.slice(0, 40)) {
  const n = Number(g.gap_end) - Number(g.gap_start) + 1;
  console.log(`  missing ${g.gap_start}${n > 1 ? `..${g.gap_end}` : ""} (${n})`);
}
if (gaps.length > 40) console.log(`  ... ${gaps.length - 40} more`);

const attachmentRefs = await q(`SELECT count(*) AS n FROM reactor.attachment_reference`).catch(
  () => [{ n: "table absent" }],
);
console.log(`\nattachment_reference rows: ${attachmentRefs[0].n}`);

const current = viewState.find((r) => r.readModelId === READ_MODEL_ID);
if (!current) {
  console.log(`\n'${READ_MODEL_ID}' has no ViewState row — nothing to repair.`);
  await db.close();
  process.exit(0);
}

// Park the cursor at the head: every hole is then behind it, so neither
// boot replay nor a later write can trip the contiguity assertion again.
const target = Number(max_ord);
console.log(
  `\n${READ_MODEL_ID}: lastOrdinal ${current.lastOrdinal} -> ${target}` +
    (apply ? "" : "   (dry run — pass --apply to write)"),
);

if (apply) {
  await q(`UPDATE reactor."ViewState" SET "lastOrdinal" = $1 WHERE "readModelId" = $2`, [
    target,
    READ_MODEL_ID,
  ]);
  const after = await q(
    `SELECT "readModelId", "lastOrdinal" FROM reactor."ViewState" WHERE "readModelId" = $1`,
    [READ_MODEL_ID],
  );
  console.log(`  written; read back: ${after[0].lastOrdinal}`);
  await db.close(); // closeFs() writes the snapshot atomically
  console.log("  snapshot flushed.");
} else {
  await db.close();
}
console.log("done.\n");
