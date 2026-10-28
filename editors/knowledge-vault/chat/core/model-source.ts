/**
 * Which GGUFs the Chat tab loads for configuration C. Per model, highest
 * precedence first: the tab's per-model URL, the tab's base URL
 * (`<base>/<manifest file name>`), `VITE_CHAT_LORA_URL` / `VITE_CHAT_KEV_URL`
 * (`VITE_CHAT_MODEL_URL` is the LoRA's old name), `VITE_CHAT_MODEL_BASE_URL`,
 * then the same-origin dev path. The resolver moved to nl-runtime
 * (core/model-source) in M1, over an artifact manifest; `resolveCSources`
 * binds `VAULT_ARTIFACTS`. The Round 8 helpers stay here until M5.
 */
import {
  fileNameOf,
  type ModelEnv,
  type ModelSettings,
  resolveModelSources,
  type ResolvedSources,
} from "nl-runtime";
import { VAULT_ARTIFACTS } from "../vault-artifacts.js";

export {
  fileNameOf,
  type ModelEnv,
  type ModelSettings,
  normalizeModelUrl,
  type ResolvedModel,
  type ResolvedSources,
} from "nl-runtime";

/**
 * v1's measured single model (round 8 export, results doc "Export"). The
 * pre-C tab saved it as `bai.chat.modelUrl`; it is not configuration C's
 * LoRA, so it is never carried over.
 */
export const ROUND8_GGUF_STEM = "LFM2.5-350M-vault-r8a-20261022";

export function isRound8Url(url: string): boolean {
  return fileNameOf(url).startsWith(ROUND8_GGUF_STEM);
}

export function resolveCSources(
  settings: ModelSettings,
  env: ModelEnv = {},
): ResolvedSources {
  return resolveModelSources(VAULT_ARTIFACTS, settings, env);
}
