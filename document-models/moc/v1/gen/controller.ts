import { PHDocumentController } from "document-model";
import { Moc } from "../module.js";
import type { MocAction, MocPHState } from "./types.js";

export const MocController = PHDocumentController.forDocumentModel<
  MocPHState,
  MocAction
>(Moc);
