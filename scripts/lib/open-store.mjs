// Open an embedded PGlite store the way the Switchboard has since 6.2.3-dev.45: a plain Postgres
// directory through NodeFS (@powerhousedao/pglite-fs and its snapshot.bin are gone). A store that
// still holds a snapshot.bin predates that; the loose files beside it are stale, so it must be
// opened once by a Switchboard on 6.2.3-dev.52 or later, which converts it. Stop the Switchboard
// before opening a store here: PGlite is single-writer.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";

export async function openStore(dir) {
  if (existsSync(join(dir, "snapshot.bin"))) {
    console.error(`${dir} is still a snapshot store: start the Switchboard (6.2.3-dev.52 or later) on it once so it converts the store, then run this again.`);
    process.exit(1);
  }
  const db = new PGlite({ fs: new NodeFS(dir) });
  await db.waitReady;
  return db;
}
