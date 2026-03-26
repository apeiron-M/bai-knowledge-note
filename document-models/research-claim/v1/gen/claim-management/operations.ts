import { type SignalDispatch } from "document-model";
import type {
  CreateClaimAction,
  AddResearchConnectionAction,
  RemoveResearchConnectionAction,
  UpdateClaimContentAction,
} from "./actions.js";
import type { ResearchClaimState } from "../types.js";

export interface ResearchClaimClaimManagementOperations {
  createClaimOperation: (
    state: ResearchClaimState,
    action: CreateClaimAction,
    dispatch?: SignalDispatch,
  ) => void;
  addResearchConnectionOperation: (
    state: ResearchClaimState,
    action: AddResearchConnectionAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeResearchConnectionOperation: (
    state: ResearchClaimState,
    action: RemoveResearchConnectionAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateClaimContentOperation: (
    state: ResearchClaimState,
    action: UpdateClaimContentAction,
    dispatch?: SignalDispatch,
  ) => void;
}
