/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ProjectGlobalState } from "../types.js";
import type {
  AddDeliverableAction,
  RemoveDeliverableAction,
  SetDeliverableStatusAction,
  UpdateDeliverableAction,
} from "./actions.js";

export interface ProjectDeliverablesOperations {
  addDeliverableOperation: (
    state: ProjectGlobalState,
    action: AddDeliverableAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDeliverableOperation: (
    state: ProjectGlobalState,
    action: UpdateDeliverableAction,
    dispatch?: SignalDispatch,
  ) => void;
  setDeliverableStatusOperation: (
    state: ProjectGlobalState,
    action: SetDeliverableStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeDeliverableOperation: (
    state: ProjectGlobalState,
    action: RemoveDeliverableAction,
    dispatch?: SignalDispatch,
  ) => void;
}
