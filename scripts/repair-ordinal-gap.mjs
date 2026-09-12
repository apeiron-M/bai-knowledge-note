#!/usr/bin/env node
/**
 * Repair a Switchboard (stack < 6.2.3-dev.4) that refuses to boot with
 *   "Attachment reference read model cannot advance past missing ordinal N".
 *
 * The attachment-reference read model replays `operation_index_operations`
 * in strict ordinal order from its checkpoint (`reactor.ViewState`). Ordinals
 * come from a Postgres sequence, so any INSERT that is rolled back — e.g.
 * writes attempted while the reactor was still booting — leaves a permanent
 * hole the strict replay cannot cross. Every other read model tolerates the
 * hole; this one throws in `init()` and takes the process down.
 *
 * What this does, on a PGlite snapshot dir (`.ph/reactor-storage`):
 *   1. finds every hole in the ordinal sequence;
 *   2. moves the stuck read model's checkpoint to just before the first
 *      ordinal that exists after its current position (nothing is skipped —
 *      the ordinals in between have no operations);
 *   3. resets the Operation / ordinal / Keyframe sequences to their real
 *      maxima, so the NEXT committed write does not open a new hole.
 *
 * Refuses to run while a Switchboard holds the directory (checks for a
 * `snapshot.bin.tmp` in flight and asks you to stop `ph vetra` first), and
 * always writes a timestamped backup of `snapshot.bin` beside it.
 *
 *   node scripts/repair-ordinal-gap.mjs [.ph/reactor-storage] [--dry-run]
 *
 * Since 6.2.3-dev.4 the read model crosses holes on its own (it parks its
 * cursor at the gap and re-probes it), so this is no longer a pre-start step.
 * It stays useful as an optional repair: a permanent hole still makes every
 * boot re-read the tail after it, and moving the checkpoint past the hole
 * saves that. When no read model is stuck it changes nothing and writes no
 * backup.
 */
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".ph/reactor-storage");
const snap = path.join(dir, "snapshot.bin");
if (!existsSync(snap)) {
  console.error(`no snapshot.bin in ${dir}`);
  process.exit(2);
}
if (existsSync(path.join(dir, "snapshot.bin.tmp"))) {
  console.error("snapshot.bin.tmp exists — a Switchboard is writing this directory. Stop `ph vetra` first.");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let backedUp = false;
/** Back up the snapshot once, right before the first real write. */
function backupOnce() {
  if (dryRun || backedUp) return;
  copyFileSync(snap, `${snap}.bak-${stamp}`);
  console.log(`backup: ${snap}.bak-${stamp}`);
  backedUp = true;
}

const pg = await PGlite.create({ fs: new AtomicNodeFs(dir) });
const q = async (sql, params) => (await pg.query(sql, params)).rows;
const idx = `"reactor"."operation_index_operations"`;

const [{ max_ordinal }] = await q(`select max(ordinal)::int as max_ordinal from ${idx}`);
const holes = await q(
  `select o.ordinal + 1 as hole_from, (select min(n2.ordinal) from ${idx} n2 where n2.ordinal > o.ordinal) as resumes_at
     from ${idx} o left join ${idx} n on n.ordinal = o.ordinal + 1
    where n.ordinal is null and o.ordinal < (select max(ordinal) from ${idx}) order by 1`,
);
console.log(`max ordinal ${max_ordinal}; holes: ${holes.length === 0 ? "none" : holes.map((h) => `${h.hole_from}…${h.resumes_at - 1}`).join(", ")}`);

const views = await q(`select "readModelId", "lastOrdinal" from "reactor"."ViewState" order by 1`);
for (const v of views) console.log(`  ${v.readModelId}: lastOrdinal ${v.lastOrdinal}`);

let changed = false;
for (const v of views) {
  const last = Number(v.lastOrdinal);
  if (last >= max_ordinal) continue;
  const [{ next }] = await q(`select min(ordinal)::int as next from ${idx} where ordinal > $1`, [last]);
  if (next === null || next === last + 1) continue; // contiguous from here, nothing to do
  const target = next - 1;
  console.log(`${v.readModelId}: stuck at ${last}; next existing ordinal is ${next} → checkpoint → ${target}`);
  if (!dryRun) {
    backupOnce();
    await q(`update "reactor"."ViewState" set "lastOrdinal" = $1 where "readModelId" = $2`, [target, v.readModelId]);
    changed = true;
  }
}

const seqs = [
  ["operation_index_operations_ordinal_seq", `select max(ordinal)::bigint as m from ${idx}`],
  ["Operation_id_seq", `select max(id)::bigint as m from "reactor"."Operation"`],
  ["Keyframe_id_seq", `select max(id)::bigint as m from "reactor"."Keyframe"`],
];
for (const [name, maxSql] of seqs) {
  const [{ m }] = await q(maxSql);
  const [{ last_value }] = await q(`select last_value from pg_sequences where schemaname='reactor' and sequencename=$1`, [name]);
  if (m === null || last_value === null) continue;
  if (Number(last_value) !== Number(m)) {
    console.log(`${name}: last_value ${last_value} → ${m} (rows end at ${m})`);
    if (!dryRun) {
      backupOnce();
      await q(`select setval('reactor."${name}"', $1, true)`, [Number(m)]);
      changed = true;
    }
  }
}

if (dryRun) console.log("dry run — nothing written");
else console.log(changed ? "repaired; snapshot rewritten on close" : "nothing to repair");
await pg.close();
