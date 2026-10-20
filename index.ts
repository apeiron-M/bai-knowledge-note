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
// Hand-added too: a host's own intake (the desktop app's setup guide converts and files sources itself).
export { hostIntake } from "./editors/knowledge-vault/lib/host-intake.js";
// Hand-added too: the vault running entirely in the browser (engine, graph index
// and vault app in the page), for knowledge-vault-landing's "Try on web" ONLY. A
// loader, so the browser vault builds into its own chunk and the module Connect
// loads stays the same size (`ph-cli build` has no entry for a folder of its own).
// `#browser-vault` is the browser vault in a browser build and a stub that refuses
// to load in the server build (package.json "imports"; browser/unavailable.ts):
// its WebAssembly dependencies must never reach the Switchboard, which would then
// refuse this package's subgraphs and processors. See CLAUDE.md.
export const loadBrowserVault = () => import("#browser-vault");
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
