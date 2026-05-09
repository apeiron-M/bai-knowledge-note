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
  assertIsDerivationDocument,
  assertIsDerivationState,
  isDerivationDocument,
  isDerivationState,
} from "./document-schema.js";
import { derivationDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  DerivationGlobalState,
  DerivationLocalState,
  DerivationPHState,
} from "./types.js";

export const initialGlobalState: DerivationGlobalState = {
  engineVersion: null,
  derivedAt: null,
  signals: [],
  dimensionRationale: [],
  claimReferences: [],
  featureDecisions: [],
  coherenceResults: [],
  reseedHistory: [],
};
export const initialLocalState: DerivationLocalState = {};

export const utils: DocumentModelUtils<DerivationPHState> = {
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

    document.header.documentType = derivationDocumentType;

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
    return isDerivationState(state);
  },
  assertIsStateOfType(state) {
    return assertIsDerivationState(state);
  },
  isDocumentOfType(document) {
    return isDerivationDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsDerivationDocument(document);
  },
};
