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
import { healthReportUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsHealthReportDocument,
  assertIsHealthReportState,
  isHealthReportDocument,
  isHealthReportState,
} from "./document-schema.js";
import { healthReportDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  HealthReportGlobalState,
  HealthReportLocalState,
  HealthReportPHState,
} from "./types.js";

export const initialGlobalState: HealthReportGlobalState = {
  generatedAt: null,
  generatedBy: null,
  mode: null,
  overallStatus: null,
  checks: [],
  graphMetrics: null,
  recommendations: [],
};
export const initialLocalState: HealthReportLocalState = {};

export const utils: DocumentModelUtils<HealthReportPHState> = {
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
      healthReportDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: healthReportUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isHealthReportState(state);
  },
  assertIsStateOfType(state) {
    return assertIsHealthReportState(state);
  },
  isDocumentOfType(document) {
    return isHealthReportDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsHealthReportDocument(document);
  },
};
