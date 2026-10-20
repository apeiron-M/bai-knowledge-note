/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { UpgradeManifest } from "document-model";
import { v2 } from "./v2.js";
import { latestVersion, supportedVersions } from "./versions.js";

export const pipelineQueueUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/pipeline-queue",
  latestVersion,
  supportedVersions,
  upgrades: { v2 },
};
