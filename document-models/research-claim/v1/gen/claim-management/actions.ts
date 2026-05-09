/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddResearchConnectionInput,
  CreateClaimInput,
  RemoveResearchConnectionInput,
  UpdateClaimContentInput,
} from "../types.js";

export type CreateClaimAction = Action & {
  type: "CREATE_CLAIM";
  input: CreateClaimInput;
};
export type AddResearchConnectionAction = Action & {
  type: "ADD_RESEARCH_CONNECTION";
  input: AddResearchConnectionInput;
};
export type RemoveResearchConnectionAction = Action & {
  type: "REMOVE_RESEARCH_CONNECTION";
  input: RemoveResearchConnectionInput;
};
export type UpdateClaimContentAction = Action & {
  type: "UPDATE_CLAIM_CONTENT";
  input: UpdateClaimContentInput;
};

export type ResearchClaimClaimManagementAction =
  | CreateClaimAction
  | AddResearchConnectionAction
  | RemoveResearchConnectionAction
  | UpdateClaimContentAction;
