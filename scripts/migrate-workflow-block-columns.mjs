#!/usr/bin/env node
/**
 * Bring the workflow runtime's journal tables up to 6.2.3-dev.31.
 *
 * dev.31 names a block by its piece and action instead of one `block_type`
 * string (`@pkg[@version]#action`, `#trigger:name`), and writes
 * `trigger_state.piece_name` / `trigger_name` and `step_execution.piece_name`
 * / `block_name`. It creates those columns only for a table that does not
 * exist yet, so a store whose tables dev.28 made keeps `block_type NOT NULL`
 * and no new columns: every trigger enable and every journaled step fails with
 * `column "piece_name" of relation "trigger_state" does not exist`.
 *
 * This adds the columns, fills them from `block_type` so run history keeps its
 * names, and drops NOT NULL from `block_type`, which dev.31 no longer writes.
 * Idempotent. Every schema holding a `trigger_state` with `block_type` is
 * migrated (the runtime's namespace is a hash, e.g. `pbcaxolchf`).
 *
 * Usage (reactor STOPPED; back the store up first):
 *   node scripts/migrate-workflow-block-columns.mjs            # dry run
 *   node scripts/migrate-workflow-block-columns.mjs --apply
 *   node scripts/migrate-workflow-block-columns.mjs --store <dir>
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
const store = resolve(flag("--store", "./.ph/read-storage"));

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

/** `@pkg@1.2.0#action`, `@pkg#trigger:name`, `core#trigger:webhook` → piece and name. */
export function splitBlockType(blockType) {
  const hash = blockType.lastIndexOf("#");
  if (hash < 0) return null;
  let piece = blockType.slice(0, hash);
  const name = blockType.slice(hash + 1).replace(/^trigger:/, "");
  const at = piece.lastIndexOf("@");
  if (at > 0) piece = piece.slice(0, at);
  if (piece === "core") piece = "@powerhousedao/piece-core";
  return piece && name ? { piece, name } : null;
}

const db = new PGlite({ fs: new AtomicNodeFs(store, {}) });
const q = (sql, params) => db.query(sql, params);
const has = async (schema, table, column) =>
  (await q("select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3", [schema, table, column])).rows.length > 0;

const schemas = (await q("select table_schema s from information_schema.columns where table_name='trigger_state' and column_name='block_type'")).rows.map((r) => r.s);
if (schemas.length === 0) {
  console.log(`store: ${store}\nnothing to migrate: no trigger_state with block_type.`);
  await db.close();
  process.exit(0);
}
const plan = [
  ["trigger_state", "piece_name", "trigger_name"],
  ["step_execution", "piece_name", "block_name"],
];
console.log(`store: ${store}`);
for (const schema of schemas) {
  for (const [table, pieceCol, nameCol] of plan) {
    const rows = (await q(`select distinct block_type from "${schema}"."${table}" where block_type is not null`)).rows;
    const missing = [];
    for (const col of [pieceCol, nameCol]) if (!(await has(schema, table, col))) missing.push(col);
    const unparsed = rows.filter((r) => !splitBlockType(r.block_type)).map((r) => r.block_type);
    console.log(`${schema}.${table}: add ${missing.join(", ") || "nothing"}; ${rows.length} block type(s) to map${unparsed.length ? `; unparsable: ${unparsed.join(", ")}` : ""}`);
    if (!apply) continue;
    await db.transaction(async (tx) => {
      for (const col of missing) await tx.query(`alter table "${schema}"."${table}" add column "${col}" text`);
      for (const { block_type } of rows) {
        const split = splitBlockType(block_type);
        if (!split) continue;
        await tx.query(`update "${schema}"."${table}" set "${pieceCol}"=coalesce("${pieceCol}",$1), "${nameCol}"=coalesce("${nameCol}",$2) where block_type=$3`, [split.piece, split.name, block_type]);
      }
      await tx.query(`alter table "${schema}"."${table}" alter column block_type drop not null`);
    });
  }
}
console.log(apply ? "applied." : "dry run — nothing changed. Re-run with --apply (reactor stopped, store backed up).");
await db.close();
