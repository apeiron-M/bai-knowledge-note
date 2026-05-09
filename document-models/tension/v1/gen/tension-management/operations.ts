/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { TensionGlobalState } from "../types.js";
import type {
  AddInvolvedRefAction,
  CreateTensionAction,
  DissolveTensionAction,
  ResolveTensionAction,
} from "./actions.js";

export interface TensionTensionManagementOperations {
  createTensionOperation: (
    state: TensionGlobalState,
    action: CreateTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  resolveTensionOperation: (
    state: TensionGlobalState,
    action: ResolveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  dissolveTensionOperation: (
    state: TensionGlobalState,
    action: DissolveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addInvolvedRefOperation: (
    state: TensionGlobalState,
    action: AddInvolvedRefAction,
    dispatch?: SignalDispatch,
  ) => void;
}
