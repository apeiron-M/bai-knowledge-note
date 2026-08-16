/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { ProjectAction } from "./actions.js";
import type { ProjectState as ProjectGlobalState } from "./schema/types.js";

type ProjectLocalState = Record<PropertyKey, never>;

type ProjectPHState = PHBaseState & {
  global: ProjectGlobalState;
  local: ProjectLocalState;
};
type ProjectDocument = PHDocument<ProjectPHState>;

export * from "./schema/types.js";

export type {
  ProjectAction,
  ProjectDocument,
  ProjectGlobalState,
  ProjectLocalState,
  ProjectPHState,
};
