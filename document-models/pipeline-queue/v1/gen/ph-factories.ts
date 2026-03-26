/**
 * Factory methods for creating PipelineQueueDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model/core";
import type {
  PipelineQueueDocument,
  PipelineQueueLocalState,
  PipelineQueueGlobalState,
  PipelineQueuePHState,
} from "./types.js";
import { createDocument } from "./utils.js";

export function defaultGlobalState(): PipelineQueueGlobalState {
  return {
    schemaVersion: 3,
    phaseOrder: [
      { taskType: "claim", phases: ["create", "reflect", "reweave", "verify"] },
      {
        taskType: "enrichment",
        phases: ["enrich", "reflect", "reweave", "verify"],
      },
    ],
    tasks: [],
    completedCount: 0,
    activeCount: 0,
    lastProcessedAt: null,
  };
}

export function defaultLocalState(): PipelineQueueLocalState {
  return {};
}

export function defaultPHState(): PipelineQueuePHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<PipelineQueueGlobalState>,
): PipelineQueueGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as PipelineQueueGlobalState;
}

export function createLocalState(
  state?: Partial<PipelineQueueLocalState>,
): PipelineQueueLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as PipelineQueueLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<PipelineQueueGlobalState>,
  localState?: Partial<PipelineQueueLocalState>,
): PipelineQueuePHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a PipelineQueueDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createPipelineQueueDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<PipelineQueueGlobalState>;
    local?: Partial<PipelineQueueLocalState>;
  }>,
): PipelineQueueDocument {
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
