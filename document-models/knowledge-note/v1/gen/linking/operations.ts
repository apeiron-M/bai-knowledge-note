import { type SignalDispatch } from "document-model";
import type {
  AddLinkAction,
  RemoveLinkAction,
  UpdateLinkTypeAction,
  AddTopicAction,
  RemoveTopicAction,
} from "./actions.js";
import type { KnowledgeNoteState } from "../types.js";

export interface KnowledgeNoteLinkingOperations {
  addLinkOperation: (
    state: KnowledgeNoteState,
    action: AddLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeLinkOperation: (
    state: KnowledgeNoteState,
    action: RemoveLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateLinkTypeOperation: (
    state: KnowledgeNoteState,
    action: UpdateLinkTypeAction,
    dispatch?: SignalDispatch,
  ) => void;
  addTopicOperation: (
    state: KnowledgeNoteState,
    action: AddTopicAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeTopicOperation: (
    state: KnowledgeNoteState,
    action: RemoveTopicAction,
    dispatch?: SignalDispatch,
  ) => void;
}
