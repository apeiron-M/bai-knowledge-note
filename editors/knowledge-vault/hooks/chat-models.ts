// Moved to nl-runtime in M1 (M1-UI): the models store is `createChatModels`.
// This file keeps the vault's store (with its compat toggle) and the old
// names the tests import; M3 retargets them and deletes the shim.
import { type ChatModels, createChatModels, type WllamaAssetOptions } from "nl-runtime";
import { VAULT_ARTIFACTS } from "../chat/vault-artifacts.js";

export {
  type ChatStage,
  hasWebGpu,
  isKevTooLong,
  type ModelPhase,
  type ModelState,
} from "nl-runtime";

/**
 * Dev toggle: `localStorage["bai.chat.forceCompat"] = "1"` runs wllama's
 * compat build (no JSPI / memory64) even where the browser has both, to
 * exercise that path (E1: its wasm must come from this origin, not a CDN).
 * Read when the page's store is created, so set it and reload.
 */
function wllamaAssets(): WllamaAssetOptions {
  try {
    return globalThis.localStorage.getItem("bai.chat.forceCompat") === "1"
      ? { forceCompat: true }
      : {};
  } catch {
    return {};
  }
}

let models: ChatModels | null = null;

/** The page's models store for configuration C (created on first use). */
export function vaultChatModels(): ChatModels {
  models ??= createChatModels(VAULT_ARTIFACTS, { assets: wllamaAssets() });
  return models;
}

/** Why Kev cannot run at all right now, else null. */
export const kevBlocker = (enabled: boolean): string | null =>
  vaultChatModels().kevBlocker(enabled);
