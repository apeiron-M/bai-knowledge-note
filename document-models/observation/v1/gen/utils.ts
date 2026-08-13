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
import { observationUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
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
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(
      utils.createState,
      state,
      observationDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: observationUpgradeManifest,
    });
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
