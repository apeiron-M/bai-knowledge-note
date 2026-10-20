/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeNoteGlobalState } from "../types.js";
import type { SetProvenanceAction } from "./actions.js";

export interface KnowledgeNoteProvenanceOperations {
  setProvenanceOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetProvenanceAction,
    dispatch?: SignalDispatch,
  ) => void;
}
