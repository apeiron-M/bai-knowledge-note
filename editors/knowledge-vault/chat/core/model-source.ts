/**
 * Which GGUFs the Chat tab loads for configuration C. Per model, highest
 * precedence first: the tab's per-model URL, the tab's base URL
 * (`<base>/<manifest file name>`), `VITE_CHAT_LORA_URL` / `VITE_CHAT_KEV_URL`
 * (`VITE_CHAT_MODEL_URL` is the LoRA's old name), `VITE_CHAT_MODEL_BASE_URL`,
 * then the same-origin dev path. The resolver moved to nl-runtime
 * (core/model-source) in M1, over an artifact manifest; `resolveCSources`
 * binds `VAULT_ARTIFACTS`.
 */
import {
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

export function resolveCSources(
  settings: ModelSettings,
  env: ModelEnv = {},
): ResolvedSources {
  return resolveModelSources(VAULT_ARTIFACTS, settings, env);
}
