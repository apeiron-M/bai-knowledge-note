import type { Action } from "document-model";
import type {
  CreateObservationInput,
  PromoteObservationInput,
  ImplementObservationInput,
  ArchiveObservationInput,
} from "../types.js";

export type CreateObservationAction = Action & {
  type: "CREATE_OBSERVATION";
  input: CreateObservationInput;
};
export type PromoteObservationAction = Action & {
  type: "PROMOTE_OBSERVATION";
  input: PromoteObservationInput;
};
export type ImplementObservationAction = Action & {
  type: "IMPLEMENT_OBSERVATION";
  input: ImplementObservationInput;
};
export type ArchiveObservationAction = Action & {
  type: "ARCHIVE_OBSERVATION";
  input: ArchiveObservationInput;
};

export type ObservationObservationManagementAction =
  | CreateObservationAction
  | PromoteObservationAction
  | ImplementObservationAction
  | ArchiveObservationAction;
