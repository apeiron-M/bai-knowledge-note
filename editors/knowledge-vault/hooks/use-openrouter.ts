/**
 * OpenRouter connection state and the live model catalog.
 *
 * The catalog is fetched from OpenRouter each session and filtered to models
 * that list `tools` in `supported_parameters` (353 of 419 when this was
 * written). It is never hardcoded: the list changes weekly, and a stale
 * shortlist would either hide new models or offer retired ones.
 *
 * The pure helpers (`fetchToolCapableModels`, `resolveModel`) are exported
 * and tested directly; the hook composes them with the auth module.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginOAuth,
  clearKey,
  completeOAuthFromUrl,
  getStoredKey,
  storeKey,
  validateKey,
} from "../lib/chat/openrouter-auth.js";

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

/**
 * The model to use when the user has not chosen one: the newest free,
 * tool-capable model with a usable context window. "Newest" follows the
 * catalog's `created` stamp so the default tracks what OpenRouter currently
 * offers for nothing, rather than a name hardcoded here that goes stale.
 */
export function pickDefaultModel(catalog: ModelInfo[]): string {
  const free = catalog
    .filter((m) => m.free && m.contextLength >= MIN_DEFAULT_CONTEXT)
    .sort((a, b) => b.created - a.created);
  if (free[0]) return free[0].id;
  if (catalog.some((m) => m.id === FALLBACK_MODEL)) return FALLBACK_MODEL;
  return catalog[0]?.id ?? FALLBACK_MODEL;
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
): { model: string; fellBack: boolean } {
  if (catalog.length === 0)
    return { model: stored ?? FALLBACK_MODEL, fellBack: false };
  if (stored && catalog.some((m) => m.id === stored))
    return { model: stored, fellBack: false };
  return { model: pickDefaultModel(catalog), fellBack: stored !== null };
}

export interface UseOpenRouter {
  key: string | null;
  isConnected: boolean;
  /** True while the post-redirect code exchange is in flight. */
  isCompletingOAuth: boolean;
  model: string;
  models: ModelInfo[];
  modelsLoading: boolean;
  /** The stored model vanished from the catalog and the default is in use. */
  modelFellBack: boolean;
  /** The active model costs nothing per token. */
  modelIsFree: boolean;
  connect: (intent: { driveId: string; draft: string }) => Promise<void>;
  connectWithKey: (key: string) => Promise<boolean>;
  disconnect: () => void;
  setModel: (id: string) => void;
}

export function useOpenRouter(): UseOpenRouter {
  const [key, setKey] = useState<string | null>(() => getStoredKey());
  const [isCompletingOAuth, setCompleting] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [stored, setStored] = useState<string | null>(() => readStoredModel());
  const completedRef = useRef(false);

  // Finish a redirect exactly once per mount. `completeOAuthFromUrl` is a
  // no-op when there is no ?code=, so this is safe on every load.
  useEffect(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (!new URL(location.href).searchParams.has("code")) return;
    setCompleting(true);
    void completeOAuthFromUrl()
      .then((r) => {
        if (r) setKey(r.key);
      })
      .finally(() => setCompleting(false));
  }, []);

  // The catalog is only useful once connected; fetching it earlier would be
  // a network call on behalf of a user who never opens the chat.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setModelsLoading(true);
    void fetchToolCapableModels().then((list) => {
      if (cancelled) return;
      setModels(list);
      setModelsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const connect = useCallback(
    (intent: { driveId: string; draft: string }) => beginOAuth(intent),
    [],
  );

  const connectWithKey = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    const valid = await validateKey(trimmed);
    if (!valid) return false;
    storeKey(trimmed);
    setKey(trimmed);
    return true;
  }, []);

  const disconnect = useCallback(() => {
    clearKey();
    setKey(null);
    setModels([]);
  }, []);

  const setModel = useCallback((id: string) => {
    storeModel(id);
    setStored(id);
  }, []);

  const { model, fellBack } = resolveModel(stored, models);
  const modelIsFree = models.find((m) => m.id === model)?.free ?? false;

  return {
    key,
    isConnected: key !== null,
    isCompletingOAuth,
    model,
    models,
    modelsLoading,
    modelFellBack: fellBack,
    modelIsFree,
    connect,
    connectWithKey,
    disconnect,
    setModel,
  };
}
