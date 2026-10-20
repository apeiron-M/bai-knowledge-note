import { openStore } from "../lib/open-store.mjs";
const db = await openStore("./.ph/reactor-storage");
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
