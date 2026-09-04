/**
 * The chat's model connection: which endpoint, which model, how it was
 * chosen — for OpenRouter, for a server the user named, or for Connect's own
 * AI settings. `ChatView` reads this and hands the endpoint to `useChat`.
 *
 * The OpenRouter pieces (OAuth completion, catalog, free-model defaulting and
 * in-request fallbacks) are what `useOpenRouter` did; other endpoints get the
 * simpler treatment they warrant: the model the user typed or the first one
 * the server lists, no fallbacks, no billing heuristics.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginOAuth,
  clearKey,
  completeOAuthFromUrl,
  getStoredKey,
  storeKey,
  takeInterruptedAttempt,
  validateKey,
} from "../lib/chat/openrouter-auth.js";
import {
  activeProvider,
  connectAiSettings,
  endpointFor,
  fetchEndpointModels,
  normalizeBaseUrl,
  readSavedProviders,
  savedKinds,
  writeSavedProviders,
  type ChatEndpoint,
  type ChatProvider,
  type ProviderKind,
  type SavedProviders,
} from "../lib/chat/provider.js";
import { classifyFailure } from "../lib/chat/failure.js";
import {
  fetchToolCapableModels,
  pickFallbackModels,
  readStoredModel,
  resolveModel,
  storeModel,
  type ModelInfo,
} from "./use-openrouter.js";

/** A model from a plain OpenAI-compatible catalog: no price, no context length known. */
function plainModel(m: { id: string; name: string }): ModelInfo {
  return {
    id: m.id,
    name: m.name,
    created: 0,
    contextLength: 0,
    promptPrice: 0,
    completionPrice: 0,
    free: false,
  };
}

export interface CustomEndpointInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** JSON object of server-specific request fields; empty for none. */
  extraBody?: string;
}

/** A saved connection as the UI lists it. */
export interface SavedConnection {
  kind: ProviderKind;
  label: string;
  /** The model it will use, when known without a catalog. */
  model: string | null;
}

export interface UseChatProvider {
  provider: ChatProvider | null;
  endpoint: ChatEndpoint | null;
  isConnected: boolean;
  /** "OpenRouter", "localhost:11434", "Connect's AI settings · host" */
  providerLabel: string;
  /** True while the post-redirect OpenRouter code exchange is in flight. */
  isCompletingOAuth: boolean;
  /** OpenRouter Connect was started in this tab and the user came back without a code. */
  interruptedAttempt: boolean;
  /** Connect's own AI endpoint, when one is configured in this browser. */
  connectSettings: { host: string; model: string } | null;
  /** Every connection this browser remembers — the active one included. */
  saved: SavedConnection[];
  /** Make a remembered connection the active one. */
  switchTo: (kind: ProviderKind) => void;
  /** Show the connect screen to add a connection, keeping the saved ones. */
  addAnother: () => void;
  model: string;
  models: ModelInfo[];
  modelsLoading: boolean;
  /** The stored model vanished from the catalog and a default is in use. */
  modelFellBack: boolean;
  /** The active model costs nothing per token (OpenRouter only). */
  modelIsFree: boolean;
  /** False when the model was chosen automatically rather than by the user. */
  modelIsExplicit: boolean;
  /** OpenRouter in-request fallbacks; empty for every other endpoint. */
  fallbackModels: string[];
  skipModel: (id: string) => void;
  modelName: (id: string) => string;
  setModel: (id: string) => void;
  connectOpenRouter: (intent: { driveId: string; draft: string }) => Promise<void>;
  connectWithOpenRouterKey: (key: string) => Promise<boolean>;
  /** Resolves to null on success, else a message saying what went wrong. */
  connectCustom: (input: CustomEndpointInput) => Promise<string | null>;
  useConnectSettings: () => boolean;
  /** Forget the active connection; falls back to another saved one if any. */
  disconnect: () => void;
}

export function useChatProvider(): UseChatProvider {
  const [saved, setSaved] = useState<SavedProviders>(() => readSavedProviders());
  const provider: ChatProvider | null = useMemo(() => activeProvider(saved), [saved]);
  const save = useCallback((next: SavedProviders) => {
    writeSavedProviders(next);
    setSaved(next);
  }, []);
  const [isCompletingOAuth, setCompleting] = useState(false);
  // Read once at mount; the flag is consumed by reading it.
  const [interruptedAttempt] = useState(
    () => !getStoredKey() && !activeProvider(readSavedProviders()) && takeInterruptedAttempt(),
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [storedOpenRouterModel, setStoredOpenRouterModel] = useState<string | null>(
    () => readStoredModel(),
  );
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  // Connect's settings can change in another tab; a same-tab change comes
  // with a remount of this view anyway.
  const [settingsTick, bump] = useState(0);
  useEffect(() => {
    const onStorage = () => bump((n) => n + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const completedRef = useRef(false);

  // Finish an OpenRouter redirect exactly once per mount. A no-op when there
  // is no ?code=, so this is safe on every load.
  useEffect(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (!new URL(location.href).searchParams.has("code")) return;
    setCompleting(true);
    void completeOAuthFromUrl()
      .then((r) => {
        if (!r) return;
        save({ ...readSavedProviders(), openrouter: { key: r.key }, active: "openrouter" });
      })
      .finally(() => setCompleting(false));
  }, [save]);

  const endpoint = useMemo(
    () => (provider ? endpointFor(provider) : null),
    // settingsTick re-reads Connect's settings for the "connect" kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, settingsTick],
  );

  // The catalog is only useful once connected; fetching it earlier would be
  // a network call on behalf of a user who never opens the chat.
  useEffect(() => {
    if (!endpoint) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    const load = endpoint.openRouter
      ? fetchToolCapableModels()
      : fetchEndpointModels(endpoint)
          .then((list) => list.map(plainModel))
          .catch(() => [] as ModelInfo[]);
    void load.then((list) => {
      if (cancelled) return;
      setModels(list);
      setModelsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const connectOpenRouter = useCallback(
    (intent: { driveId: string; draft: string }) => beginOAuth(intent),
    [],
  );

  const connectWithOpenRouterKey = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    const valid = await validateKey(trimmed);
    if (!valid) return false;
    storeKey(trimmed);
    save({ ...readSavedProviders(), openrouter: { key: trimmed }, active: "openrouter" });
    return true;
  }, [save]);

  const connectCustom = useCallback(async (input: CustomEndpointInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) return "Enter the server's base URL, e.g. http://localhost:11434/v1.";
    let extraBody: Record<string, unknown> | null = null;
    if (input.extraBody?.trim()) {
      try {
        const parsed: unknown = JSON.parse(input.extraBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return 'Extra request fields must be a JSON object, e.g. {"enable_thinking": false}.';
        }
        extraBody = parsed as Record<string, unknown>;
      } catch {
        return "Extra request fields are not valid JSON.";
      }
    }
    const next: ChatProvider = {
      kind: "custom",
      baseUrl,
      apiKey: input.apiKey.trim() || null,
      model: input.model.trim() || null,
      extraBody,
    };
    const ep = endpointFor(next);
    if (!ep) return "That does not look like a URL.";
    try {
      // The probe is the same call the picker makes; it fails here, at
      // connect time, for a wrong key or a blocked origin.
      const listed = await fetchEndpointModels(ep);
      if (!next.model && listed.length === 0) {
        return `${ep.label} lists no models. Enter the model id to use (e.g. llama3.1 for Ollama).`;
      }
      if (!next.model) next.model = listed[0].id;
    } catch (err) {
      const f = classifyFailure(err, { label: ep.label, completionsUrl: ep.completionsUrl });
      return f.kind === "unreachable"
        ? f.message
        : `${ep.label} refused the connection: ${f.message}`;
    }
    const { kind: _kind, ...record } = next;
    save({ ...readSavedProviders(), custom: record, active: "custom" });
    return null;
  }, [save]);

  const useConnectSettings = useCallback(() => {
    if (!connectAiSettings()) return false;
    save({ ...readSavedProviders(), connect: true, active: "connect" });
    return true;
  }, [save]);

  const switchTo = useCallback(
    (kind: ProviderKind) => {
      const current = readSavedProviders();
      if (!savedKinds(current).includes(kind)) return;
      save({ ...current, active: kind });
    },
    [save],
  );

  const addAnother = useCallback(() => {
    save({ ...readSavedProviders(), active: null });
  }, [save]);

  const disconnect = useCallback(() => {
    const current = readSavedProviders();
    const next: SavedProviders = { ...current };
    switch (current.active) {
      case "openrouter":
        next.openrouter = null;
        // The legacy key would otherwise resurrect the connection on reload.
        clearKey();
        break;
      case "custom":
        next.custom = null;
        break;
      case "connect":
        next.connect = false;
        break;
      case null:
        break;
    }
    next.active = savedKinds(next)[0] ?? null;
    save(next);
    setModels([]);
  }, [save]);

  const setModel = useCallback(
    (id: string) => {
      if (!provider) return;
      if (provider.kind === "openrouter") {
        storeModel(id);
        setStoredOpenRouterModel(id);
        return;
      }
      const current = readSavedProviders();
      if (provider.kind === "custom" && current.custom) {
        save({ ...current, custom: { ...current.custom, model: id } });
        return;
      }
      // Choosing a model on Connect's endpoint makes it the vault's own
      // saved server from here on; Connect's settings stay untouched.
      const s = connectAiSettings();
      if (!s) return;
      save({
        ...current,
        custom: {
          baseUrl: s.baseUrl,
          apiKey: s.apiKey || null,
          model: id,
          extraBody: null,
        },
        active: "custom",
      });
    },
    [provider, save],
  );

  const skipModel = useCallback((id: string) => {
    setSkipped((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  const modelName = useCallback(
    (id: string) => models.find((m) => m.id === id)?.name ?? id,
    [models],
  );

  let model = "";
  let explicit = true;
  let fellBack = false;
  if (endpoint?.openRouter) {
    const r = resolveModel(storedOpenRouterModel, models, skipped);
    model = r.model;
    explicit = r.explicit;
    fellBack = r.fellBack;
  } else if (endpoint) {
    const chosen =
      endpoint.pinnedModel ?? (provider?.kind === "custom" ? provider.model : null);
    if (chosen) {
      model = chosen;
    } else {
      model = models[0]?.id ?? "";
      explicit = false;
    }
  }
  const modelIsFree = endpoint?.openRouter
    ? (models.find((m) => m.id === model)?.free ?? false)
    : false;
  const fallbackModels =
    endpoint?.openRouter && !explicit ? pickFallbackModels(models, model, skipped) : [];

  const connectSettingsRaw = connectAiSettings();
  const connectSettings = useMemo(
    () =>
      connectSettingsRaw
        ? {
            host: (() => {
              try {
                return new URL(normalizeBaseUrl(connectSettingsRaw.baseUrl)).host;
              } catch {
                return connectSettingsRaw.baseUrl;
              }
            })(),
            model: connectSettingsRaw.model,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectSettingsRaw?.baseUrl, connectSettingsRaw?.model, settingsTick],
  );

  const savedConnections = useMemo<SavedConnection[]>(
    () =>
      savedKinds(saved).flatMap((kind) => {
        const p =
          kind === "openrouter"
            ? saved.openrouter && { kind: "openrouter" as const, key: saved.openrouter.key }
            : kind === "custom"
              ? saved.custom && { kind: "custom" as const, ...saved.custom }
              : { kind: "connect" as const };
        const ep = p ? endpointFor(p) : null;
        if (!ep) return [];
        return [
          {
            kind,
            label: ep.label,
            model: ep.pinnedModel ?? (kind === "custom" ? saved.custom?.model ?? null : null),
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, settingsTick],
  );

  return {
    provider,
    endpoint,
    isConnected: endpoint !== null,
    providerLabel: endpoint?.label ?? "",
    isCompletingOAuth,
    interruptedAttempt,
    connectSettings,
    saved: savedConnections,
    switchTo,
    addAnother,
    model,
    models,
    modelsLoading,
    modelFellBack: fellBack,
    modelIsFree,
    modelIsExplicit: explicit,
    fallbackModels,
    skipModel,
    modelName,
    setModel,
    connectOpenRouter,
    connectWithOpenRouterKey,
    connectCustom,
    useConnectSettings,
    disconnect,
  };
}
