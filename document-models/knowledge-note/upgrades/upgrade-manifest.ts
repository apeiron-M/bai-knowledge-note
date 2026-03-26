import type { UpgradeManifest } from "document-model";
import { latestVersion, supportedVersions } from "./versions.js";

export const knowledgeNoteUpgradeManifest: UpgradeManifest<
  typeof supportedVersions
> = {
  documentType: "bai/knowledge-note",
  latestVersion,
  supportedVersions,
  upgrades: {},
};
