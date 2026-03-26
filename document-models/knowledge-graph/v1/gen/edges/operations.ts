import { type SignalDispatch } from "document-model";
import type {
  AddEdgeAction,
  RemoveEdgeAction,
  UpdateEdgeAction,
} from "./actions.js";
import type { KnowledgeGraphState } from "../types.js";

export interface KnowledgeGraphEdgesOperations {
  addEdgeOperation: (
    state: KnowledgeGraphState,
    action: AddEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeEdgeOperation: (
    state: KnowledgeGraphState,
    action: RemoveEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateEdgeOperation: (
    state: KnowledgeGraphState,
    action: UpdateEdgeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
