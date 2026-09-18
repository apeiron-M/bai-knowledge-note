/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddLinkInput,
  AddTopicInput,
  RemoveLinkInput,
  RemoveTopicInput,
  UpdateLinkTypeInput,
} from "../types.js";

export type AddLinkAction = Action & { type: "ADD_LINK"; input: AddLinkInput };
export type RemoveLinkAction = Action & {
  type: "REMOVE_LINK";
  input: RemoveLinkInput;
};
export type UpdateLinkTypeAction = Action & {
  type: "UPDATE_LINK_TYPE";
  input: UpdateLinkTypeInput;
};
export type AddTopicAction = Action & {
  type: "ADD_TOPIC";
  input: AddTopicInput;
};
export type RemoveTopicAction = Action & {
  type: "REMOVE_TOPIC";
  input: RemoveTopicInput;
};

export type KnowledgeNoteLinkingAction =
  | AddLinkAction
  | RemoveLinkAction
  | UpdateLinkTypeAction
  | AddTopicAction
  | RemoveTopicAction;
