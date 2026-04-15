import type { UpgradeManifest } from "document-model";
import { derivationUpgradeManifest } from "./derivation/upgrades/upgrade-manifest.js";
import { healthReportUpgradeManifest } from "./health-report/upgrades/upgrade-manifest.js";
import { knowledgeGraphUpgradeManifest } from "./knowledge-graph/upgrades/upgrade-manifest.js";
import { knowledgeNoteUpgradeManifest } from "./knowledge-note/upgrades/upgrade-manifest.js";
import { mocUpgradeManifest } from "./moc/upgrades/upgrade-manifest.js";
import { observationUpgradeManifest } from "./observation/upgrades/upgrade-manifest.js";
import { pipelineQueueUpgradeManifest } from "./pipeline-queue/upgrades/upgrade-manifest.js";
import { researchClaimUpgradeManifest } from "./research-claim/upgrades/upgrade-manifest.js";
import { sourceUpgradeManifest } from "./source/upgrades/upgrade-manifest.js";
import { tensionUpgradeManifest } from "./tension/upgrades/upgrade-manifest.js";
import { vaultConfigUpgradeManifest } from "./vault-config/upgrades/upgrade-manifest.js";

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
