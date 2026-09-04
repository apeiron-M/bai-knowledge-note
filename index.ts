/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Manifest } from "document-model";
import manifestJson from "./powerhouse.manifest.json" with { type: "json" };
export { documentModels } from "./document-models/document-models.js";
export { upgradeManifests } from "./document-models/upgrade-manifests.js";
export { editors } from "./editors/editors.js";
export { processorFactory } from "./processors/factory.js";
export { startRemoteFirstBoot } from "./editors/knowledge-vault/lib/boot.js";
// Connect's built-in AI assistant merges every package's `aiTools` into its
// tool set (DocumentModelLib.aiTools, reactor-browser ≥ Sept 2026). Hand-added
// like the boot export above: codegen's template for this file does not know
// about it, so restore both if a regeneration ever rewrites the file.
export { aiTools } from "./editors/knowledge-vault/lib/chat/ai-tools.js";
export const manifest = manifestJson as Manifest;

// Engage remote-first as soon as the package is loaded, before Connect tries to
// replicate a vault drive. Doing this at editor-mount time is too late: the
// editor cannot mount until the drive has loaded, and loading the drive is the
// replication that remote-first exists to avoid. Browser-only — the node build
// evaluates this module too and must not be affected.
if (typeof window !== "undefined") {
  void import("./editors/knowledge-vault/lib/boot.js").then((m) =>
    m.startRemoteFirstBoot(),
  );
}
