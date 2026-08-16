/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { WorkBreakdownStructureGlobalState } from "../types.js";
import type {
  AddNoteAction,
  RemoveNoteAction,
  SetOwnerAction,
  SetProjectRefAction,
  SetReferencesAction,
} from "./actions.js";

export interface WorkBreakdownStructureDocumentationOperations {
  addNoteOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: AddNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeNoteOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: RemoveNoteAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOwnerOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: SetOwnerAction,
    dispatch?: SignalDispatch,
  ) => void;
  setReferencesOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: SetReferencesAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProjectRefOperation: (
    state: WorkBreakdownStructureGlobalState,
    action: SetProjectRefAction,
    dispatch?: SignalDispatch,
  ) => void;
}
