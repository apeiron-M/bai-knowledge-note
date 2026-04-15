import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model";
import { reducer } from "./reducer.js";
import { knowledgeGraphDocumentType } from "./document-type.js";
import {
  assertIsKnowledgeGraphDocument,
  assertIsKnowledgeGraphState,
  isKnowledgeGraphDocument,
  isKnowledgeGraphState,
} from "./document-schema.js";
import type {
  KnowledgeGraphGlobalState,
  KnowledgeGraphLocalState,
  KnowledgeGraphPHState,
} from "./types.js";

export const initialGlobalState: KnowledgeGraphGlobalState = {
  nodes: [],
  edges: [],
  lastSyncedAt: null,
};
export const initialLocalState: KnowledgeGraphLocalState = {};

export const utils: DocumentModelUtils<KnowledgeGraphPHState> = {
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
