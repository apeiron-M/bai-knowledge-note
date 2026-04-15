/**
 * Factory methods for creating KnowledgeGraphDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  KnowledgeGraphDocument,
  KnowledgeGraphGlobalState,
  KnowledgeGraphLocalState,
  KnowledgeGraphPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): KnowledgeGraphGlobalState {
  return {
    nodes: [],
    edges: [],
    lastSyncedAt: null,
  };
}

export function defaultLocalState(): KnowledgeGraphLocalState {
  return {};
}

export function defaultPHState(): KnowledgeGraphPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<KnowledgeGraphGlobalState>,
): KnowledgeGraphGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as KnowledgeGraphGlobalState;
}

export function createLocalState(
  state?: Partial<KnowledgeGraphLocalState>,
): KnowledgeGraphLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as KnowledgeGraphLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<KnowledgeGraphGlobalState>,
  localState?: Partial<KnowledgeGraphLocalState>,
): KnowledgeGraphPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a KnowledgeGraphDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createKnowledgeGraphDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<KnowledgeGraphGlobalState>;
    local?: Partial<KnowledgeGraphLocalState>;
  }>,
): KnowledgeGraphDocument {
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
