/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { UpgradeManifest } from "document-model";
import { derivationUpgradeManifest } from "document-models/derivation/upgrades";
import { healthReportUpgradeManifest } from "document-models/health-report/upgrades";
import { knowledgeGraphUpgradeManifest } from "document-models/knowledge-graph/upgrades";
import { knowledgeNoteUpgradeManifest } from "document-models/knowledge-note/upgrades";
import { mocUpgradeManifest } from "document-models/moc/upgrades";
import { observationUpgradeManifest } from "document-models/observation/upgrades";
import { pipelineQueueUpgradeManifest } from "document-models/pipeline-queue/upgrades";
import { researchClaimUpgradeManifest } from "document-models/research-claim/upgrades";
import { sourceUpgradeManifest } from "document-models/source/upgrades";
import { tensionUpgradeManifest } from "document-models/tension/upgrades";
import { vaultConfigUpgradeManifest } from "document-models/vault-config/upgrades";

export const upgradeManifests: UpgradeManifest<readonly number[]>[] = [
  derivationUpgradeManifest,
  healthReportUpgradeManifest,
  knowledgeGraphUpgradeManifest,
  knowledgeNoteUpgradeManifest,
  mocUpgradeManifest,
  observationUpgradeManifest,
  pipelineQueueUpgradeManifest,
  researchClaimUpgradeManifest,
  sourceUpgradeManifest,
  tensionUpgradeManifest,
  vaultConfigUpgradeManifest,
];
