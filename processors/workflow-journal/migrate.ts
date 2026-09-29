import { sql, type Kysely } from "kysely";

/**
 * Bring the workflow runtime's journal tables up to 6.2.3-dev.31, from inside
 * the Switchboard, because a hosted database is not reachable any other way.
 *
 * dev.31 names a block by piece and action and writes
 * `trigger_state.piece_name` / `trigger_name` and `step_execution.piece_name`
 * / `block_name`, but creates those columns only for tables that do not exist
 * yet. Tables an earlier runtime made keep `block_type NOT NULL` without the
 * new columns, so every trigger enable fails with `column "piece_name" of
 * relation "trigger_state" does not exist`: a workflow looks enabled in Studio
 * and never runs. This adds the columns, fills them from `block_type`
 * (`@pkg[@version]#action`, `#trigger:name`, `core#…`) so run history keeps its
 * names, and drops NOT NULL from `block_type`.
 *
 * Idempotent, and a no-op on a store that never had `block_type` (a fresh
 * install, or one already migrated). Remove once the runtime migrates its own
 * tables (upstream report in docs/plans/workflow-piece.md §19). The runtime's
 * tables live in its hashed `workflow_runtime` namespace in the same
 * relational database processors are handed, so any schema holding a
 * `trigger_state` with `block_type` is migrated.
 */
export const WORKFLOW_JOURNAL_MIGRATION = `
DO $$
DECLARE
  s text;
  t record;
BEGIN
  FOR s IN
    SELECT table_schema FROM information_schema.columns
    WHERE table_name = 'trigger_state' AND column_name = 'block_type'
  LOOP
    FOR t IN SELECT * FROM (VALUES ('trigger_state', 'trigger_name'), ('step_execution', 'block_name')) AS v(tbl, name_col)
    LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = s AND table_name = t.tbl) THEN
        CONTINUE;
      END IF;
      EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS piece_name text', s, t.tbl);
      EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I text', s, t.tbl, t.name_col);
      EXECUTE format($q$
        UPDATE %1$I.%2$I SET
          piece_name = COALESCE(piece_name, CASE
            WHEN split_part(block_type, '#', 1) = 'core' THEN '@powerhousedao/piece-core'
            ELSE regexp_replace(regexp_replace(block_type, '#[^#]*$', ''), '(.)@[^@/]+$', '\\1')
          END),
          %3$I = COALESCE(%3$I, regexp_replace(regexp_replace(block_type, '^.*#', ''), '^trigger:', ''))
        WHERE block_type IS NOT NULL AND position('#' in block_type) > 0
      $q$, s, t.tbl, t.name_col);
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN block_type DROP NOT NULL', s, t.tbl);
    END LOOP;
  END LOOP;
END $$;
`;

/** Schemas whose `trigger_state` still requires `block_type`: what the migration would change. */
async function pendingSchemas(db: Kysely<unknown>): Promise<string[]> {
  const { rows } = await sql<{ s: string }>`
    SELECT table_schema AS s FROM information_schema.columns
    WHERE table_name = 'trigger_state' AND column_name = 'block_type' AND is_nullable = 'NO'
  `.execute(db);
  return rows.map((r) => r.s);
}

/** Run the migration when a store needs it. Returns the schemas it migrated. */
export async function migrateWorkflowJournal(
  db: Kysely<unknown>,
): Promise<string[]> {
  const pending = await pendingSchemas(db);
  if (pending.length === 0) return [];
  await sql.raw(WORKFLOW_JOURNAL_MIGRATION).execute(db);
  return pending;
}

let started: Promise<void> | undefined;

/**
 * Once per process, on the Switchboard only. Never blocks a caller and never
 * throws: a failure is logged, and the runtime keeps retrying its own enable,
 * so a later success still arms the trigger.
 */
export function migrateWorkflowJournalOnce(
  db: Kysely<unknown> | undefined,
): Promise<void> {
  if (!db) return Promise.resolve();
  return (started ??= migrateWorkflowJournal(db).then(
    (schemas) => {
      if (schemas.length)
        console.log(
          `[workflow-journal] migrated the workflow runtime's journal tables to dev.31 in ${schemas.join(", ")}`,
        );
    },
    (error: unknown) => {
      console.warn(
        `[workflow-journal] could not migrate the workflow runtime's journal tables: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  ));
}
