/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { DerivationGlobalState } from "../types.js";
import type {
  AddReseedEntryAction,
  AddSignalAction,
  InitializeDerivationAction,
  UpdateDimensionRationaleAction,
} from "./actions.js";

export interface DerivationDerivationManagementOperations {
  initializeDerivationOperation: (
    state: DerivationGlobalState,
    action: InitializeDerivationAction,
    dispatch?: SignalDispatch,
  ) => void;
  addSignalOperation: (
    state: DerivationGlobalState,
    action: AddSignalAction,
    dispatch?: SignalDispatch,
  ) => void;
  addReseedEntryOperation: (
    state: DerivationGlobalState,
    action: AddReseedEntryAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDimensionRationaleOperation: (
    state: DerivationGlobalState,
    action: UpdateDimensionRationaleAction,
    dispatch?: SignalDispatch,
  ) => void;
}
