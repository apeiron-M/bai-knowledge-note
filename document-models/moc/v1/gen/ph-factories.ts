/**
 * Factory methods for creating MocDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model/core";
import type {
  MocDocument,
  MocLocalState,
  MocGlobalState,
  MocPHState,
} from "./types.js";
import { createDocument } from "./utils.js";

export function defaultGlobalState(): MocGlobalState {
  return {
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
  };
}

export function defaultLocalState(): MocLocalState {
  return {};
}

export function defaultPHState(): MocPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<MocGlobalState>,
): MocGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as MocGlobalState;
}

export function createLocalState(
  state?: Partial<MocLocalState>,
): MocLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as MocLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<MocGlobalState>,
  localState?: Partial<MocLocalState>,
): MocPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a MocDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createMocDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<MocGlobalState>;
    local?: Partial<MocLocalState>;
  }>,
): MocDocument {
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
