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
import { vaultConfigUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsVaultConfigDocument,
  assertIsVaultConfigState,
  isVaultConfigDocument,
  isVaultConfigState,
} from "./document-schema.js";
import { vaultConfigDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  VaultConfigGlobalState,
  VaultConfigLocalState,
  VaultConfigPHState,
} from "./types.js";

export const initialGlobalState: VaultConfigGlobalState = {
  name: null,
  domain: null,
  dimensions: null,
  vocabulary: null,
  features: [],
  pipeline: null,
  maintenance: null,
  extractionCategories: [],
  noteSchema: null,
  mocSchema: null,
  updatedAt: null,
};
export const initialLocalState: VaultConfigLocalState = {};

export const utils: DocumentModelUtils<VaultConfigPHState> = {
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
      vaultConfigDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: vaultConfigUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isVaultConfigState(state);
  },
  assertIsStateOfType(state) {
    return assertIsVaultConfigState(state);
  },
  isDocumentOfType(document) {
    return isVaultConfigDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsVaultConfigDocument(document);
  },
};
