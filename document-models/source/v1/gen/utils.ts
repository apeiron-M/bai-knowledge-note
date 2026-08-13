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
import { sourceUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsSourceDocument,
  assertIsSourceState,
  isSourceDocument,
  isSourceState,
} from "./document-schema.js";
import { sourceDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  SourceGlobalState,
  SourceLocalState,
  SourcePHState,
} from "./types.js";

export const initialGlobalState: SourceGlobalState = {
  title: null,
  description: null,
  content: null,
  sourceType: null,
  status: "INBOX",
  provenance: null,
  extractedClaims: [],
  extractionStats: null,
  createdAt: null,
  createdBy: null,
};
export const initialLocalState: SourceLocalState = {};

export const utils: DocumentModelUtils<SourcePHState> = {
  fileExtension: "",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, sourceDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: sourceUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isSourceState(state);
  },
  assertIsStateOfType(state) {
    return assertIsSourceState(state);
  },
  isDocumentOfType(document) {
    return isSourceDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsSourceDocument(document);
  },
};
