import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateWorkflowJournal, migrateWorkflowJournalOnce } from "./migrate.js";

// The runtime's tables as dev.28 made them: one block_type, required.
async function dev28Store(): Promise<Kysely<unknown>> {
  const db = new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`CREATE SCHEMA pbcaxolchf`.execute(db);
  await sql`CREATE TABLE pbcaxolchf.trigger_state (workflow_id text PRIMARY KEY, block_type text NOT NULL, status text NOT NULL)`.execute(db);
  await sql`CREATE TABLE pbcaxolchf.step_execution (id text PRIMARY KEY, block_type text NOT NULL, status text NOT NULL)`.execute(db);
  await sql`INSERT INTO pbcaxolchf.trigger_state VALUES
    ('w1', '@powerhousedao/piece-knowledge-vault#trigger:new-pipeline-task', 'DISABLED'),
    ('w2', 'core#trigger:webhook', 'DISABLED')`.execute(db);
  await sql`INSERT INTO pbcaxolchf.step_execution VALUES
    ('s1', '@powerhousedao/piece-knowledge-vault#extract-claims', 'SUCCEEDED'),
    ('s2', '@activepieces/piece-file-helper@0.2.0#read_file', 'SUCCEEDED'),
    ('s3', 'not-a-block-type', 'FAILED')`.execute(db);
  return db;
}

const rows = async (db: Kysely<unknown>, query: ReturnType<typeof sql>) => (await query.execute(db)).rows as Record<string, unknown>[];

describe("migrating the workflow runtime's journal tables to dev.31", () => {
  afterEach(() => vi.restoreAllMocks());

  it("adds the dev.31 columns, fills them from block_type, and lets dev.31 write without it", async () => {
    const db = await dev28Store();
    expect(await migrateWorkflowJournal(db)).toEqual(["pbcaxolchf"]);

    expect(await rows(db, sql`SELECT workflow_id, piece_name, trigger_name FROM pbcaxolchf.trigger_state ORDER BY 1`)).toEqual([
      { workflow_id: "w1", piece_name: "@powerhousedao/piece-knowledge-vault", trigger_name: "new-pipeline-task" },
      { workflow_id: "w2", piece_name: "@powerhousedao/piece-core", trigger_name: "webhook" },
    ]);
    expect(await rows(db, sql`SELECT id, piece_name, block_name FROM pbcaxolchf.step_execution ORDER BY 1`)).toEqual([
      { id: "s1", piece_name: "@powerhousedao/piece-knowledge-vault", block_name: "extract-claims" },
      { id: "s2", piece_name: "@activepieces/piece-file-helper", block_name: "read_file" },
      // Unparsable history is left as it was rather than guessed at.
      { id: "s3", piece_name: null, block_name: null },
    ]);
    // What failed before: dev.31's insert names piece_name and omits block_type.
    await sql`INSERT INTO pbcaxolchf.trigger_state (workflow_id, piece_name, trigger_name, status) VALUES ('w3', 'p', 't', 'ENABLED')`.execute(db);
    await sql`INSERT INTO pbcaxolchf.step_execution (id, piece_name, block_name, status) VALUES ('s4', 'p', 'a', 'RUNNING')`.execute(db);
  });

  it("does nothing on a fresh or already migrated store, and keeps what it filled", async () => {
    const fresh = new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) });
    expect(await migrateWorkflowJournal(fresh)).toEqual([]);

    const db = await dev28Store();
    await migrateWorkflowJournal(db);
    await sql`UPDATE pbcaxolchf.trigger_state SET trigger_name = 'kept' WHERE workflow_id = 'w1'`.execute(db);
    expect(await migrateWorkflowJournal(db)).toEqual([]);
    expect(await rows(db, sql`SELECT trigger_name FROM pbcaxolchf.trigger_state WHERE workflow_id = 'w1'`)).toEqual([{ trigger_name: "kept" }]);
  });

  it("migrates a store without step history too", async () => {
    const db = new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) });
    await sql`CREATE SCHEMA ns`.execute(db);
    await sql`CREATE TABLE ns.trigger_state (workflow_id text PRIMARY KEY, block_type text NOT NULL)`.execute(db);
    expect(await migrateWorkflowJournal(db)).toEqual(["ns"]);
  });

  it("runs once per process, logs what it did, and never throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await migrateWorkflowJournalOnce(undefined);
    const db = await dev28Store();
    await migrateWorkflowJournalOnce(db);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("migrated the workflow runtime's journal tables to dev.31 in pbcaxolchf"));
    // A second call in the same process reuses the first, whatever it is handed.
    await migrateWorkflowJournalOnce({} as Kysely<unknown>);
    expect(warn).not.toHaveBeenCalled();
  });

  it("only warns when the database refuses, so the Switchboard keeps booting", async () => {
    vi.resetModules();
    const fresh = await import("./migrate.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { executeQuery: () => Promise.reject(new Error("permission denied for schema")) } as unknown as Kysely<unknown>;
    await expect(fresh.migrateWorkflowJournalOnce(broken)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not migrate"));
  });

  it("stays quiet when there is nothing to migrate", async () => {
    vi.resetModules();
    const quiet = await import("./migrate.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await quiet.migrateWorkflowJournalOnce(new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) }));
    expect(log).not.toHaveBeenCalled();
  });
});
