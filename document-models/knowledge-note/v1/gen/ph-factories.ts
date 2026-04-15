/**
 * Factory methods for creating KnowledgeNoteDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  KnowledgeNoteDocument,
  KnowledgeNoteGlobalState,
  KnowledgeNoteLocalState,
  KnowledgeNotePHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): KnowledgeNoteGlobalState {
  return {
    title: null,
    description: null,
    noteType: null,
    content: null,
    status: "DRAFT",
    provenance: null,
    links: [],
    topics: [],
    scope: null,
    confidence: null,
    severity: null,
    editor: null,
    models: [],
    hooksUsed: [],
    dispatchTargets: [],
    modelId: null,
    modules: [],
    version: null,
    filePath: null,
    computes: null,
    inputs: [],
    outputs: [],
    consumedBy: [],
    context: null,
    alternatives: [],
    consequences: [],
    decisionStatus: null,
    model: null,
    sourceType: null,
    targetType: null,
    relationType: null,
    cardinality: null,
    errorMessage: null,
    rootCause: null,
    correctPattern: null,
    lifecycleEvents: [],
  };
}

export function defaultLocalState(): KnowledgeNoteLocalState {
  return {
    lastViewedAt: null,
    personalTags: [],
  };
}

export function defaultPHState(): KnowledgeNotePHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<KnowledgeNoteGlobalState>,
): KnowledgeNoteGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as KnowledgeNoteGlobalState;
}

export function createLocalState(
  state?: Partial<KnowledgeNoteLocalState>,
): KnowledgeNoteLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as KnowledgeNoteLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<KnowledgeNoteGlobalState>,
  localState?: Partial<KnowledgeNoteLocalState>,
): KnowledgeNotePHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a KnowledgeNoteDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createKnowledgeNoteDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<KnowledgeNoteGlobalState>;
    local?: Partial<KnowledgeNoteLocalState>;
  }>,
): KnowledgeNoteDocument {
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
