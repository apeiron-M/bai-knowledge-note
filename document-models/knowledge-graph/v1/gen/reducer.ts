// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { KnowledgeGraphPHState } from "knowledge-note/document-models/knowledge-graph/v1";

import { knowledgeGraphNodesOperations } from "../src/reducers/nodes.js";
import { knowledgeGraphEdgesOperations } from "../src/reducers/edges.js";
import { knowledgeGraphSyncOperations } from "../src/reducers/sync.js";

import {
  AddNodeInputSchema,
  RemoveNodeInputSchema,
  UpdateNodeInputSchema,
  AddEdgeInputSchema,
  RemoveEdgeInputSchema,
  UpdateEdgeInputSchema,
  SyncGraphInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<KnowledgeGraphPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "ADD_NODE": {
      AddNodeInputSchema().parse(action.input);

      knowledgeGraphNodesOperations.addNodeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_NODE": {
      RemoveNodeInputSchema().parse(action.input);

      knowledgeGraphNodesOperations.removeNodeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_NODE": {
      UpdateNodeInputSchema().parse(action.input);

      knowledgeGraphNodesOperations.updateNodeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_EDGE": {
      AddEdgeInputSchema().parse(action.input);

      knowledgeGraphEdgesOperations.addEdgeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_EDGE": {
      RemoveEdgeInputSchema().parse(action.input);

      knowledgeGraphEdgesOperations.removeEdgeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_EDGE": {
      UpdateEdgeInputSchema().parse(action.input);

      knowledgeGraphEdgesOperations.updateEdgeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SYNC_GRAPH": {
      SyncGraphInputSchema().parse(action.input);

      knowledgeGraphSyncOperations.syncGraphOperation(
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

export const reducer = createReducer<KnowledgeGraphPHState>(stateReducer);
