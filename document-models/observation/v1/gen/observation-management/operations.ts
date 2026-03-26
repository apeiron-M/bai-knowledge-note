import { type SignalDispatch } from "document-model";
import type {
  CreateObservationAction,
  PromoteObservationAction,
  ImplementObservationAction,
  ArchiveObservationAction,
} from "./actions.js";
import type { ObservationState } from "../types.js";

export interface ObservationObservationManagementOperations {
  createObservationOperation: (
    state: ObservationState,
    action: CreateObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  promoteObservationOperation: (
    state: ObservationState,
    action: PromoteObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  implementObservationOperation: (
    state: ObservationState,
    action: ImplementObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  archiveObservationOperation: (
    state: ObservationState,
    action: ArchiveObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
}
