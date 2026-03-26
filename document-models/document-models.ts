import type { DocumentModelModule } from "document-model";
import { Derivation as DerivationV1 } from "./derivation/v1/module.js";
import { HealthReport as HealthReportV1 } from "./health-report/v1/module.js";
import { KnowledgeGraph as KnowledgeGraphV1 } from "./knowledge-graph/v1/module.js";
import { KnowledgeNote as KnowledgeNoteV1 } from "./knowledge-note/v1/module.js";
import { Moc as MocV1 } from "./moc/v1/module.js";
import { Observation as ObservationV1 } from "./observation/v1/module.js";
import { PipelineQueue as PipelineQueueV1 } from "./pipeline-queue/v1/module.js";
import { ResearchClaim as ResearchClaimV1 } from "./research-claim/v1/module.js";
import { Source as SourceV1 } from "./source/v1/module.js";
import { Tension as TensionV1 } from "./tension/v1/module.js";
import { VaultConfig as VaultConfigV1 } from "./vault-config/v1/module.js";

export const documentModels: DocumentModelModule<any>[] = [
  DerivationV1,
  HealthReportV1,
  KnowledgeGraphV1,
  KnowledgeNoteV1,
  MocV1,
  ObservationV1,
  PipelineQueueV1,
  ResearchClaimV1,
  SourceV1,
  TensionV1,
  VaultConfigV1,
];
