import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const mocUpgradeManifest: UpgradeManifest<typeof supportedVersions> = {
  documentType: "bai/moc",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
