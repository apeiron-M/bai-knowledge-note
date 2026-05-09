/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ObservationGlobalState } from "../types.js";
import type {
  ArchiveObservationAction,
  CreateObservationAction,
  ImplementObservationAction,
  PromoteObservationAction,
} from "./actions.js";

export interface ObservationObservationManagementOperations {
  createObservationOperation: (
    state: ObservationGlobalState,
    action: CreateObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  promoteObservationOperation: (
    state: ObservationGlobalState,
    action: PromoteObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  implementObservationOperation: (
    state: ObservationGlobalState,
    action: ImplementObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
  archiveObservationOperation: (
    state: ObservationGlobalState,
    action: ArchiveObservationAction,
    dispatch?: SignalDispatch,
  ) => void;
}
