/**
 * OpenRouter's live model catalog and the rules for choosing a model from it.
 *
 * The catalog is fetched from OpenRouter each session and filtered to models
 * that list `tools` in `supported_parameters` (353 of 419 when this was
 * written). It is never hardcoded: the list changes weekly, and a stale
 * shortlist would either hide new models or offer retired ones.
 *
 * Pure helpers, exported and tested directly; `useChatProvider` composes
 * them with the auth module and with the other endpoint kinds.
 */
import { MAX_MODELS_IN_REQUEST } from "../lib/chat/completions-client.js";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_STORAGE = "bai-chat-model:v1";

/**
 * Used only when the catalog holds no free model with a usable context window
 * (or is unreachable and nothing is stored). Paid, so never chosen silently
 * when a free option exists — a default that bills the user before they have
 * picked anything is the wrong default.
 */
export const FALLBACK_MODEL = "anthropic/claude-sonnet-4.5";

/**
 * Smallest context window the auto-chosen default may have. The system
 * prompt is ~800 tokens, a paged document read is ~2,000, and a six-round tool
 * loop accumulates all of it; free models below this would truncate mid-answer.
 */
export const MIN_DEFAULT_CONTEXT = 32_000;

export interface ModelInfo {
  id: string;
  name: string;
  /** Unix seconds, as OpenRouter reports it. */
  created: number;
  contextLength: number;
  /** USD per prompt token, as OpenRouter reports it. */
  promptPrice: number;
  completionPrice: number;
  /** Zero prompt AND completion price. Detected by price, not by id suffix. */
  free: boolean;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function fetchToolCapableModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch(MODELS_URL);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json.data)) return [];
    return (json.data as RawModel[])
      .filter(
        (m) =>
          typeof m.id === "string" &&
          Array.isArray(m.supported_parameters) &&
          m.supported_parameters.includes("tools"),
      )
      .map<ModelInfo>((m) => {
        const promptPrice = num(m.pricing?.prompt);
        const completionPrice = num(m.pricing?.completion);
        return {
          id: m.id as string,
          name:
            typeof m.name === "string" && m.name ? m.name : (m.id as string),
          created: num(m.created),
          contextLength: num(m.context_length),
          promptPrice,
          completionPrice,
          free: promptPrice === 0 && completionPrice === 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function readStoredModel(): string | null {
  return localStorage.getItem(MODEL_STORAGE);
}

export function storeModel(id: string): void {
  localStorage.setItem(MODEL_STORAGE, id);
}

/** Free, tool-capable, and roomy enough for the agent loop — newest first. */
function freeCandidates(
  catalog: ModelInfo[],
  exclude: ReadonlySet<string>,
): ModelInfo[] {
  return catalog
    .filter(
      (m) =>
        m.free && m.contextLength >= MIN_DEFAULT_CONTEXT && !exclude.has(m.id),
    )
    .sort((a, b) => b.created - a.created);
}

/**
 * The model to use when the user has not chosen one: the newest free,
 * tool-capable model with a usable context window. "Newest" follows the
 * catalog's `created` stamp so the default tracks what OpenRouter currently
 * offers for nothing, rather than a name hardcoded here that goes stale.
 *
 * `exclude` holds models that failed this session, so a default that went
 * down is not chosen again until the page reloads.
 */
export function pickDefaultModel(
  catalog: ModelInfo[],
  exclude: ReadonlySet<string> = new Set(),
): string {
  const free = freeCandidates(catalog, exclude);
  if (free[0]) return free[0].id;
  if (catalog.some((m) => m.id === FALLBACK_MODEL)) return FALLBACK_MODEL;
  return catalog[0]?.id ?? FALLBACK_MODEL;
}

/**
 * How many fallbacks ride along with each request: OpenRouter accepts three
 * models per request *including* the primary, so two fallbacks fill it.
 */
export const MAX_FALLBACKS = MAX_MODELS_IN_REQUEST - 1;

/**
 * The next free candidates after `primary`, for OpenRouter's in-request
 * `models` fallback. Server-side failover means one request, so a model
 * that is down never costs a second attempt against the free quota.
 */
export function pickFallbackModels(
  catalog: ModelInfo[],
  primary: string,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  return freeCandidates(catalog, exclude)
    .map((m) => m.id)
    .filter((id) => id !== primary)
    .slice(0, MAX_FALLBACKS);
}

/**
 * Pick the model to use given the stored preference and the live catalog.
 *
 * While the catalog is empty (unreachable, or not loaded yet) the stored
 * choice is trusted — an offline catalog must not silently swap the user's
 * model. Once a non-empty catalog arrives, an explicit choice it still
 * contains wins; otherwise the free default is used, flagged when it
 * replaced a stored id so the UI can say so.
 */
export function resolveModel(
  stored: string | null,
  catalog: ModelInfo[],
  exclude: ReadonlySet<string> = new Set(),
): { model: string; explicit: boolean; fellBack: boolean } {
  if (catalog.length === 0) {
    return {
      model: stored ?? FALLBACK_MODEL,
      explicit: stored !== null,
      fellBack: false,
    };
  }
  if (stored && catalog.some((m) => m.id === stored)) {
    return { model: stored, explicit: true, fellBack: false };
  }
  return {
    model: pickDefaultModel(catalog, exclude),
    explicit: false,
    fellBack: stored !== null,
  };
}
