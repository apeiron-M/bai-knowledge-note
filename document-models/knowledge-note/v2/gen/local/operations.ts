/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeNoteLocalState } from "../types.js";
import type { SetLastViewedAction } from "./actions.js";

export interface KnowledgeNoteLocalOperations {
  setLastViewedOperation: (
    state: KnowledgeNoteLocalState,
    action: SetLastViewedAction,
    dispatch?: SignalDispatch,
  ) => void;
}
