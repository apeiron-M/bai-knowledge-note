import { createAction } from "document-model";
import {
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  UpdateLinkTypeInputSchema,
  AddTopicInputSchema,
  RemoveTopicInputSchema,
} from "../schema/zod.js";
import type {
  AddLinkInput,
  RemoveLinkInput,
  UpdateLinkTypeInput,
  AddTopicInput,
  RemoveTopicInput,
} from "../types.js";
import type {
  AddLinkAction,
  RemoveLinkAction,
  UpdateLinkTypeAction,
  AddTopicAction,
  RemoveTopicAction,
} from "./actions.js";

export const addLink = (input: AddLinkInput) =>
  createAction<AddLinkAction>(
    "ADD_LINK",
    { ...input },
    undefined,
    AddLinkInputSchema,
    "global",
  );

export const removeLink = (input: RemoveLinkInput) =>
  createAction<RemoveLinkAction>(
    "REMOVE_LINK",
    { ...input },
    undefined,
    RemoveLinkInputSchema,
    "global",
  );

export const updateLinkType = (input: UpdateLinkTypeInput) =>
  createAction<UpdateLinkTypeAction>(
    "UPDATE_LINK_TYPE",
    { ...input },
    undefined,
    UpdateLinkTypeInputSchema,
    "global",
  );

export const addTopic = (input: AddTopicInput) =>
  createAction<AddTopicAction>(
    "ADD_TOPIC",
    { ...input },
    undefined,
    AddTopicInputSchema,
    "global",
  );

export const removeTopic = (input: RemoveTopicInput) =>
  createAction<RemoveTopicAction>(
    "REMOVE_TOPIC",
    { ...input },
    undefined,
    RemoveTopicInputSchema,
    "global",
  );
