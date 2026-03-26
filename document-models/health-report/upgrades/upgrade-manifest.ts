import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const healthReportUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/health-report",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
