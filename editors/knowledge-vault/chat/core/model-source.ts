/**
 * Which GGUF the Chat tab loads. Default: the published base model from
 * Hugging Face (`DEFAULT_MODEL`). A GGUF URL can be set in the tab (saved
 * per browser) or with `VITE_CHAT_MODEL_URL` at build/dev time; the tab's
 * setting wins. The v1 pipeline (R2c) was measured with the round-8
 * fine-tune only, served from a URL; with the base model it is unmeasured.
 */
import { DEFAULT_MODEL } from "./llm-client.js";

export type ModelSource =
  | { kind: "hf"; repo: string; file: string }
  | { kind: "url"; url: string };

export interface ResolvedModel {
  source: ModelSource;
  /** Where the choice came from. */
  from: "setting" | "env" | "default";
  /** One line for the UI: which model is loaded. */
  label: string;
  /** Whether the v1 pipeline was measured with this model (round 8 GGUF). */
  measured: boolean;
  /** Cache key: one client and one score cache per model. */
  key: string;
}

/** The round-8 export's file-name stem (results doc, Round 8 "Export"). */
export const ROUND8_GGUF_STEM = "LFM2.5-350M-vault-r8a-20261022";

function fileName(url: string): string {
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

export function resolveModelSource(
  setting: string | null | undefined,
  env: string | null | undefined,
): ResolvedModel {
  const fromSetting = normalizeModelUrl(setting);
  const fromEnv = normalizeModelUrl(env);
  const url = fromSetting ?? fromEnv;
  if (url) {
    const file = fileName(url);
    const measured = file.startsWith(ROUND8_GGUF_STEM);
    return {
      source: { kind: "url", url },
      from: fromSetting ? "setting" : "env",
      label: `${measured ? "Round 8 fine-tune" : "Custom GGUF"}: ${file} (from ${host(url)})`,
      measured,
      key: `url:${url}`,
    };
  }
  return {
    source: { kind: "hf", ...DEFAULT_MODEL },
    from: "default",
    label: `Base model: ${DEFAULT_MODEL.repo} (Hugging Face, not fine-tuned)`,
    measured: false,
    key: `hf:${DEFAULT_MODEL.repo}/${DEFAULT_MODEL.file}`,
  };
}
