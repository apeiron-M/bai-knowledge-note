/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating ProjectDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  ProjectDocument,
  ProjectGlobalState,
  ProjectLocalState,
  ProjectPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): ProjectGlobalState {
  return {
    name: null,
    description: null,
    status: "PLANNING",
    owner: null,
    targetDate: null,
    wbsRef: null,
    team: [],
    deliverables: [],
    knowledgeRefs: [],
    references: [],
    createdAt: null,
  };
}

export function defaultLocalState(): ProjectLocalState {
  return {};
}

export function defaultPHState(): ProjectPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<ProjectGlobalState>,
): ProjectGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<ProjectLocalState>,
): ProjectLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as ProjectLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<ProjectGlobalState>,
  localState?: Partial<ProjectLocalState>,
): ProjectPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a ProjectDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createProjectDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<ProjectGlobalState>;
    local?: Partial<ProjectLocalState>;
  }>,
): ProjectDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
