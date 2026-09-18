/**
 * Hand-written migration. Codegen writes `upgrades/v<N>.ts` once and never
 * overwrites it, so edits here survive regeneration.
 *
 * v1 -> v2 changes two things about the global state:
 *
 *  - `noteType` was a free `String` and is now the `NoteType` enum. Real drives
 *    held `concept`, `CONCEPT`, `bug-pattern` and `BUG-PATTERN` for the same
 *    field, so the value is normalized the same way `scripts/migrate-note-type.mjs`
 *    does it: trim, upper-case, and collapse `-`/whitespace runs to `_`. A value
 *    that still is not a `NoteType` becomes `null` rather than being carried
 *    through — `noteType` is nullable, and an un-representable string would fail
 *    the generated zod schema and break the editor, which is the whole reason
 *    this migration exists. Run `scripts/migrate-note-type.mjs` first if you
 *    want to decide those cases explicitly instead of losing them.
 *
 *  - `updatedAt` was added; it is nullable and has no meaningful value for a
 *    note written before it existed, so it is seeded null.
 *
 * Both `state` and `initialState` are migrated so a rebuild from the operation
 * log converges with the stored state.
 */
import type { Action, PHDocument, UpgradeTransition } from "document-model";
import type { KnowledgeNotePHState as StateV1 } from "document-models/knowledge-note/v1";
import type { KnowledgeNotePHState as StateV2 } from "document-models/knowledge-note/v2";

const NOTE_TYPES = [
  "ARCHITECTURE",
  "BUG_PATTERN",
  "CONCEPT",
  "DECISION",
  "INTEGRATION",
  "OBSERVATION",
  "PATTERN",
  "PROCEDURE",
  "REFERENCE",
  "WORKFLOW",
] as const;

type NoteTypeV1 = StateV1["global"]["noteType"];
type NoteTypeV2 = StateV2["global"]["noteType"];

/** Same normalization as scripts/migrate-note-type.mjs; unmappable -> null. */
function canonicalNoteType(raw: NoteTypeV1): NoteTypeV2 {
  if (raw === null || raw === undefined) return null;
  const norm = raw.trim().toUpperCase().replace(/[-\s]+/g, "_");
  return (NOTE_TYPES as readonly string[]).includes(norm)
    ? (norm as NoteTypeV2)
    : null;
}

function migrateGlobal(global: StateV1["global"]): StateV2["global"] {
  return {
    ...global,
    noteType: canonicalNoteType(global.noteType),
    updatedAt: null,
  } as StateV2["global"];
}

function upgradeReducer(
  document: PHDocument<StateV1>,
  action: Action,
): PHDocument<StateV2> {
  return {
    ...document,
    state: { ...document.state, global: migrateGlobal(document.state.global) },
    initialState: {
      ...document.initialState,
      global: migrateGlobal(document.initialState.global),
    },
  } as PHDocument<StateV2>;
}

export const v2: UpgradeTransition = {
  toVersion: 2,
  upgradeReducer,
  description:
    "noteType becomes the NoteType enum (normalized, unmappable -> null); updatedAt seeded null",
};
