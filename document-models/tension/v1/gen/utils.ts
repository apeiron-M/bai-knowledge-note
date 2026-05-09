/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInput,
  baseSaveToFileHandle,
  defaultBaseState,
  generateId,
} from "document-model";
import {
  assertIsTensionDocument,
  assertIsTensionState,
  isTensionDocument,
  isTensionState,
} from "./document-schema.js";
import { tensionDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  TensionGlobalState,
  TensionLocalState,
  TensionPHState,
} from "./types.js";

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
