import * as Derivation from "document-models/derivation";
import * as HealthReport from "document-models/health-report";
import * as KnowledgeNote from "document-models/knowledge-note";
import * as Moc from "document-models/moc";
import * as Observation from "document-models/observation";
import * as PipelineQueue from "document-models/pipeline-queue";
import * as Project from "document-models/project";
import * as ResearchClaim from "document-models/research-claim";
import * as Source from "document-models/source";
import * as Tension from "document-models/tension";
import * as VaultConfig from "document-models/vault-config";
import * as WorkBreakdownStructure from "document-models/work-breakdown-structure";
import {
  buildCatalog,
  type BuildCatalogOptions,
  type CatalogEntry,
  type CatalogModelInput,
} from "./op-catalog.js";
import { OP_DESCRIPTIONS } from "./op-descriptions.js";

export const CATALOG_MODELS: CatalogModelInput[] = [
  { module: Derivation.Derivation, schemas: Derivation },
  { module: HealthReport.HealthReport, schemas: HealthReport },
  { module: KnowledgeNote.KnowledgeNote, schemas: KnowledgeNote },
  { module: Moc.Moc, schemas: Moc },
  { module: Observation.Observation, schemas: Observation },
  { module: PipelineQueue.PipelineQueue, schemas: PipelineQueue },
  { module: Project.Project, schemas: Project },
  { module: ResearchClaim.ResearchClaim, schemas: ResearchClaim },
  { module: Source.Source, schemas: Source },
  { module: Tension.Tension, schemas: Tension },
  { module: VaultConfig.VaultConfig, schemas: VaultConfig },
  {
    module: WorkBreakdownStructure.WorkBreakdownStructure,
    schemas: WorkBreakdownStructure,
  },
];

/**
 * Uses the spike-local `OP_DESCRIPTIONS` unless `descriptionOverrides` is
 * given; pass `{}` to get the models' own descriptions.
 */
export function buildVaultCatalog(
  options: BuildCatalogOptions = {},
): CatalogEntry[] {
  return buildCatalog(CATALOG_MODELS, {
    ...options,
    descriptionOverrides: options.descriptionOverrides ?? OP_DESCRIPTIONS,
  });
}
