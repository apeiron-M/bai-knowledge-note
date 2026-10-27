/**
 * Which GGUFs the Chat tab loads for configuration C. Per model, highest
 * precedence first: the tab's per-model URL, the tab's base URL
 * (`<base>/<manifest file name>`), `VITE_CHAT_LORA_URL` / `VITE_CHAT_KEV_URL`
 * (`VITE_CHAT_MODEL_URL` is the LoRA's old name), `VITE_CHAT_MODEL_BASE_URL`,
 * then the same-origin dev path. There is no production host yet: a
 * deployment sets the base URL (CORS + Range required).
 */
import {
  C_ARTIFACTS,
  type ModelArtifact,
  type ModelRole,
} from "./model-manifest.js";

export interface ModelSettings {
  loraUrl?: string | null;
  kevUrl?: string | null;
  baseUrl?: string | null;
}

export interface ModelEnv {
  loraUrl?: string;
  kevUrl?: string;
  /** `VITE_CHAT_MODEL_URL`, the pre-C name of the LoRA URL. */
  modelUrl?: string;
  baseUrl?: string;
}

export interface ResolvedModel {
  role: ModelRole;
  url: string;
  from: "setting" | "base-setting" | "env" | "base-env" | "default";
  /** The file is the measured artifact (by versioned file name). */
  matchesManifest: boolean;
  fileName: string;
  /** One line for the UI. */
  label: string;
  /** One client per URL. */
  key: string;
}

export interface ResolvedSources {
  lora: ResolvedModel;
  kev: ResolvedModel;
  /** "C" when both files are the measured artifacts. */
  config: "C" | "custom";
}

export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0];
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || url;
}

function host(url: string): string {
  try {
    return new URL(url).host || "this origin";
  } catch {
    return "this origin";
  }
}

/** A trimmed, non-empty http(s) or root-relative URL, else null. */
export function normalizeModelUrl(raw: string | null | undefined): string | null {
  const u = raw?.trim() ?? "";
  if (!u) return null;
  return /^(https?:\/\/|\/)/i.test(u) ? u : null;
}

function joinBase(base: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

function resolveRole(
  a: ModelArtifact,
  setting: string | null | undefined,
  baseSetting: string | null,
  env: string | undefined,
  baseEnv: string | null,
): ResolvedModel {
  const fromSetting = normalizeModelUrl(setting);
  const fromEnv = normalizeModelUrl(env);
  const [url, from]: [string, ResolvedModel["from"]] = fromSetting
    ? [fromSetting, "setting"]
    : baseSetting
      ? [joinBase(baseSetting, a.fileName), "base-setting"]
      : fromEnv
        ? [fromEnv, "env"]
        : baseEnv
          ? [joinBase(baseEnv, a.fileName), "base-env"]
          : [a.devPath, "default"];
  const fileName = fileNameOf(url);
  const matchesManifest = fileName === a.fileName;
  return {
    role: a.role,
    url,
    from,
    matchesManifest,
    fileName,
    label: `${matchesManifest ? a.label : "Custom GGUF"}: ${fileName} (from ${host(url)})`,
    key: `url:${url}`,
  };
}

export function resolveCSources(
  settings: ModelSettings,
  env: ModelEnv = {},
): ResolvedSources {
  const base = normalizeModelUrl(settings.baseUrl);
  const baseEnv = normalizeModelUrl(env.baseUrl);
  const lora = resolveRole(
    C_ARTIFACTS.lora,
    settings.loraUrl,
    base,
    env.loraUrl ?? env.modelUrl,
    baseEnv,
  );
  const kev = resolveRole(C_ARTIFACTS.kev, settings.kevUrl, base, env.kevUrl, baseEnv);
  return {
    lora,
    kev,
    config: lora.matchesManifest && kev.matchesManifest ? "C" : "custom",
  };
}
