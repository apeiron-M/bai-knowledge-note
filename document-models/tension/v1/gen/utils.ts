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
import { tensionUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsTensionDocument,
  assertIsTensionState,
  isTensionDocument,
  isTensionState,
} from "./document-schema.js";
import { tensionDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  TensionGlobalState,
  TensionLocalState,
  TensionPHState,
} from "./types.js";

export const initialGlobalState: TensionGlobalState = {
  title: null,
  description: null,
  content: null,
  involvedRefs: [],
  status: "OPEN",
  observedAt: null,
  observedBy: null,
  resolution: null,
  resolvedAt: null,
};
export const initialLocalState: TensionLocalState = {};

export const utils: DocumentModelUtils<TensionPHState> = {
  fileExtension: "",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, tensionDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: tensionUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isTensionState(state);
  },
  assertIsStateOfType(state) {
    return assertIsTensionState(state);
  },
  isDocumentOfType(document) {
    return isTensionDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsTensionDocument(document);
  },
};
