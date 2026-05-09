/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating VaultConfigDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  VaultConfigDocument,
  VaultConfigGlobalState,
  VaultConfigLocalState,
  VaultConfigPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): VaultConfigGlobalState {
  return {
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
}

export function defaultLocalState(): VaultConfigLocalState {
  return {};
}

export function defaultPHState(): VaultConfigPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<VaultConfigGlobalState>,
): VaultConfigGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<VaultConfigLocalState>,
): VaultConfigLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as VaultConfigLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<VaultConfigGlobalState>,
  localState?: Partial<VaultConfigLocalState>,
): VaultConfigPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a VaultConfigDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createVaultConfigDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<VaultConfigGlobalState>;
    local?: Partial<VaultConfigLocalState>;
  }>,
): VaultConfigDocument {
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
