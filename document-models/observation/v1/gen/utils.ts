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
  assertIsObservationDocument,
  assertIsObservationState,
  isObservationDocument,
  isObservationState,
} from "./document-schema.js";
import { observationDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  ObservationGlobalState,
  ObservationLocalState,
  ObservationPHState,
} from "./types.js";

export const initialGlobalState: ObservationGlobalState = {
  title: null,
  description: null,
  content: null,
  category: null,
  status: "PENDING",
  observedAt: null,
  observedBy: null,
  promotedTo: null,
  promotedAt: null,
};
export const initialLocalState: ObservationLocalState = {};

export const utils: DocumentModelUtils<ObservationPHState> = {
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

    document.header.documentType = observationDocumentType;

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
    return isObservationState(state);
  },
  assertIsStateOfType(state) {
    return assertIsObservationState(state);
  },
  isDocumentOfType(document) {
    return isObservationDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsObservationDocument(document);
  },
};
