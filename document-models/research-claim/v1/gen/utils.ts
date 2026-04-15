import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model";
import { reducer } from "./reducer.js";
import { researchClaimDocumentType } from "./document-type.js";
import {
  assertIsResearchClaimDocument,
  assertIsResearchClaimState,
  isResearchClaimDocument,
  isResearchClaimState,
} from "./document-schema.js";
import type {
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
  ResearchClaimPHState,
} from "./types.js";

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
