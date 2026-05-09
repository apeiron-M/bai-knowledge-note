/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ResearchClaimGlobalState } from "../types.js";
import type {
  AddResearchConnectionAction,
  CreateClaimAction,
  RemoveResearchConnectionAction,
  UpdateClaimContentAction,
} from "./actions.js";

export interface ResearchClaimClaimManagementOperations {
  createClaimOperation: (
    state: ResearchClaimGlobalState,
    action: CreateClaimAction,
    dispatch?: SignalDispatch,
  ) => void;
  addResearchConnectionOperation: (
    state: ResearchClaimGlobalState,
    action: AddResearchConnectionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeResearchConnectionOperation: (
    state: ResearchClaimGlobalState,
    action: RemoveResearchConnectionAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateClaimContentOperation: (
    state: ResearchClaimGlobalState,
    action: UpdateClaimContentAction,
    dispatch?: SignalDispatch,
  ) => void;
}
