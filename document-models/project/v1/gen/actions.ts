/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { ProjectDeliverablesAction } from "./deliverables/actions.js";
import type { ProjectKnowledgeAction } from "./knowledge/actions.js";
import type { ProjectLifecycleAction } from "./lifecycle/actions.js";
import type { ProjectTeamAction } from "./team/actions.js";

export * from "./deliverables/actions.js";
export * from "./knowledge/actions.js";
export * from "./lifecycle/actions.js";
export * from "./team/actions.js";

export type ProjectAction =
  | ProjectLifecycleAction
  | ProjectTeamAction
  | ProjectDeliverablesAction
  | ProjectKnowledgeAction;
