/**
 * Factory methods for creating DerivationDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model/core";
import type {
  DerivationDocument,
  DerivationLocalState,
  DerivationGlobalState,
  DerivationPHState,
} from "./types.js";
import { createDocument } from "./utils.js";

export function defaultGlobalState(): DerivationGlobalState {
  return {
    engineVersion: null,
    derivedAt: null,
    signals: [],
    dimensionRationale: [],
    claimReferences: [],
    featureDecisions: [],
    coherenceResults: [],
    reseedHistory: [],
  };
}

export function defaultLocalState(): DerivationLocalState {
  return {};
}

export function defaultPHState(): DerivationPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<DerivationGlobalState>,
): DerivationGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as DerivationGlobalState;
}

export function createLocalState(
  state?: Partial<DerivationLocalState>,
): DerivationLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as DerivationLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<DerivationGlobalState>,
  localState?: Partial<DerivationLocalState>,
): DerivationPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a DerivationDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createDerivationDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<DerivationGlobalState>;
    local?: Partial<DerivationLocalState>;
  }>,
): DerivationDocument {
  const document = createDocument(
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
