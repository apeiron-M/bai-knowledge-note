/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddLinkInputSchema,
  AddTopicInputSchema,
  RemoveLinkInputSchema,
  RemoveTopicInputSchema,
  UpdateLinkTypeInputSchema,
} from "../schema/zod.js";
import type {
  AddLinkInput,
  AddTopicInput,
  RemoveLinkInput,
  RemoveTopicInput,
  UpdateLinkTypeInput,
} from "../types.js";
import type {
  AddLinkAction,
  AddTopicAction,
  RemoveLinkAction,
  RemoveTopicAction,
  UpdateLinkTypeAction,
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
