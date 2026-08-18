import { PGlite } from "@electric-sql/pglite";
import { AtomicNodeFs } from "@powerhousedao/pglite-fs";
const db = new PGlite({ fs: new AtomicNodeFs("./.ph/reactor-storage") });
await db.waitReady;
const t = await db.query(`
  SELECT table_schema, table_name FROM information_schema.tables
   WHERE table_schema NOT IN ('pg_catalog','information_schema')
     AND (table_name ILIKE '%viewstate%' OR table_name ILIKE '%operation%'
          OR table_name ILIKE '%attachment%')
   ORDER BY table_schema, table_name`);
for (const r of t.rows) console.log(`${r.table_schema}.${r.table_name}`);
const s = await db.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1`);
console.log("\nschemas:", s.rows.map(r=>r.nspname).join(", "));
await db.close();
