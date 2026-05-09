/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating TensionDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  TensionDocument,
  TensionGlobalState,
  TensionLocalState,
  TensionPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): TensionGlobalState {
  return {
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
}

export function defaultLocalState(): TensionLocalState {
  return {};
}

export function defaultPHState(): TensionPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<TensionGlobalState>,
): TensionGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<TensionLocalState>,
): TensionLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as TensionLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<TensionGlobalState>,
  localState?: Partial<TensionLocalState>,
): TensionPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a TensionDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createTensionDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<TensionGlobalState>;
    local?: Partial<TensionLocalState>;
  }>,
): TensionDocument {
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
