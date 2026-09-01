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

/** A capable, widely available default; the user can change it any time. */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  /** USD per prompt token, as OpenRouter reports it. */
  promptPrice: number;
  completionPrice: number;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
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
      .map<ModelInfo>((m) => ({
        id: m.id as string,
        name: typeof m.name === "string" && m.name ? m.name : (m.id as string),
        contextLength: num(m.context_length),
        promptPrice: num(m.pricing?.prompt),
        completionPrice: num(m.pricing?.completion),
      }))
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
 * Pick the model to use given the stored preference and the live catalog.
 *
 * While the catalog is empty (unreachable, or not loaded yet) the stored
 * choice is trusted — an offline catalog must not silently swap the user's
 * model. Once a non-empty catalog arrives, a stored id it no longer contains
 * falls back to the default and is flagged so the UI can say so.
 */
export function resolveModel(
  stored: string | null,
  catalog: ModelInfo[],
): { model: string; fellBack: boolean } {
  if (catalog.length === 0)
    return { model: stored ?? DEFAULT_MODEL, fellBack: false };
  const has = (id: string) => catalog.some((m) => m.id === id);
  if (stored && has(stored)) return { model: stored, fellBack: false };
  const fallback = has(DEFAULT_MODEL) ? DEFAULT_MODEL : catalog[0].id;
  return { model: fallback, fellBack: stored !== null };
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

  return {
    key,
    isConnected: key !== null,
    isCompletingOAuth,
    model,
    models,
    modelsLoading,
    modelFellBack: fellBack,
    connect,
    connectWithKey,
    disconnect,
    setModel,
  };
}
