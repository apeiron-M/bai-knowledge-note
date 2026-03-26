import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const sourceUpgradeManifest: UpgradeManifest<typeof supportedVersions> =
  {
    documentType: "bai/source",
    latestVersion,
    supportedVersions,
    upgrades: {},
  };
