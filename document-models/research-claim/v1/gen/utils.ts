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
import { researchClaimUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsResearchClaimDocument,
  assertIsResearchClaimState,
  isResearchClaimDocument,
  isResearchClaimState,
} from "./document-schema.js";
import { researchClaimDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
  ResearchClaimPHState,
} from "./types.js";

export const initialGlobalState: ResearchClaimGlobalState = {
  title: null,
  description: null,
  content: null,
  kind: null,
  methodology: [],
  sources: [],
  topics: [],
  connections: [],
};
export const initialLocalState: ResearchClaimLocalState = {};

export const utils: DocumentModelUtils<ResearchClaimPHState> = {
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
      researchClaimDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: researchClaimUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isResearchClaimState(state);
  },
  assertIsStateOfType(state) {
    return assertIsResearchClaimState(state);
  },
  isDocumentOfType(document) {
    return isResearchClaimDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsResearchClaimDocument(document);
  },
};
