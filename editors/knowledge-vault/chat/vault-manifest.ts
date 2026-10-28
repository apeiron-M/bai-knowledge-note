/**
 * The vault's chat manifest (nl-runtime `ChatManifest`), assembled by hand
 * from today's tables for M1. M2 generates it. Nothing in M1-core reads it
 * yet; the extracted ChatPanel (M1-UI) takes it.
 */
import { CHAT_MANIFEST_SCHEMA_VERSION, type ChatManifest } from "nl-runtime";
import { v1Catalog } from "./core/catalog-models.js";
import { DEFAULT_FIELD_OVERRIDES } from "./core/op-catalog.js";
import { OP_DESCRIPTIONS } from "./core/op-descriptions.js";
import {
  CTX_KIND_BY_TYPE,
  CURRENT_LISTS,
  linkedPlanGoals,
  REF_EXTRACTORS,
  STATE_CHOICES,
} from "./core/ref-candidates.js";
import {
  CREATE_TYPES,
  TYPE_LABELS,
  TYPE_NOUNS,
} from "./core/target-document.js";
import { VOCABULARIES } from "./core/vocabularies.js";

export const VAULT_MANIFEST: ChatManifest = {
  schemaVersion: CHAT_MANIFEST_SCHEMA_VERSION,
  catalog: v1Catalog(),
  fieldOverrides: DEFAULT_FIELD_OVERRIDES,
  refExtractors: REF_EXTRACTORS,
  stateChoices: STATE_CHOICES,
  currentLists: CURRENT_LISTS,
  contextKinds: CTX_KIND_BY_TYPE,
  crossDocument: linkedPlanGoals,
  typeLabels: TYPE_LABELS,
  typeNouns: TYPE_NOUNS,
  createTypes: CREATE_TYPES,
  opDescriptions: OP_DESCRIPTIONS,
  vocabularies: VOCABULARIES,
};
