import { Derivation as DerivationV1 } from "document-models/derivation/v1";
import { HealthReport as HealthReportV1 } from "document-models/health-report/v1";
import { KnowledgeNote as KnowledgeNoteV1 } from "document-models/knowledge-note/v1";
import { KnowledgeNote as KnowledgeNoteV2 } from "document-models/knowledge-note/v2";
import { Moc as MocV1 } from "document-models/moc/v1";
import { Observation as ObservationV1 } from "document-models/observation/v1";
import { PipelineQueue as PipelineQueueV1 } from "document-models/pipeline-queue/v1";
import { PipelineQueue as PipelineQueueV2 } from "document-models/pipeline-queue/v2";
import { ResearchClaim as ResearchClaimV1 } from "document-models/research-claim/v1";
import { ScopeOfWork as ScopeOfWorkV1 } from "document-models/scope-of-work/v1";
import { Source as SourceV1 } from "document-models/source/v1";
import { Source as SourceV2 } from "document-models/source/v2";
import { Tension as TensionV1 } from "document-models/tension/v1";
import { VaultConfig as VaultConfigV1 } from "document-models/vault-config/v1";
import { VaultConfig as VaultConfigV2 } from "document-models/vault-config/v2";
import { WorkBreakdownStructure as WorkBreakdownStructureV1 } from "document-models/work-breakdown-structure/v1";

/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */

export const documentModels = [
  DerivationV1,
  HealthReportV1,
  KnowledgeNoteV1,
  KnowledgeNoteV2,
  MocV1,
  ObservationV1,
  PipelineQueueV1,
  PipelineQueueV2,
  ResearchClaimV1,
  ScopeOfWorkV1,
  SourceV1,
  SourceV2,
  TensionV1,
  VaultConfigV1,
  VaultConfigV2,
  WorkBreakdownStructureV1,
] as const;
