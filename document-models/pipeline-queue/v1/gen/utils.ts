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
  assertIsPipelineQueueDocument,
  assertIsPipelineQueueState,
  isPipelineQueueDocument,
  isPipelineQueueState,
} from "./document-schema.js";
import { pipelineQueueDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  PipelineQueueGlobalState,
  PipelineQueueLocalState,
  PipelineQueuePHState,
} from "./types.js";

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
