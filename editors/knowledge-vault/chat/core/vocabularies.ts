/**
 * Closed vocabularies for String input fields: the one source the chat,
 * harness and training renderer constrain enums with. Canonical values are
 * the app's own reducer lists, editor lists and seed data (user decision,
 * round 7); `tests/unit/chat-vocabularies.test.ts` fails when a source
 * drifts. A changed value or order changes the step-2 prompt bytes, so it
 * bumps `PROMPT_FORMAT_VERSION`.
 */
export interface Vocabulary {
  values: readonly string[];
  /** Where the list comes from, and whether the reducer enforces it. */
  source: string;
}

/** Reducer list `STRING_METADATA_FIELDS` (knowledge-note content.ts:52). */
export const KN_STRING_METADATA_FIELDS = [
  "scope",
  "confidence",
  "severity",
  "editor",
  "modelId",
  "version",
  "filePath",
  "computes",
  "context",
  "decisionStatus",
  "model",
  "sourceType",
  "targetType",
  "relationType",
  "cardinality",
  "errorMessage",
  "rootCause",
  "correctPattern",
] as const;

/** Reducer list `LIST_METADATA_FIELDS` (knowledge-note content.ts:85). */
export const KN_LIST_METADATA_FIELDS = [
  "models",
  "hooksUsed",
  "dispatchTargets",
  "modules",
  "inputs",
  "outputs",
  "consumedBy",
  "alternatives",
  "consequences",
] as const;

/** Reducer list `STRING_METADATA_FIELDS` (moc moc-management.ts:108). */
export const MOC_STRING_METADATA_FIELDS = ["version"] as const;

/** Reducer list `DIMENSION_KEYS` (vault-config config-management.ts:22). */
export const VAULT_DIMENSIONS = [
  "granularity",
  "organization",
  "linking",
  "processing",
  "navigation",
  "maintenance",
  "schema",
  "automation",
] as const;

/** Reducer list `VOCABULARY_KEYS` (vault-config config-management.ts:55). */
export const VAULT_VOCABULARY_KEYS = [
  "notes",
  "inbox",
  "reduce",
  "reflect",
  "reweave",
  "verify",
  "rethink",
  "topicMap",
  "description",
] as const;

/** Reducer list `MAINTENANCE_KEYS` (vault-config config-management.ts:104). */
export const VAULT_MAINTENANCE_CONDITIONS = [
  "orphanThreshold",
  "danglingThreshold",
  "inboxPressure",
  "observationAccumulation",
  "tensionAccumulation",
  "mocOversize",
  "staleNoteDays",
] as const;

/** No app list: reducer default `"standard"` plus the design doc. */
export const PIPELINE_DEPTHS = ["quick", "standard", "deep"] as const;

/** Editor list `NOTE_TYPES` (knowledge-note-editor/editor.tsx:26). */
export const NOTE_TYPES = [
  "concept",
  "decision",
  "pattern",
  "observation",
  "procedure",
  "architecture",
  "bug-pattern",
  "integration",
  "workflow",
  "reference",
] as const;

/**
 * Editor list: the kind `<select>` (research-claim-editor/editor.tsx:487),
 * same set as its `KIND_COLORS` keys (:11).
 */
export const CLAIM_KINDS = [
  "research",
  "foundation",
  "methodology",
  "principle",
  "example",
] as const;

/** No app list: the design doc's `GENERATE_REPORT` input comment. */
export const REPORT_MODES = ["quick", "full", "three-space"] as const;

/**
 * Seed data: the `phaseOrder` task types of the pipeline-queue initial
 * state; the source editor queues extraction as `"claim"`
 * (source-editor/editor.tsx:94). Unknown types never advance a phase.
 */
export const PIPELINE_TASK_TYPES = ["claim", "enrichment"] as const;

/**
 * Seed data: every phase in the initial `phaseOrder`, same set as the
 * pipeline-queue editor's `PHASE_COLORS` keys (editor.tsx:16).
 */
export const PIPELINE_PHASES = [
  "create",
  "enrich",
  "reflect",
  "reweave",
  "verify",
] as const;

/** Keys are `<model>:<OP>:<dotted.path>`. */
export const VOCABULARY_TABLE: Record<string, Vocabulary> = {
  "knowledge-note:SET_METADATA_FIELD:field": {
    values: KN_STRING_METADATA_FIELDS,
    source:
      "reducer, throws InvalidMetadataFieldError: document-models/knowledge-note/v1/src/reducers/content.ts:52",
  },
  "knowledge-note:SET_METADATA_LIST_FIELD:field": {
    values: KN_LIST_METADATA_FIELDS,
    source:
      "reducer, throws InvalidMetadataListFieldError: document-models/knowledge-note/v1/src/reducers/content.ts:85",
  },
  "moc:SET_METADATA_FIELD:field": {
    values: MOC_STRING_METADATA_FIELDS,
    source:
      "reducer, throws InvalidMetadataFieldError: document-models/moc/v1/src/reducers/moc-management.ts:108",
  },
  "vault-config:UPDATE_DIMENSION:dimension": {
    values: VAULT_DIMENSIONS,
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:22",
  },
  "vault-config:UPDATE_VOCABULARY:key": {
    values: VAULT_VOCABULARY_KEYS,
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:55",
  },
  "vault-config:UPDATE_MAINTENANCE_THRESHOLD:condition": {
    values: VAULT_MAINTENANCE_CONDITIONS,
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:104",
  },
  "vault-config:UPDATE_PIPELINE_CONFIG:depth": {
    values: PIPELINE_DEPTHS,
    source:
      'convention: reducer default "standard" (config-management.ts:75) and the design doc ("Processing depth: quick, standard, deep", arscontexta-remote-knowledge-base.md:1172)',
  },
  "knowledge-note:SET_NOTE_TYPE:noteType": {
    values: NOTE_TYPES,
    source:
      "editor UI select only: editors/knowledge-note-editor/editor.tsx:26",
  },
  "research-claim:CREATE_CLAIM:kind": {
    values: CLAIM_KINDS,
    source:
      "editor UI select only: editors/research-claim-editor/editor.tsx:487 (KIND_COLORS :11)",
  },
  "health-report:GENERATE_REPORT:mode": {
    values: REPORT_MODES,
    source:
      'convention: design doc ("Report mode: quick, full, three-space", arscontexta-remote-knowledge-base.md:1331)',
  },
  "pipeline-queue:ADD_TASK:taskType": {
    values: PIPELINE_TASK_TYPES,
    source:
      "seed data: phaseOrder keys of the pipeline-queue initial state; editors/source-editor/editor.tsx:94 queues extraction as claim; unknown types never advance",
  },
  "pipeline-queue:ADD_TASK:currentPhase": {
    values: PIPELINE_PHASES,
    source:
      "seed data: phaseOrder values of the pipeline-queue initial state; editors/pipeline-queue-editor/editor.tsx:16 PHASE_COLORS",
  },
  "pipeline-queue:ADVANCE_PHASE:handoff.phase": {
    values: PIPELINE_PHASES,
    source:
      "seed data: phaseOrder values of the pipeline-queue initial state; stored only",
  },
};

/** `<model>:<OP>:<path>` → values, for `BuildCatalogOptions.vocabularies`. */
export const VOCABULARIES: Record<string, string[]> = Object.fromEntries(
  Object.entries(VOCABULARY_TABLE).map(([k, v]) => [k, [...v.values]]),
);
