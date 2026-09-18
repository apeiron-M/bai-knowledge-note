/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils, PHBaseState, Reducer } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInputVersioned,
  baseSaveToFileHandle,
  createBaseState,
} from "document-model";
import { knowledgeNoteUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsKnowledgeNoteDocument,
  assertIsKnowledgeNoteState,
  isKnowledgeNoteDocument,
  isKnowledgeNoteState,
} from "./document-schema.js";
import { knowledgeNoteDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
  KnowledgeNotePHState,
} from "./types.js";

export const initialGlobalState: KnowledgeNoteGlobalState = {
  title: null,
  description: null,
  noteType: null,
  content: null,
  status: "DRAFT",
  provenance: null,
  links: [],
  topics: [],
  scope: null,
  confidence: null,
  severity: null,
  editor: null,
  models: [],
  hooksUsed: [],
  dispatchTargets: [],
  modelId: null,
  modules: [],
  version: null,
  filePath: null,
  computes: null,
  inputs: [],
  outputs: [],
  consumedBy: [],
  context: null,
  alternatives: [],
  consequences: [],
  decisionStatus: null,
  model: null,
  sourceType: null,
  targetType: null,
  relationType: null,
  cardinality: null,
  errorMessage: null,
  rootCause: null,
  correctPattern: null,
  lifecycleEvents: [],
};
export const initialLocalState: KnowledgeNoteLocalState = {
  lastViewedAt: null,
  personalTags: [],
};

export const utils: DocumentModelUtils<KnowledgeNotePHState> = {
  fileExtension: "",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(
      utils.createState,
      state,
      knowledgeNoteDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: knowledgeNoteUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isKnowledgeNoteState(state);
  },
  assertIsStateOfType(state) {
    return assertIsKnowledgeNoteState(state);
  },
  isDocumentOfType(document) {
    return isKnowledgeNoteDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsKnowledgeNoteDocument(document);
  },
};
