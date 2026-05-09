/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating HealthReportDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  HealthReportDocument,
  HealthReportGlobalState,
  HealthReportLocalState,
  HealthReportPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): HealthReportGlobalState {
  return {
    generatedAt: null,
    generatedBy: null,
    mode: null,
    overallStatus: null,
    checks: [],
    graphMetrics: null,
    recommendations: [],
  };
}

export function defaultLocalState(): HealthReportLocalState {
  return {};
}

export function defaultPHState(): HealthReportPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<HealthReportGlobalState>,
): HealthReportGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<HealthReportLocalState>,
): HealthReportLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as HealthReportLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<HealthReportGlobalState>,
  localState?: Partial<HealthReportLocalState>,
): HealthReportPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a HealthReportDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createHealthReportDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<HealthReportGlobalState>;
    local?: Partial<HealthReportLocalState>;
  }>,
): HealthReportDocument {
  const document = utils.createDocument(
    state
      ? createState(
          createBaseState(state.auth, state.document),
          state.global,
          state.local,
        )
      : undefined,
  );

  return document;
}
