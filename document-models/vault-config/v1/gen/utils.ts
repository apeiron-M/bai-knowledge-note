import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model";
import { reducer } from "./reducer.js";
import { vaultConfigDocumentType } from "./document-type.js";
import {
  assertIsVaultConfigDocument,
  assertIsVaultConfigState,
  isVaultConfigDocument,
  isVaultConfigState,
} from "./document-schema.js";
import type {
  VaultConfigGlobalState,
  VaultConfigLocalState,
  VaultConfigPHState,
} from "./types.js";

export const initialGlobalState: VaultConfigGlobalState = {
  name: null,
  domain: null,
  dimensions: null,
  vocabulary: null,
  features: [],
  pipeline: null,
  maintenance: null,
  extractionCategories: [],
  noteSchema: null,
  mocSchema: null,
  updatedAt: null,
};
export const initialLocalState: VaultConfigLocalState = {};

export const utils: DocumentModelUtils<VaultConfigPHState> = {
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

    document.header.documentType = vaultConfigDocumentType;

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
    return isVaultConfigState(state);
  },
  assertIsStateOfType(state) {
    return assertIsVaultConfigState(state);
  },
  isDocumentOfType(document) {
    return isVaultConfigDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsVaultConfigDocument(document);
  },
};
