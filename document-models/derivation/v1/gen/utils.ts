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
import { derivationUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsDerivationDocument,
  assertIsDerivationState,
  isDerivationDocument,
  isDerivationState,
} from "./document-schema.js";
import { derivationDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  DerivationGlobalState,
  DerivationLocalState,
  DerivationPHState,
} from "./types.js";

export const initialGlobalState: DerivationGlobalState = {
  engineVersion: null,
  derivedAt: null,
  signals: [],
  dimensionRationale: [],
  claimReferences: [],
  featureDecisions: [],
  coherenceResults: [],
  reseedHistory: [],
};
export const initialLocalState: DerivationLocalState = {};

export const utils: DocumentModelUtils<DerivationPHState> = {
  fileExtension: "",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, derivationDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: derivationUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isDerivationState(state);
  },
  assertIsStateOfType(state) {
    return assertIsDerivationState(state);
  },
  isDocumentOfType(document) {
    return isDerivationDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsDerivationDocument(document);
  },
};
