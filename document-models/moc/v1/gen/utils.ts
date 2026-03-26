import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type { MocGlobalState, MocLocalState } from "./types.js";
import type { MocPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { mocDocumentType } from "./document-type.js";
import {
  isMocDocument,
  assertIsMocDocument,
  isMocState,
  assertIsMocState,
} from "./document-schema.js";

export const initialGlobalState: MocGlobalState = {
  title: null,
  description: null,
  orientation: null,
  tier: null,
  coreIdeas: [],
  tensions: [],
  openQuestions: [],
  agentNotes: [],
  parentRef: null,
  childRefs: [],
  noteCount: 0,
  createdAt: null,
  updatedAt: null,
};
export const initialLocalState: MocLocalState = {};

export const utils: DocumentModelUtils<MocPHState> = {
  fileExtension: "moc.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = mocDocumentType;

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
    return isMocState(state);
  },
  assertIsStateOfType(state) {
    return assertIsMocState(state);
  },
  isDocumentOfType(document) {
    return isMocDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsMocDocument(document);
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
