/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ProjectGlobalState } from "../types.js";
import type {
  AddMemberAction,
  RemoveMemberAction,
  UpdateMemberAction,
} from "./actions.js";

export interface ProjectTeamOperations {
  addMemberOperation: (
    state: ProjectGlobalState,
    action: AddMemberAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateMemberOperation: (
    state: ProjectGlobalState,
    action: UpdateMemberAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeMemberOperation: (
    state: ProjectGlobalState,
    action: RemoveMemberAction,
    dispatch?: SignalDispatch,
  ) => void;
}
