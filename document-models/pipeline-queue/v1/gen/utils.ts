import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  PipelineQueueGlobalState,
  PipelineQueueLocalState,
} from "./types.js";
import type { PipelineQueuePHState } from "./types.js";
import { reducer } from "./reducer.js";
import { pipelineQueueDocumentType } from "./document-type.js";
import {
  isPipelineQueueDocument,
  assertIsPipelineQueueDocument,
  isPipelineQueueState,
  assertIsPipelineQueueState,
} from "./document-schema.js";

export const initialGlobalState: PipelineQueueGlobalState = {
  schemaVersion: 3,
  phaseOrder: [
    { taskType: "claim", phases: ["create", "reflect", "reweave", "verify"] },
    {
      taskType: "enrichment",
      phases: ["enrich", "reflect", "reweave", "verify"],
    },
  ],
  tasks: [],
  completedCount: 0,
  activeCount: 0,
  lastProcessedAt: null,
};
export const initialLocalState: PipelineQueueLocalState = {};

export const utils: DocumentModelUtils<PipelineQueuePHState> = {
  fileExtension: "pq.phd",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = pipelineQueueDocumentType;

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
    return isPipelineQueueState(state);
  },
  assertIsStateOfType(state) {
    return assertIsPipelineQueueState(state);
  },
  isDocumentOfType(document) {
    return isPipelineQueueDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsPipelineQueueDocument(document);
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
