import { type SignalDispatch } from "document-model";
import type {
  CreateTensionAction,
  ResolveTensionAction,
  DissolveTensionAction,
  AddInvolvedRefAction,
} from "./actions.js";
import type { TensionState } from "../types.js";

export interface TensionTensionManagementOperations {
  createTensionOperation: (
    state: TensionState,
    action: CreateTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  resolveTensionOperation: (
    state: TensionState,
    action: ResolveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  dissolveTensionOperation: (
    state: TensionState,
    action: DissolveTensionAction,
    dispatch?: SignalDispatch,
  ) => void;
  addInvolvedRefOperation: (
    state: TensionState,
    action: AddInvolvedRefAction,
    dispatch?: SignalDispatch,
  ) => void;
}
