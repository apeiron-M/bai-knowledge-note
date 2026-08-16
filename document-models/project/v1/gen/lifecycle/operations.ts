/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ProjectGlobalState } from "../types.js";
import type {
  CreateProjectAction,
  LinkWbsAction,
  SetOwnerAction,
  SetProjectStatusAction,
  SetTargetDateAction,
  UpdateProjectInfoAction,
} from "./actions.js";

export interface ProjectLifecycleOperations {
  createProjectOperation: (
    state: ProjectGlobalState,
    action: CreateProjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateProjectInfoOperation: (
    state: ProjectGlobalState,
    action: UpdateProjectInfoAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectStatusOperation: (
    state: ProjectGlobalState,
    action: SetProjectStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOwnerOperation: (
    state: ProjectGlobalState,
    action: SetOwnerAction,
    dispatch?: SignalDispatch,
  ) => void;
  setTargetDateOperation: (
    state: ProjectGlobalState,
    action: SetTargetDateAction,
    dispatch?: SignalDispatch,
  ) => void;
  linkWbsOperation: (
    state: ProjectGlobalState,
    action: LinkWbsAction,
    dispatch?: SignalDispatch,
  ) => void;
}
