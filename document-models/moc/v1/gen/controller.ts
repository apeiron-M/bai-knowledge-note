import { PHDocumentController } from "document-model/core";
import { Moc } from "../module.js";
import type { MocAction, MocPHState } from "./types.js";

export const MocController = PHDocumentController.forDocumentModel<
  MocPHState,
  MocAction
>(Moc);
