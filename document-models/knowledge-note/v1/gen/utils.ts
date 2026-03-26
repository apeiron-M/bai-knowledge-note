import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
} from "./types.js";
import type { KnowledgeNotePHState } from "./types.js";
import { reducer } from "./reducer.js";
import { knowledgeNoteDocumentType } from "./document-type.js";
import {
  isKnowledgeNoteDocument,
  assertIsKnowledgeNoteDocument,
  isKnowledgeNoteState,
  assertIsKnowledgeNoteState,
} from "./document-schema.js";

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
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = knowledgeNoteDocumentType;

    // for backwards compatibility, but this is NOT a valid signed document id
    document.header.id = generateId();

    return document;
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInput(input, reducer);
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

export const createDocument = utils.createDocument;
export const createState = utils.createState;
export const saveToFileHandle = utils.saveToFileHandle;
export const loadFromInput = utils.loadFromInput;
export const isStateOfType = utils.isStateOfType;
export const assertIsStateOfType = utils.assertIsStateOfType;
export const isDocumentOfType = utils.isDocumentOfType;
export const assertIsDocumentOfType = utils.assertIsDocumentOfType;
