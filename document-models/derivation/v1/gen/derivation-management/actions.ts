import type { Action } from "document-model";
import type {
  InitializeDerivationInput,
  AddSignalInput,
  AddReseedEntryInput,
  UpdateDimensionRationaleInput,
} from "../types.js";

export type InitializeDerivationAction = Action & {
  type: "INITIALIZE_DERIVATION";
  input: InitializeDerivationInput;
};
export type AddSignalAction = Action & {
  type: "ADD_SIGNAL";
  input: AddSignalInput;
};
export type AddReseedEntryAction = Action & {
  type: "ADD_RESEED_ENTRY";
  input: AddReseedEntryInput;
};
export type UpdateDimensionRationaleAction = Action & {
  type: "UPDATE_DIMENSION_RATIONALE";
  input: UpdateDimensionRationaleInput;
};

export type DerivationDerivationManagementAction =
  | InitializeDerivationAction
  | AddSignalAction
  | AddReseedEntryAction
  | UpdateDimensionRationaleAction;
