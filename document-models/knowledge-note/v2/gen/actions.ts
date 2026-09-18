/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { KnowledgeNoteContentAction } from "./content/actions.js";
import type { KnowledgeNoteLifecycleAction } from "./lifecycle/actions.js";
import type { KnowledgeNoteLinkingAction } from "./linking/actions.js";
import type { KnowledgeNoteLocalAction } from "./local/actions.js";
import type { KnowledgeNoteProvenanceAction } from "./provenance/actions.js";

export * from "./content/actions.js";
export * from "./lifecycle/actions.js";
export * from "./linking/actions.js";
export * from "./local/actions.js";
export * from "./provenance/actions.js";

export type KnowledgeNoteAction =
  | KnowledgeNoteContentAction
  | KnowledgeNoteProvenanceAction
  | KnowledgeNoteLinkingAction
  | KnowledgeNoteLifecycleAction
  | KnowledgeNoteLocalAction;
