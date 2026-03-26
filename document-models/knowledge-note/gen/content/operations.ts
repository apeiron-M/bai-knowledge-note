import { type SignalDispatch } from "document-model";
import type {
  SetTitleAction,
  SetDescriptionAction,
  SetNoteTypeAction,
  SetContentAction,
  PatchContentAction,
  SetMetadataFieldAction,
  SetMetadataListFieldAction,
} from "./actions.js";
import type { KnowledgeNoteState } from "../types.js";

export interface KnowledgeNoteContentOperations {
  setTitleOperation: (
    state: KnowledgeNoteState,
    action: SetTitleAction,
    dispatch?: SignalDispatch,
  ) => void;
  setDescriptionOperation: (
    state: KnowledgeNoteState,
    action: SetDescriptionAction,
    dispatch?: SignalDispatch,
  ) => void;
  setNoteTypeOperation: (
    state: KnowledgeNoteState,
    action: SetNoteTypeAction,
    dispatch?: SignalDispatch,
  ) => void;
  setContentOperation: (
    state: KnowledgeNoteState,
    action: SetContentAction,
    dispatch?: SignalDispatch,
  ) => void;
  patchContentOperation: (
    state: KnowledgeNoteState,
    action: PatchContentAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMetadataFieldOperation: (
    state: KnowledgeNoteState,
    action: SetMetadataFieldAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMetadataListFieldOperation: (
    state: KnowledgeNoteState,
    action: SetMetadataListFieldAction,
    dispatch?: SignalDispatch,
  ) => void;
}
