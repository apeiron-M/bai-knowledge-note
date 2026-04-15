/**
 * Factory methods for creating ObservationDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  ObservationDocument,
  ObservationGlobalState,
  ObservationLocalState,
  ObservationPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): ObservationGlobalState {
  return {
    title: null,
    description: null,
    content: null,
    category: null,
    status: "PENDING",
    observedAt: null,
    observedBy: null,
    promotedTo: null,
    promotedAt: null,
  };
}

export function defaultLocalState(): ObservationLocalState {
  return {};
}

export function defaultPHState(): ObservationPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<ObservationGlobalState>,
): ObservationGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as ObservationGlobalState;
}

export function createLocalState(
  state?: Partial<ObservationLocalState>,
): ObservationLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as ObservationLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<ObservationGlobalState>,
  localState?: Partial<ObservationLocalState>,
): ObservationPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a ObservationDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createObservationDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<ObservationGlobalState>;
    local?: Partial<ObservationLocalState>;
  }>,
): ObservationDocument {
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
