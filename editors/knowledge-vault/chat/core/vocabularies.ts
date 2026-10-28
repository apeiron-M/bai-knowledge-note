/**
 * Closed vocabularies for String input fields: the one source the chat,
 * harness and training renderer constrain enums with. M2: the lists and
 * where each comes from live in `chat.overrides.ts` (`vocabularies`) at the
 * vault root; this is the generated manifest's table (`chat-manifest/`,
 * `npx nl-generate`). Canonical values are the app's own reducer lists,
 * editor lists and seed data (user decision, round 7);
 * `tests/unit/chat-vocabularies.test.ts` fails when a source drifts. A
 * changed value or order changes the step-2 prompt bytes, so it bumps
 * `PROMPT_FORMAT_VERSION`.
 */
import { chatManifest } from "../../../../chat-manifest/index.js";

/** `<model>:<OP>:<path>` → values, for `BuildCatalogOptions.vocabularies`. */
export const VOCABULARIES = chatManifest.vocabularies;

const vocabulary = (key: string): readonly string[] => {
  if (!Object.hasOwn(VOCABULARIES, key))
    throw new Error(`no vocabulary ${key} in chat-manifest/`);
  return VOCABULARIES[key];
};

/** Reducer list `STRING_METADATA_FIELDS` (knowledge-note content.ts). */
export const KN_STRING_METADATA_FIELDS = vocabulary(
  "knowledge-note:SET_METADATA_FIELD:field",
);
/** Reducer list `LIST_METADATA_FIELDS` (knowledge-note content.ts). */
export const KN_LIST_METADATA_FIELDS = vocabulary(
  "knowledge-note:SET_METADATA_LIST_FIELD:field",
);
/** Reducer list `STRING_METADATA_FIELDS` (moc moc-management.ts). */
export const MOC_STRING_METADATA_FIELDS = vocabulary(
  "moc:SET_METADATA_FIELD:field",
);
/** Reducer list `DIMENSION_KEYS` (vault-config config-management.ts). */
export const VAULT_DIMENSIONS = vocabulary(
  "vault-config:UPDATE_DIMENSION:dimension",
);
/** Reducer list `VOCABULARY_KEYS` (vault-config config-management.ts). */
export const VAULT_VOCABULARY_KEYS = vocabulary(
  "vault-config:UPDATE_VOCABULARY:key",
);
/** Reducer list `MAINTENANCE_KEYS` (vault-config config-management.ts). */
export const VAULT_MAINTENANCE_CONDITIONS = vocabulary(
  "vault-config:UPDATE_MAINTENANCE_THRESHOLD:condition",
);
/** No app list: reducer default `"standard"` plus the design doc. */
export const PIPELINE_DEPTHS = vocabulary(
  "vault-config:UPDATE_PIPELINE_CONFIG:depth",
);
/** Editor list `NOTE_TYPES` (knowledge-note-editor/editor.tsx). */
export const NOTE_TYPES = vocabulary("knowledge-note:SET_NOTE_TYPE:noteType");
/** Editor list: the kind `<select>` (research-claim-editor/editor.tsx). */
export const CLAIM_KINDS = vocabulary("research-claim:CREATE_CLAIM:kind");
/** No app list: the design doc's `GENERATE_REPORT` input comment. */
export const REPORT_MODES = vocabulary("health-report:GENERATE_REPORT:mode");
/** Seed data: the `phaseOrder` task types of the pipeline-queue initial state. */
export const PIPELINE_TASK_TYPES = vocabulary(
  "pipeline-queue:ADD_TASK:taskType",
);
/** Seed data: every phase in the pipeline-queue initial `phaseOrder`. */
export const PIPELINE_PHASES = vocabulary(
  "pipeline-queue:ADD_TASK:currentPhase",
);
