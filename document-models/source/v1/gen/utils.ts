import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type { SourceGlobalState, SourceLocalState } from "./types.js";
import type { SourcePHState } from "./types.js";
import { reducer } from "./reducer.js";
import { sourceDocumentType } from "./document-type.js";
import {
  isSourceDocument,
  assertIsSourceDocument,
  isSourceState,
  assertIsSourceState,
} from "./document-schema.js";

export const initialGlobalState: SourceGlobalState = {
  title: null,
  description: null,
  content: null,
  sourceType: null,
  status: "INBOX",
  provenance: null,
  extractedClaims: [],
  extractionStats: null,
  createdAt: null,
  createdBy: null,
};
export const initialLocalState: SourceLocalState = {};

export const utils: DocumentModelUtils<SourcePHState> = {
  fileExtension: "src.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = sourceDocumentType;

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
    return isSourceState(state);
  },
  assertIsStateOfType(state) {
    return assertIsSourceState(state);
  },
  isDocumentOfType(document) {
    return isSourceDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsSourceDocument(document);
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
