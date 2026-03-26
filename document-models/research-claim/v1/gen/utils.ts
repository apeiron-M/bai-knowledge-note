import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
} from "./types.js";
import type { ResearchClaimPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { researchClaimDocumentType } from "./document-type.js";
import {
  isResearchClaimDocument,
  assertIsResearchClaimDocument,
  isResearchClaimState,
  assertIsResearchClaimState,
} from "./document-schema.js";

export const initialGlobalState: ResearchClaimGlobalState = {
  title: null,
  description: null,
  content: null,
  kind: null,
  methodology: [],
  sources: [],
  topics: [],
  connections: [],
};
export const initialLocalState: ResearchClaimLocalState = {};

export const utils: DocumentModelUtils<ResearchClaimPHState> = {
  fileExtension: "rc.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = researchClaimDocumentType;

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
    return isResearchClaimState(state);
  },
  assertIsStateOfType(state) {
    return assertIsResearchClaimState(state);
  },
  isDocumentOfType(document) {
    return isResearchClaimDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsResearchClaimDocument(document);
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
