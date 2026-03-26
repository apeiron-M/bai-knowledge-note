import { PHDocumentController } from "document-model/core";
import { PipelineQueue } from "../module.js";
import type { PipelineQueueAction, PipelineQueuePHState } from "./types.js";

export const PipelineQueueController = PHDocumentController.forDocumentModel<
  PipelineQueuePHState,
  PipelineQueueAction
>(PipelineQueue);
