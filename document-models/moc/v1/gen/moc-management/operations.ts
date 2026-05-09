/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { MocGlobalState } from "../types.js";
import type {
  AddChildMocAction,
  AddCoreIdeaAction,
  AddOpenQuestionAction,
  AddTensionAction,
  CreateMocAction,
  RemoveChildMocAction,
  RemoveCoreIdeaAction,
  RemoveOpenQuestionAction,
  RemoveTensionAction,
  ReorderCoreIdeasAction,
  UpdateCoreIdeaAction,
  UpdateDescriptionAction,
  UpdateOrientationAction,
} from "./actions.js";

export interface MocMocManagementOperations {
  createMocOperation: (
    state: MocGlobalState,
    action: CreateMocAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateOrientationOperation: (
    state: MocGlobalState,
    action: UpdateOrientationAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDescriptionOperation: (
    state: MocGlobalState,
    action: UpdateDescriptionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addCoreIdeaOperation: (
    state: MocGlobalState,
    action: AddCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateCoreIdeaOperation: (
    state: MocGlobalState,
    action: UpdateCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeCoreIdeaOperation: (
    state: MocGlobalState,
    action: RemoveCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderCoreIdeasOperation: (
    state: MocGlobalState,
    action: ReorderCoreIdeasAction,
    dispatch?: SignalDispatch,
  ) => void;
  addTensionOperation: (
    state: MocGlobalState,
    action: AddTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeTensionOperation: (
    state: MocGlobalState,
    action: RemoveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addOpenQuestionOperation: (
    state: MocGlobalState,
    action: AddOpenQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeOpenQuestionOperation: (
    state: MocGlobalState,
    action: RemoveOpenQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addChildMocOperation: (
    state: MocGlobalState,
    action: AddChildMocAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeChildMocOperation: (
    state: MocGlobalState,
    action: RemoveChildMocAction,
    dispatch?: SignalDispatch,
  ) => void;
}
