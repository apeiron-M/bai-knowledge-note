import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const knowledgeGraphUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/knowledge-graph",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
