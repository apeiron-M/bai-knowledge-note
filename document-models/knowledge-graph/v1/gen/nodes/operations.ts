/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeGraphGlobalState } from "../types.js";
import type {
  AddNodeAction,
  RemoveNodeAction,
  UpdateNodeAction,
} from "./actions.js";

export interface KnowledgeGraphNodesOperations {
  addNodeOperation: (
    state: KnowledgeGraphGlobalState,
    action: AddNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeNodeOperation: (
    state: KnowledgeGraphGlobalState,
    action: RemoveNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateNodeOperation: (
    state: KnowledgeGraphGlobalState,
    action: UpdateNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
