import { PHDocumentController } from "document-model/core";
import { ResearchClaim } from "../module.js";
import type { ResearchClaimAction, ResearchClaimPHState } from "./types.js";

export const ResearchClaimController = PHDocumentController.forDocumentModel<
  ResearchClaimPHState,
  ResearchClaimAction
>(ResearchClaim);
