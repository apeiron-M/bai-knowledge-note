/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils, PHBaseState, Reducer } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInputVersioned,
  baseSaveToFileHandle,
  createBaseState,
} from "document-model";
import { pipelineQueueUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
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
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(
      utils.createState,
      state,
      pipelineQueueDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: pipelineQueueUpgradeManifest,
    });
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
