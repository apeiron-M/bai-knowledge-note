-- Bring the workflow runtime's journal tables up to 6.2.3-dev.31 on Postgres.
-- The same fix as scripts/migrate-workflow-block-columns.mjs (PGlite), for a
-- hosted Switchboard. Run once, with the Switchboard stopped or before it
-- first enables a trigger on dev.31. Idempotent: safe to run again.
--
-- dev.31 writes trigger_state.piece_name/trigger_name and
-- step_execution.piece_name/block_name but only creates them for new tables;
-- tables an earlier runtime made keep block_type NOT NULL, and every trigger
-- enable fails with: column "piece_name" of relation "trigger_state" does not
-- exist. This adds the columns, fills them from block_type
-- ('@pkg[@version]#action', '#trigger:name', 'core#...'), and drops NOT NULL
-- from block_type. Every schema holding such a trigger_state is migrated (the
-- runtime's namespace is a short hash).
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
      -- piece: before the last '#', without an '@version' suffix; 'core' is the built-in piece.
      EXECUTE format($q$
        UPDATE %1$I.%2$I SET
          piece_name = COALESCE(piece_name, CASE
            WHEN split_part(block_type, '#', 1) = 'core' THEN '@powerhousedao/piece-core'
            ELSE regexp_replace(regexp_replace(block_type, '#[^#]*$', ''), '(.)@[^@/]+$', '\1')
          END),
          %3$I = COALESCE(%3$I, regexp_replace(regexp_replace(block_type, '^.*#', ''), '^trigger:', ''))
        WHERE block_type IS NOT NULL AND position('#' in block_type) > 0
      $q$, s, t.tbl, t.name_col);
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN block_type DROP NOT NULL', s, t.tbl);
      RAISE NOTICE 'migrated %.%', s, t.tbl;
    END LOOP;
  END LOOP;
END $$;
