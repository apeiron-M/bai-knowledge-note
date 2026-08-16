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
import { workBreakdownStructureUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsWorkBreakdownStructureDocument,
  assertIsWorkBreakdownStructureState,
  isWorkBreakdownStructureDocument,
  isWorkBreakdownStructureState,
} from "./document-schema.js";
import { workBreakdownStructureDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  WorkBreakdownStructureGlobalState,
  WorkBreakdownStructureLocalState,
  WorkBreakdownStructurePHState,
} from "./types.js";

export const initialGlobalState: WorkBreakdownStructureGlobalState = {
  projectRef: null,
  owner: null,
  goals: [],
  references: [],
};
export const initialLocalState: WorkBreakdownStructureLocalState = {};

export const utils: DocumentModelUtils<WorkBreakdownStructurePHState> = {
  fileExtension: ".wbs",
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
      workBreakdownStructureDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: workBreakdownStructureUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isWorkBreakdownStructureState(state);
  },
  assertIsStateOfType(state) {
    return assertIsWorkBreakdownStructureState(state);
  },
  isDocumentOfType(document) {
    return isWorkBreakdownStructureDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsWorkBreakdownStructureDocument(document);
  },
};
