import { type SignalDispatch } from "document-model";
import type { SetLastViewedAction } from "./actions.js";
import type { KnowledgeNoteLocalState } from "../types.js";

export interface KnowledgeNoteLocalOperations {
  setLastViewedOperation: (
    state: KnowledgeNoteLocalState,
    action: SetLastViewedAction,
    dispatch?: SignalDispatch,
  ) => void;
}
