import { type SignalDispatch } from "document-model";
import type {
  AddNodeAction,
  RemoveNodeAction,
  UpdateNodeAction,
} from "./actions.js";
import type { KnowledgeGraphState } from "../types.js";

export interface KnowledgeGraphNodesOperations {
  addNodeOperation: (
    state: KnowledgeGraphState,
    action: AddNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeNodeOperation: (
    state: KnowledgeGraphState,
    action: RemoveNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateNodeOperation: (
    state: KnowledgeGraphState,
    action: UpdateNodeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
