/**
 * Factory methods for creating SourceDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model/core";
import type {
  SourceDocument,
  SourceLocalState,
  SourceGlobalState,
  SourcePHState,
} from "./types.js";
import { createDocument } from "./utils.js";

export function defaultGlobalState(): SourceGlobalState {
  return {
    title: null,
    description: null,
    content: null,
    sourceType: null,
    status: "INBOX",
    provenance: null,
    extractedClaims: [],
    extractionStats: null,
    createdAt: null,
    createdBy: null,
  };
}

export function defaultLocalState(): SourceLocalState {
  return {};
}

export function defaultPHState(): SourcePHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<SourceGlobalState>,
): SourceGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as SourceGlobalState;
}

export function createLocalState(
  state?: Partial<SourceLocalState>,
): SourceLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as SourceLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<SourceGlobalState>,
  localState?: Partial<SourceLocalState>,
): SourcePHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a SourceDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createSourceDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<SourceGlobalState>;
    local?: Partial<SourceLocalState>;
  }>,
): SourceDocument {
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
