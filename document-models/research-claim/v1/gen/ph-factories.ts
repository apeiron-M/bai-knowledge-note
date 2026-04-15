/**
 * Factory methods for creating ResearchClaimDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  ResearchClaimDocument,
  ResearchClaimGlobalState,
  ResearchClaimLocalState,
  ResearchClaimPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): ResearchClaimGlobalState {
  return {
    title: null,
    description: null,
    content: null,
    kind: null,
    methodology: [],
    sources: [],
    topics: [],
    connections: [],
  };
}

export function defaultLocalState(): ResearchClaimLocalState {
  return {};
}

export function defaultPHState(): ResearchClaimPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<ResearchClaimGlobalState>,
): ResearchClaimGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as ResearchClaimGlobalState;
}

export function createLocalState(
  state?: Partial<ResearchClaimLocalState>,
): ResearchClaimLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as ResearchClaimLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<ResearchClaimGlobalState>,
  localState?: Partial<ResearchClaimLocalState>,
): ResearchClaimPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a ResearchClaimDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createResearchClaimDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<ResearchClaimGlobalState>;
    local?: Partial<ResearchClaimLocalState>;
  }>,
): ResearchClaimDocument {
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
