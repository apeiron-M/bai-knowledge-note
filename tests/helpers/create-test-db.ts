import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";

export async function createTestDb() {
  const pglite = new PGlite();
  const db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
  await up(db as any);
  return {
    db,
    pglite,
    cleanup: async () => {
      await down(db as any);
      await db.destroy();
    },
  };
}
