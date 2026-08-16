/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddKnowledgeRefInput,
  RemoveKnowledgeRefInput,
  SetReferencesInput,
} from "../types.js";

export type AddKnowledgeRefAction = Action & {
  type: "ADD_KNOWLEDGE_REF";
  input: AddKnowledgeRefInput;
};
export type RemoveKnowledgeRefAction = Action & {
  type: "REMOVE_KNOWLEDGE_REF";
  input: RemoveKnowledgeRefInput;
};
export type SetReferencesAction = Action & {
  type: "SET_REFERENCES";
  input: SetReferencesInput;
};

export type ProjectKnowledgeAction =
  | AddKnowledgeRefAction
  | RemoveKnowledgeRefAction
  | SetReferencesAction;
