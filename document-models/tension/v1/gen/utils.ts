import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type { TensionGlobalState, TensionLocalState } from "./types.js";
import type { TensionPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { tensionDocumentType } from "./document-type.js";
import {
  isTensionDocument,
  assertIsTensionDocument,
  isTensionState,
  assertIsTensionState,
} from "./document-schema.js";

export const initialGlobalState: TensionGlobalState = {
  title: null,
  description: null,
  content: null,
  involvedRefs: [],
  status: "OPEN",
  observedAt: null,
  observedBy: null,
  resolution: null,
  resolvedAt: null,
};
export const initialLocalState: TensionLocalState = {};

export const utils: DocumentModelUtils<TensionPHState> = {
  fileExtension: "ten.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = tensionDocumentType;

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
    return isTensionState(state);
  },
  assertIsStateOfType(state) {
    return assertIsTensionState(state);
  },
  isDocumentOfType(document) {
    return isTensionDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsTensionDocument(document);
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
