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
import { mocUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsMocDocument,
  assertIsMocState,
  isMocDocument,
  isMocState,
} from "./document-schema.js";
import { mocDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type { MocGlobalState, MocLocalState, MocPHState } from "./types.js";

export const initialGlobalState: MocGlobalState = {
  title: null,
  description: null,
  orientation: null,
  tier: null,
  coreIdeas: [],
  tensions: [],
  openQuestions: [],
  agentNotes: [],
  parentRef: null,
  childRefs: [],
  noteCount: 0,
  createdAt: null,
  updatedAt: null,
  version: null,
};
export const initialLocalState: MocLocalState = {};

export const utils: DocumentModelUtils<MocPHState> = {
  fileExtension: "",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, mocDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: mocUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isMocState(state);
  },
  assertIsStateOfType(state) {
    return assertIsMocState(state);
  },
  isDocumentOfType(document) {
    return isMocDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsMocDocument(document);
  },
};
