/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ScopeOfWorkGlobalState } from "../types.js";
import type {
  AddProjectAction,
  AddProjectDeliverableAction,
  AddProjectKnowledgeRefAction,
  LinkProjectWbsAction,
  RemoveProjectAction,
  RemoveProjectDeliverableAction,
  RemoveProjectKnowledgeRefAction,
  SetProjectExpenditureAction,
  SetProjectMarginAction,
  SetProjectReferencesAction,
  SetProjectTotalBudgetAction,
  UpdateProjectAction,
  UpdateProjectOwnerAction,
} from "./actions.js";

export interface ScopeOfWorkProjectsOperations {
  addProjectOperation: (
    state: ScopeOfWorkGlobalState,
    action: AddProjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateProjectOperation: (
    state: ScopeOfWorkGlobalState,
    action: UpdateProjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateProjectOwnerOperation: (
    state: ScopeOfWorkGlobalState,
    action: UpdateProjectOwnerAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeProjectOperation: (
    state: ScopeOfWorkGlobalState,
    action: RemoveProjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectMarginOperation: (
    state: ScopeOfWorkGlobalState,
    action: SetProjectMarginAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectTotalBudgetOperation: (
    state: ScopeOfWorkGlobalState,
    action: SetProjectTotalBudgetAction,
    dispatch?: SignalDispatch,
  ) => void;
  addProjectDeliverableOperation: (
    state: ScopeOfWorkGlobalState,
    action: AddProjectDeliverableAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeProjectDeliverableOperation: (
    state: ScopeOfWorkGlobalState,
    action: RemoveProjectDeliverableAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectExpenditureOperation: (
    state: ScopeOfWorkGlobalState,
    action: SetProjectExpenditureAction,
    dispatch?: SignalDispatch,
  ) => void;
  linkProjectWbsOperation: (
    state: ScopeOfWorkGlobalState,
    action: LinkProjectWbsAction,
    dispatch?: SignalDispatch,
  ) => void;
  addProjectKnowledgeRefOperation: (
    state: ScopeOfWorkGlobalState,
    action: AddProjectKnowledgeRefAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeProjectKnowledgeRefOperation: (
    state: ScopeOfWorkGlobalState,
    action: RemoveProjectKnowledgeRefAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectReferencesOperation: (
    state: ScopeOfWorkGlobalState,
    action: SetProjectReferencesAction,
    dispatch?: SignalDispatch,
  ) => void;
}
