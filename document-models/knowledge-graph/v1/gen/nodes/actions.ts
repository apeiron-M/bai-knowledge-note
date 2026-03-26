import type { Action } from "document-model";
import type {
  AddNodeInput,
  RemoveNodeInput,
  UpdateNodeInput,
} from "../types.js";

export type AddNodeAction = Action & { type: "ADD_NODE"; input: AddNodeInput };
export type RemoveNodeAction = Action & {
  type: "REMOVE_NODE";
  input: RemoveNodeInput;
};
export type UpdateNodeAction = Action & {
  type: "UPDATE_NODE";
  input: UpdateNodeInput;
};

export type KnowledgeGraphNodesAction =
  | AddNodeAction
  | RemoveNodeAction
  | UpdateNodeAction;
