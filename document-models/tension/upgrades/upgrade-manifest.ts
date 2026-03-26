import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const tensionUpgradeManifest: UpgradeManifest<typeof supportedVersions> =
  {
    documentType: "bai/tension",
    latestVersion,
    supportedVersions,
    upgrades: {},
  };
