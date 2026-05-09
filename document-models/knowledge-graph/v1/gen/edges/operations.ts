/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { KnowledgeGraphGlobalState } from "../types.js";
import type {
  AddEdgeAction,
  RemoveEdgeAction,
  UpdateEdgeAction,
} from "./actions.js";

export interface KnowledgeGraphEdgesOperations {
  addEdgeOperation: (
    state: KnowledgeGraphGlobalState,
    action: AddEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeEdgeOperation: (
    state: KnowledgeGraphGlobalState,
    action: RemoveEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateEdgeOperation: (
    state: KnowledgeGraphGlobalState,
    action: UpdateEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
