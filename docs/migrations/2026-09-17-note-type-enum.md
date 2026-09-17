# Migration: `noteType` becomes the `NoteType` enum

**Model:** `bai/knowledge-note` · **Script:** [`scripts/migrate-note-type.mjs`](../../scripts/migrate-note-type.mjs)

## What changed

`KnowledgeNoteState.noteType` and `SetNoteTypeInput.noteType` were `String`. They are now
`enum NoteType { CONCEPT DECISION PATTERN OBSERVATION PROCEDURE ARCHITECTURE BUG_PATTERN INTEGRATION WORKFLOW REFERENCE }`.

A value outside the enum is rejected at three gates: the action creator, the generated reducer
(the operation is recorded with its error and skipped), and the REST lint (`LINT_REACTOR` /
`INVALID_INPUT`). Before the change, real drives held `concept`, `CONCEPT`, `bug-pattern`,
`BUG-PATTERN` and `RELATION` for the same field.

Stored state is **not** re-validated by the reactor, so existing notes keep their old spelling
until touched. This script brings every note on a drive to the enum once.

## Order of operations on a deployment

1. **Deploy the package** with the enum (this commit or later) and restart the Switchboard.
   Running the script against a Switchboard still serving the old bundle fails: its REST lint
   only accepted the lowercase spellings.
2. **Dry-run each vault drive** (default mode — reads only):
   ```bash
   export SWITCHBOARD_TOKEN="$(switchboard auth token)"     # or any bearer with WRITE on the drive
   node scripts/migrate-note-type.mjs --origin https://<host>-switchboard.vetra.io --drive <drive-uuid>
   ```
   The plan lists every `old → NEW` with counts. Exit `2` means a value that does not map
   mechanically (case-insensitive, `-`/space → `_`); decide it explicitly:
   ```bash
   --map RELATION=CONCEPT                 # every note carrying that value
   --set <documentId>=ARCHITECTURE        # one note
   ```
   Notes with a null `noteType` are reported and never touched.
3. **Apply**, then re-run the dry run — it must report `to change: 0`:
   ```bash
   node scripts/migrate-note-type.mjs --origin … --drive <drive-uuid> --apply [--map …] [--set …]
   ```
   Each note is written with one `SET_NOTE_TYPE` through `POST actions` (`wait: true`), read
   back, and counted only if the read-back matches. Failures are listed per note; exit `1`.
4. Repeat for every drive that holds `bai/knowledge-note` documents (`GET drives` lists the
   vault drives the token can read).

## Side effects

- `SET_NOTE_TYPE` stamps `provenance.updatedAt`; migrated notes read as recently updated to
  `knowledgeGraphRecent` / `knowledgeGraphStale` and appear in the vault's Activity view.
- Enumeration uses `knowledgeGraphNodes`, so the drive must be indexed
  (`knowledgeGraphReindex` if the graph tables are missing). Values are read from document
  state, not from the index, so a stale index cannot cause a wrong write.
- Nothing else writes to the note; edges, topics, lifecycle and content are untouched.

## Record

| Date | Drive | Result |
|---|---|---|
| 2026-09-17 | `c60679ae-8775-4576-acc6-cd364022df1b` (my-personal-vault, local) | 241/241 written and verified — all ten lowercase spellings |
| 2026-09-17 | `cf9b51d2-2915-45be-be2c-0ad939bfc1ae` (local) | 9/9 — 6× `BUG-PATTERN`, 1× `concept`, 2× `RELATION` via `--set` (`CONCEPT`, `ARCHITECTURE`); 973 already canonical |
