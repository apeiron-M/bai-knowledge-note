import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  KnowledgeGraphGlobalState,
  KnowledgeGraphLocalState,
} from "./types.js";
import type { KnowledgeGraphPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { knowledgeGraphDocumentType } from "./document-type.js";
import {
  isKnowledgeGraphDocument,
  assertIsKnowledgeGraphDocument,
  isKnowledgeGraphState,
  assertIsKnowledgeGraphState,
} from "./document-schema.js";

export const initialGlobalState: KnowledgeGraphGlobalState = {
  nodes: [],
  edges: [],
  lastSyncedAt: null,
};
export const initialLocalState: KnowledgeGraphLocalState = {};

export const utils: DocumentModelUtils<KnowledgeGraphPHState> = {
  fileExtension: "kg.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = knowledgeGraphDocumentType;

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
    return isKnowledgeGraphState(state);
  },
  assertIsStateOfType(state) {
    return assertIsKnowledgeGraphState(state);
  },
  isDocumentOfType(document) {
    return isKnowledgeGraphDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsKnowledgeGraphDocument(document);
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
