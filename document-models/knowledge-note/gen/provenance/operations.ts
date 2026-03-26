import { type SignalDispatch } from "document-model";
import type { SetProvenanceAction } from "./actions.js";
import type { KnowledgeNoteState } from "../types.js";

export interface KnowledgeNoteProvenanceOperations {
  setProvenanceOperation: (
    state: KnowledgeNoteState,
    action: SetProvenanceAction,
    dispatch?: SignalDispatch,
  ) => void;
}
