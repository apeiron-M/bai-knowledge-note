#!/usr/bin/env node
/**
 * Unstick a reactor read model whose checkpoint sits before a hole in the
 * operation index.
 *
 * `operation_index_operations.ordinal` is a Postgres `serial`, so every
 * rolled-back insert consumes a number that never gets a row. That is normal.
 * The attachment reference read model (reactor-attachments), however, replays
 * from its checkpoint and refuses to advance across a missing ordinal:
 *
 *   App crashed: Error: Attachment reference read model cannot advance past
 *   missing ordinal 27145
 *
 * On stacks before 6.2.3-dev.4 the next restart turns that into a startup
 * crash; since dev.4 the read model crosses the hole itself but re-reads the
 * tail after a permanent hole on every boot. Either way this moves the
 * checkpoint to just BEFORE the next ordinal that exists, so nothing real is
 * skipped — the missing ordinals have no rows to process.
 *
 * That moves the cursor past ONE hole. It parks again at the next one: the read
 * model saves its cursor only up to the end of the contiguous run it was handed,
 * so a store with several rolled-back inserts (measured 2026-09-28: 32 holes,
 * 276 missing ordinals) re-reads ~25 000 operations on every boot, and the first
 * write after boot waits for it (~38 s). `--through-max` moves the cursor to the
 * highest ordinal instead. That is safe only with the reactor STOPPED — then no
 * transaction is open and every hole is permanent — and only once a boot has
 * replayed the whole tail, which the read model does on every init (indexing
 * everything it reads; only the cursor is conservative). The guard for the
 * second condition: every other read model must already be at the highest
 * ordinal, i.e. the reactor caught up before it was stopped.
 *
 * Usage (reactor stopped; take a copy of the store first):
 *   node scripts/repair-read-model-checkpoint.mjs                    # dry run: report only
 *   node scripts/repair-read-model-checkpoint.mjs --apply            # write the new checkpoint
 *   node scripts/repair-read-model-checkpoint.mjs --through-max      # dry run: past EVERY hole
 *   node scripts/repair-read-model-checkpoint.mjs --through-max --apply
 *   node scripts/repair-read-model-checkpoint.mjs --store <dir> --read-model <id>
 *
 * Defaults: --store ./.ph/reactor-storage  --read-model attachment-reference-read-model
 * Node only (the Switchboard's own runtime) — no bun APIs.
 */
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const apply = args.includes("--apply");
const throughMax = args.includes("--through-max");
const store = resolve(flag("--store", "./.ph/reactor-storage"));
const readModelId = flag("--read-model", "attachment-reference-read-model");

const db = new PGlite({ fs: new AtomicNodeFs(store, {}) });
await db.waitReady;
const rows = async (sql, params) => (await db.query(sql, params)).rows;

try {
  const [state] = await rows(
    `select "lastOrdinal" from reactor."ViewState" where "readModelId" = $1`,
    [readModelId],
  );
  if (!state) {
    console.log(`no ViewState row for "${readModelId}" — nothing to repair`);
  } else {
    const last = Number(state.lastOrdinal);
    if (throughMax) {
      await repairThroughMax(last);
    } else {
    const [{ next }] = await rows(
      `select min(ordinal)::int as next from reactor.operation_index_operations where ordinal > $1`,
      [last],
    );
    if (next === null || next === undefined) {
      console.log(`${readModelId}: checkpoint ${last}, no later operations — nothing to repair`);
    } else if (next === last + 1) {
      console.log(`${readModelId}: checkpoint ${last}, next ordinal ${next} is contiguous — nothing to repair`);
    } else {
      const target = next - 1;
      console.log(
        `${readModelId}: checkpoint ${last}; ordinals ${last + 1}–${target} do not exist; next real ordinal is ${next}`,
      );
      if (!apply) {
        console.log(`dry run — would set checkpoint to ${target}. Re-run with --apply (reactor stopped, store backed up).`);
      } else {
        await db.query(
          `update reactor."ViewState" set "lastOrdinal" = $1 where "readModelId" = $2`,
          [target, readModelId],
        );
        const [after] = await rows(
          `select "lastOrdinal" from reactor."ViewState" where "readModelId" = $1`,
          [readModelId],
        );
        console.log(`applied — checkpoint is now ${after.lastOrdinal}`);
      }
    }
    }
  }
} finally {
  await db.close(); // AtomicNodeFs writes the snapshot atomically on close
}

async function repairThroughMax(last) {
  const [{ max, holes, missing }] = await rows(
    `select max(ordinal)::int as max,
            count(*) filter (where next > ordinal + 1)::int as holes,
            coalesce(sum(next - ordinal - 1) filter (where next > ordinal + 1), 0)::int as missing
       from (select ordinal, lead(ordinal) over (order by ordinal) as next
               from reactor.operation_index_operations
              where ordinal >= $1) t`,
    [last],
  );
  if (max === null || max <= last) {
    console.log(`${readModelId}: checkpoint ${last}, no later operations — nothing to repair`);
    return;
  }
  const others = await rows(
    `select "readModelId", "lastOrdinal"::int as last from reactor."ViewState" where "readModelId" <> $1`,
    [readModelId],
  );
  const behind = others.filter((o) => o.last < max);
  console.log(
    `${readModelId}: checkpoint ${last}, highest ordinal ${max}; ${max - last} ordinals ahead, ` +
      `${holes} hole(s) (${missing} missing) — every boot re-reads this tail`,
  );
  if (behind.length > 0) {
    console.log(
      `REFUSED: ${behind.map((o) => `${o.readModelId} at ${o.last}`).join(", ")} ` +
        `not at ${max} — the reactor had not caught up. Start it, let it settle, stop it, re-run.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log(`dry run — would set checkpoint to ${max}. Re-run with --through-max --apply (reactor stopped, store backed up).`);
    return;
  }
  await db.query(
    `update reactor."ViewState" set "lastOrdinal" = $1 where "readModelId" = $2`,
    [max, readModelId],
  );
  const [after] = await rows(
    `select "lastOrdinal" from reactor."ViewState" where "readModelId" = $1`,
    [readModelId],
  );
  console.log(`applied — checkpoint is now ${after.lastOrdinal}`);
}
