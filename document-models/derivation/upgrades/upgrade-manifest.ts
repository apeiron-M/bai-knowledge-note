import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const derivationUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/derivation",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
