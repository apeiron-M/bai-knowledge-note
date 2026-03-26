import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  HealthReportGlobalState,
  HealthReportLocalState,
} from "./types.js";
import type { HealthReportPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { healthReportDocumentType } from "./document-type.js";
import {
  isHealthReportDocument,
  assertIsHealthReportDocument,
  isHealthReportState,
  assertIsHealthReportState,
} from "./document-schema.js";

export const initialGlobalState: HealthReportGlobalState = {
  generatedAt: null,
  generatedBy: null,
  mode: null,
  overallStatus: null,
  checks: [],
  graphMetrics: null,
  recommendations: [],
};
export const initialLocalState: HealthReportLocalState = {};

export const utils: DocumentModelUtils<HealthReportPHState> = {
  fileExtension: "hr.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = healthReportDocumentType;

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
    return isHealthReportState(state);
  },
  assertIsStateOfType(state) {
    return assertIsHealthReportState(state);
  },
  isDocumentOfType(document) {
    return isHealthReportDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsHealthReportDocument(document);
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
