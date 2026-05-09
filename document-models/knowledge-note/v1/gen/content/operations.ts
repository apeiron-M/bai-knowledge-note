/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeNoteGlobalState } from "../types.js";
import type {
  PatchContentAction,
  SetContentAction,
  SetDescriptionAction,
  SetMetadataFieldAction,
  SetMetadataListFieldAction,
  SetNoteTypeAction,
  SetTitleAction,
} from "./actions.js";

export interface KnowledgeNoteContentOperations {
  setTitleOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetTitleAction,
    dispatch?: SignalDispatch,
  ) => void;
  setDescriptionOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetDescriptionAction,
    dispatch?: SignalDispatch,
  ) => void;
  setNoteTypeOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetNoteTypeAction,
    dispatch?: SignalDispatch,
  ) => void;
  setContentOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetContentAction,
    dispatch?: SignalDispatch,
  ) => void;
  patchContentOperation: (
    state: KnowledgeNoteGlobalState,
    action: PatchContentAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMetadataFieldOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetMetadataFieldAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMetadataListFieldOperation: (
    state: KnowledgeNoteGlobalState,
    action: SetMetadataListFieldAction,
    dispatch?: SignalDispatch,
  ) => void;
}
