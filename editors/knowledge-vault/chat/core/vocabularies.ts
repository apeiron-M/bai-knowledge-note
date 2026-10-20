/**
 * Closed vocabularies for String input fields (spike round 6). The GraphQL
 * type is `String`, but the reducer (or the editor UI) only acts on these
 * literals, so the args grammar offers them as an enum. Keys are
 * `<model>:<OP>:<dotted.path>`. Pass `{ vocabularies: VOCABULARIES }` to
 * `buildVaultCatalog`.
 */
export interface Vocabulary {
  values: string[];
  /** Where the list comes from, and whether the reducer enforces it. */
  source: string;
}

const KN_STRING_METADATA = [
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
];

const KN_LIST_METADATA = [
  "models",
  "hooksUsed",
  "dispatchTargets",
  "modules",
  "inputs",
  "outputs",
  "consumedBy",
  "alternatives",
  "consequences",
];

const PHASES = ["create", "enrich", "reflect", "reweave", "verify"];

export const VOCABULARY_TABLE: Record<string, Vocabulary> = {
  "knowledge-note:SET_METADATA_FIELD:field": {
    values: KN_STRING_METADATA,
    source:
      "reducer, throws InvalidMetadataFieldError: document-models/knowledge-note/v1/src/reducers/content.ts:52",
  },
  "knowledge-note:SET_METADATA_LIST_FIELD:field": {
    values: KN_LIST_METADATA,
    source:
      "reducer, throws InvalidMetadataListFieldError: document-models/knowledge-note/v1/src/reducers/content.ts:85",
  },
  "moc:SET_METADATA_FIELD:field": {
    values: ["version"],
    source:
      "reducer, throws InvalidMetadataFieldError: document-models/moc/v1/src/reducers/moc-management.ts:108",
  },
  "vault-config:UPDATE_DIMENSION:dimension": {
    values: [
      "granularity",
      "organization",
      "linking",
      "processing",
      "navigation",
      "maintenance",
      "schema",
      "automation",
    ],
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:22",
  },
  "vault-config:UPDATE_VOCABULARY:key": {
    values: [
      "notes",
      "inbox",
      "reduce",
      "reflect",
      "reweave",
      "verify",
      "rethink",
      "topicMap",
      "description",
    ],
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:55",
  },
  "vault-config:UPDATE_MAINTENANCE_THRESHOLD:condition": {
    values: [
      "orphanThreshold",
      "danglingThreshold",
      "inboxPressure",
      "observationAccumulation",
      "tensionAccumulation",
      "mocOversize",
      "staleNoteDays",
    ],
    source:
      "reducer, ignores other values: document-models/vault-config/v1/src/reducers/config-management.ts:104",
  },
  "vault-config:UPDATE_PIPELINE_CONFIG:depth": {
    values: ["quick", "standard", "deep"],
    source:
      'convention: reducer default "standard" (config-management.ts:75) and the design doc ("quick, standard, deep")',
  },
  "knowledge-note:SET_NOTE_TYPE:noteType": {
    values: [
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
    ],
    source:
      "editor UI select only: editors/knowledge-note-editor/editor.tsx:26",
  },
  "research-claim:CREATE_CLAIM:kind": {
    values: ["research", "foundation", "methodology", "principle", "example"],
    source:
      "editor UI select only: editors/research-claim-editor/editor.tsx:487",
  },
  "health-report:GENERATE_REPORT:mode": {
    values: ["quick", "full", "three-space"],
    source: 'convention: design doc ("quick, full, three-space")',
  },
  "pipeline-queue:ADD_TASK:taskType": {
    values: ["claim", "enrichment"],
    source:
      "seeded phaseOrder keys (pipeline-queue.json initial state); unknown types never advance",
  },
  "pipeline-queue:ADD_TASK:currentPhase": {
    values: PHASES,
    source:
      "seeded phaseOrder values (pipeline-queue.json initial state) and editor PHASE_COLORS",
  },
  "pipeline-queue:ADVANCE_PHASE:handoff.phase": {
    values: PHASES,
    source:
      "seeded phaseOrder values (pipeline-queue.json initial state); stored only",
  },
};

/** `<model>:<OP>:<path>` → values, for `BuildCatalogOptions.vocabularies`. */
export const VOCABULARIES: Record<string, string[]> = Object.fromEntries(
  Object.entries(VOCABULARY_TABLE).map(([k, v]) => [k, v.values]),
);
