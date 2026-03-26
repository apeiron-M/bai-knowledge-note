import { type SignalDispatch } from "document-model";
import type {
  CreateMocAction,
  UpdateOrientationAction,
  UpdateDescriptionAction,
  AddCoreIdeaAction,
  UpdateCoreIdeaAction,
  RemoveCoreIdeaAction,
  ReorderCoreIdeasAction,
  AddTensionAction,
  RemoveTensionAction,
  AddOpenQuestionAction,
  RemoveOpenQuestionAction,
  AddChildMocAction,
  RemoveChildMocAction,
} from "./actions.js";
import type { MocState } from "../types.js";

export interface MocMocManagementOperations {
  createMocOperation: (
    state: MocState,
    action: CreateMocAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateOrientationOperation: (
    state: MocState,
    action: UpdateOrientationAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDescriptionOperation: (
    state: MocState,
    action: UpdateDescriptionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addCoreIdeaOperation: (
    state: MocState,
    action: AddCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateCoreIdeaOperation: (
    state: MocState,
    action: UpdateCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeCoreIdeaOperation: (
    state: MocState,
    action: RemoveCoreIdeaAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderCoreIdeasOperation: (
    state: MocState,
    action: ReorderCoreIdeasAction,
    dispatch?: SignalDispatch,
  ) => void;
  addTensionOperation: (
    state: MocState,
    action: AddTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeTensionOperation: (
    state: MocState,
    action: RemoveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addOpenQuestionOperation: (
    state: MocState,
    action: AddOpenQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeOpenQuestionOperation: (
    state: MocState,
    action: RemoveOpenQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addChildMocOperation: (
    state: MocState,
    action: AddChildMocAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeChildMocOperation: (
    state: MocState,
    action: RemoveChildMocAction,
    dispatch?: SignalDispatch,
  ) => void;
}
