import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const researchClaimUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/research-claim",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
