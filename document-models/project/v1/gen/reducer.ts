/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { ProjectPHState } from "document-models/project/v1";

import { projectDeliverablesOperations } from "../src/reducers/deliverables.js";
import { projectKnowledgeOperations } from "../src/reducers/knowledge.js";
import { projectLifecycleOperations } from "../src/reducers/lifecycle.js";
import { projectTeamOperations } from "../src/reducers/team.js";

import {
  AddDeliverableInputSchema,
  AddKnowledgeRefInputSchema,
  AddMemberInputSchema,
  CreateProjectInputSchema,
  LinkWbsInputSchema,
  RemoveDeliverableInputSchema,
  RemoveKnowledgeRefInputSchema,
  RemoveMemberInputSchema,
  SetDeliverableStatusInputSchema,
  SetOwnerInputSchema,
  SetProjectStatusInputSchema,
  SetReferencesInputSchema,
  SetTargetDateInputSchema,
  UpdateDeliverableInputSchema,
  UpdateMemberInputSchema,
  UpdateProjectInfoInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<ProjectPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "CREATE_PROJECT": {
      CreateProjectInputSchema().parse(action.input);

      projectLifecycleOperations.createProjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_PROJECT_INFO": {
      UpdateProjectInfoInputSchema().parse(action.input);

      projectLifecycleOperations.updateProjectInfoOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROJECT_STATUS": {
      SetProjectStatusInputSchema().parse(action.input);

      projectLifecycleOperations.setProjectStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_OWNER": {
      SetOwnerInputSchema().parse(action.input);

      projectLifecycleOperations.setOwnerOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_TARGET_DATE": {
      SetTargetDateInputSchema().parse(action.input);

      projectLifecycleOperations.setTargetDateOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "LINK_WBS": {
      LinkWbsInputSchema().parse(action.input);

      projectLifecycleOperations.linkWbsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_MEMBER": {
      AddMemberInputSchema().parse(action.input);

      projectTeamOperations.addMemberOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_MEMBER": {
      UpdateMemberInputSchema().parse(action.input);

      projectTeamOperations.updateMemberOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_MEMBER": {
      RemoveMemberInputSchema().parse(action.input);

      projectTeamOperations.removeMemberOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_DELIVERABLE": {
      AddDeliverableInputSchema().parse(action.input);

      projectDeliverablesOperations.addDeliverableOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_DELIVERABLE": {
      UpdateDeliverableInputSchema().parse(action.input);

      projectDeliverablesOperations.updateDeliverableOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_DELIVERABLE_STATUS": {
      SetDeliverableStatusInputSchema().parse(action.input);

      projectDeliverablesOperations.setDeliverableStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_DELIVERABLE": {
      RemoveDeliverableInputSchema().parse(action.input);

      projectDeliverablesOperations.removeDeliverableOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_KNOWLEDGE_REF": {
      AddKnowledgeRefInputSchema().parse(action.input);

      projectKnowledgeOperations.addKnowledgeRefOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_KNOWLEDGE_REF": {
      RemoveKnowledgeRefInputSchema().parse(action.input);

      projectKnowledgeOperations.removeKnowledgeRefOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_REFERENCES": {
      SetReferencesInputSchema().parse(action.input);

      projectKnowledgeOperations.setReferencesOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<ProjectPHState> = createReducer(stateReducer);
