// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { PipelineQueuePHState } from "@powerhousedao/knowledge-note/document-models/pipeline-queue/v1";

import { pipelineQueueQueueManagementOperations } from "../src/reducers/queue-management.js";

import {
  AddTaskInputSchema,
  AssignTaskInputSchema,
  AdvancePhaseInputSchema,
  CompleteTaskInputSchema,
  FailTaskInputSchema,
  BlockTaskInputSchema,
  UnblockTaskInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<PipelineQueuePHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "ADD_TASK": {
      AddTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.addTaskOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ASSIGN_TASK": {
      AssignTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.assignTaskOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADVANCE_PHASE": {
      AdvancePhaseInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.advancePhaseOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "COMPLETE_TASK": {
      CompleteTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.completeTaskOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "FAIL_TASK": {
      FailTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.failTaskOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "BLOCK_TASK": {
      BlockTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.blockTaskOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UNBLOCK_TASK": {
      UnblockTaskInputSchema().parse(action.input);

      pipelineQueueQueueManagementOperations.unblockTaskOperation(
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

export const reducer = createReducer<PipelineQueuePHState>(stateReducer);
