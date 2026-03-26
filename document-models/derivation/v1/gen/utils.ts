import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type { DerivationGlobalState, DerivationLocalState } from "./types.js";
import type { DerivationPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { derivationDocumentType } from "./document-type.js";
import {
  isDerivationDocument,
  assertIsDerivationDocument,
  isDerivationState,
  assertIsDerivationState,
} from "./document-schema.js";

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
  fileExtension: "der.phd",
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

export const createDocument = utils.createDocument;
export const createState = utils.createState;
export const saveToFileHandle = utils.saveToFileHandle;
export const loadFromInput = utils.loadFromInput;
export const isStateOfType = utils.isStateOfType;
export const assertIsStateOfType = utils.assertIsStateOfType;
export const isDocumentOfType = utils.isDocumentOfType;
export const assertIsDocumentOfType = utils.assertIsDocumentOfType;
