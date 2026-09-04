/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddProjectDeliverableInputSchema,
  AddProjectInputSchema,
  AddProjectKnowledgeRefInputSchema,
  LinkProjectWbsInputSchema,
  RemoveProjectDeliverableInputSchema,
  RemoveProjectInputSchema,
  RemoveProjectKnowledgeRefInputSchema,
  SetProjectExpenditureInputSchema,
  SetProjectMarginInputSchema,
  SetProjectReferencesInputSchema,
  SetProjectTotalBudgetInputSchema,
  UpdateProjectInputSchema,
  UpdateProjectOwnerInputSchema,
} from "../schema/zod.js";
import type {
  AddProjectDeliverableInput,
  AddProjectInput,
  AddProjectKnowledgeRefInput,
  LinkProjectWbsInput,
  RemoveProjectDeliverableInput,
  RemoveProjectInput,
  RemoveProjectKnowledgeRefInput,
  SetProjectExpenditureInput,
  SetProjectMarginInput,
  SetProjectReferencesInput,
  SetProjectTotalBudgetInput,
  UpdateProjectInput,
  UpdateProjectOwnerInput,
} from "../types.js";
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

export const addProject = (input: AddProjectInput) =>
  createAction<AddProjectAction>(
    "ADD_PROJECT",
    { ...input },
    undefined,
    AddProjectInputSchema,
    "global",
  );

export const updateProject = (input: UpdateProjectInput) =>
  createAction<UpdateProjectAction>(
    "UPDATE_PROJECT",
    { ...input },
    undefined,
    UpdateProjectInputSchema,
    "global",
  );

export const updateProjectOwner = (input: UpdateProjectOwnerInput) =>
  createAction<UpdateProjectOwnerAction>(
    "UPDATE_PROJECT_OWNER",
    { ...input },
    undefined,
    UpdateProjectOwnerInputSchema,
    "global",
  );

export const removeProject = (input: RemoveProjectInput) =>
  createAction<RemoveProjectAction>(
    "REMOVE_PROJECT",
    { ...input },
    undefined,
    RemoveProjectInputSchema,
    "global",
  );

export const setProjectMargin = (input: SetProjectMarginInput) =>
  createAction<SetProjectMarginAction>(
    "SET_PROJECT_MARGIN",
    { ...input },
    undefined,
    SetProjectMarginInputSchema,
    "global",
  );

export const setProjectTotalBudget = (input: SetProjectTotalBudgetInput) =>
  createAction<SetProjectTotalBudgetAction>(
    "SET_PROJECT_TOTAL_BUDGET",
    { ...input },
    undefined,
    SetProjectTotalBudgetInputSchema,
    "global",
  );

export const addProjectDeliverable = (input: AddProjectDeliverableInput) =>
  createAction<AddProjectDeliverableAction>(
    "ADD_PROJECT_DELIVERABLE",
    { ...input },
    undefined,
    AddProjectDeliverableInputSchema,
    "global",
  );

export const removeProjectDeliverable = (
  input: RemoveProjectDeliverableInput,
) =>
  createAction<RemoveProjectDeliverableAction>(
    "REMOVE_PROJECT_DELIVERABLE",
    { ...input },
    undefined,
    RemoveProjectDeliverableInputSchema,
    "global",
  );

export const setProjectExpenditure = (input: SetProjectExpenditureInput) =>
  createAction<SetProjectExpenditureAction>(
    "SET_PROJECT_EXPENDITURE",
    { ...input },
    undefined,
    SetProjectExpenditureInputSchema,
    "global",
  );

export const linkProjectWbs = (input: LinkProjectWbsInput) =>
  createAction<LinkProjectWbsAction>(
    "LINK_PROJECT_WBS",
    { ...input },
    undefined,
    LinkProjectWbsInputSchema,
    "global",
  );

export const addProjectKnowledgeRef = (input: AddProjectKnowledgeRefInput) =>
  createAction<AddProjectKnowledgeRefAction>(
    "ADD_PROJECT_KNOWLEDGE_REF",
    { ...input },
    undefined,
    AddProjectKnowledgeRefInputSchema,
    "global",
  );

export const removeProjectKnowledgeRef = (
  input: RemoveProjectKnowledgeRefInput,
) =>
  createAction<RemoveProjectKnowledgeRefAction>(
    "REMOVE_PROJECT_KNOWLEDGE_REF",
    { ...input },
    undefined,
    RemoveProjectKnowledgeRefInputSchema,
    "global",
  );

export const setProjectReferences = (input: SetProjectReferencesInput) =>
  createAction<SetProjectReferencesAction>(
    "SET_PROJECT_REFERENCES",
    { ...input },
    undefined,
    SetProjectReferencesInputSchema,
    "global",
  );
