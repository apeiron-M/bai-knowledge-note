/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeNoteGlobalState } from "../types.js";
import type {
  AddLinkAction,
  AddTopicAction,
  RemoveLinkAction,
  RemoveTopicAction,
  UpdateLinkTypeAction,
} from "./actions.js";

export interface KnowledgeNoteLinkingOperations {
  addLinkOperation: (
    state: KnowledgeNoteGlobalState,
    action: AddLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeLinkOperation: (
    state: KnowledgeNoteGlobalState,
    action: RemoveLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateLinkTypeOperation: (
    state: KnowledgeNoteGlobalState,
    action: UpdateLinkTypeAction,
    dispatch?: SignalDispatch,
  ) => void;
  addTopicOperation: (
    state: KnowledgeNoteGlobalState,
    action: AddTopicAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeTopicOperation: (
    state: KnowledgeNoteGlobalState,
    action: RemoveTopicAction,
    dispatch?: SignalDispatch,
  ) => void;
}
