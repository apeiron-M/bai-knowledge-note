/**
 * The values each reducer writes when a state branch is still null.
 *
 * VaultConfig starts with `dimensions`, `vocabulary`, `pipeline` and
 * `maintenance` unset; every reducer creates its own branch on first write.
 * Sections need something to render before that first write, otherwise the
 * only way to reach those four operations would be to already have used them.
 *
 * ⚠️ These MIRROR the defaults in
 * `document-models/vault-config/v1/src/reducers/config-management.ts`. They are
 * duplicated because the reducer holds them inline, not as an export. If you
 * change one, change both — a mismatch would show the reader a value the first
 * save then silently replaces.
 */
import type {
  DimensionConfig,
  MaintenanceConfig,
  PipelineConfig,
  VocabularyMap,
} from "document-models/vault-config";

const CENTRE = { value: 3, confidence: 0.5, rationale: null };

export const DEFAULT_DIMENSIONS: DimensionConfig = {
  granularity: { ...CENTRE },
  organization: { ...CENTRE },
  linking: { ...CENTRE },
  processing: { ...CENTRE },
  navigation: { ...CENTRE },
  maintenance: { ...CENTRE },
  schema: { ...CENTRE },
  automation: { ...CENTRE },
};

export const DEFAULT_VOCABULARY: VocabularyMap = {
  notes: "notes",
  inbox: "inbox",
  reduce: "reduce",
  reflect: "reflect",
  reweave: "reweave",
  verify: "verify",
  rethink: "rethink",
  topicMap: "topic map",
  description: "description",
};

export const DEFAULT_PIPELINE: PipelineConfig = {
  depth: "STANDARD",
  autoChain: false,
  extractionSelectivity: 0.1,
};

export const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  orphanThreshold: 1,
  danglingThreshold: 1,
  inboxPressure: 5,
  observationAccumulation: 10,
  tensionAccumulation: 5,
  mocOversize: 40,
  staleNoteDays: 30,
};

/** Suffix for a section whose branch has never been written. */
export const UNSAVED_HINT = "Showing defaults — nothing saved here yet.";
