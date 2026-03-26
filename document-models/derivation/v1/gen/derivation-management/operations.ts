import { type SignalDispatch } from "document-model";
import type {
  InitializeDerivationAction,
  AddSignalAction,
  AddReseedEntryAction,
  UpdateDimensionRationaleAction,
} from "./actions.js";
import type { DerivationState } from "../types.js";

export interface DerivationDerivationManagementOperations {
  initializeDerivationOperation: (
    state: DerivationState,
    action: InitializeDerivationAction,
    dispatch?: SignalDispatch,
  ) => void;
  addSignalOperation: (
    state: DerivationState,
    action: AddSignalAction,
    dispatch?: SignalDispatch,
  ) => void;
  addReseedEntryOperation: (
    state: DerivationState,
    action: AddReseedEntryAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateDimensionRationaleOperation: (
    state: DerivationState,
    action: UpdateDimensionRationaleAction,
    dispatch?: SignalDispatch,
  ) => void;
}
