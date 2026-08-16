/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { ProjectGlobalState } from "../types.js";
import type {
  AddKnowledgeRefAction,
  RemoveKnowledgeRefAction,
  SetReferencesAction,
} from "./actions.js";

export interface ProjectKnowledgeOperations {
  addKnowledgeRefOperation: (
    state: ProjectGlobalState,
    action: AddKnowledgeRefAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeKnowledgeRefOperation: (
    state: ProjectGlobalState,
    action: RemoveKnowledgeRefAction,
    dispatch?: SignalDispatch,
  ) => void;
  setReferencesOperation: (
    state: ProjectGlobalState,
    action: SetReferencesAction,
    dispatch?: SignalDispatch,
  ) => void;
}
