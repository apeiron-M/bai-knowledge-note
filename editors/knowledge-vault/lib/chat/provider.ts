/**
 * Which model endpoint the chat talks to, and how.
 *
 * Three ways in, one shape out. OpenRouter (browser OAuth or a pasted key) is
 * the hosted default. Any OpenAI-compatible server — Ollama, LM Studio, vLLM,
 * llama.cpp, a corporate gateway — is reached by base URL and an optional key.
 * And when Connect itself has an AI endpoint configured (Settings → AI
 * assistant, persisted by reactor-browser under `ph-ai-chat-settings`) the
 * vault can simply use that, so a model is configured once per browser.
 *
 * Everything downstream — the streaming client, the agent loop, the failure
 * classifier — sees only a `ChatEndpoint`: URLs, headers, a label, and the
 * two things OpenRouter does that no other server does (a `models` fallback
 * array and attribution headers).
 *
 * All three connections are remembered at once (`SavedProviders`), with one
 * active: someone who runs a local model by day and falls back to OpenRouter
 * when the laptop is closed switches in the chat header, not by reconnecting.
 */
import { getStoredKey } from "./openrouter-auth.js";

/** A server the user named: any OpenAI-compatible API. */
export interface CustomProvider {
  /** Base URL, e.g. `http://localhost:11434/v1` or `http://127.0.0.1:8888/v1`. */
  baseUrl: string;
  /** Bearer token, or null for servers that need none (most local ones). */
  apiKey: string | null;
  /** The model the user picked or typed; null until the catalog decides. */
  model: string | null;
  /**
   * Extra fields merged into every completion request — a server's own knobs
   * such as `enable_thinking`, `temperature`, `top_k`. Never overrides the
   * fields the protocol needs (model, messages, tools, stream).
   */
  extraBody: Record<string, unknown> | null;
}

export type ChatProvider =
  | { kind: "openrouter"; key: string }
  | ({ kind: "custom" } & CustomProvider)
  /** Connect's own AI-assistant settings, read live from localStorage. */
  | { kind: "connect" };

export type ProviderKind = ChatProvider["kind"];

export interface ChatEndpoint {
  completionsUrl: string;
  modelsUrl: string;
  headers: Record<string, string>;
  /** OpenRouter accepts a `models` fallback array and attribution headers; nothing else does. */
  openRouter: boolean;
  /** Short name for the header badge and error messages: "OpenRouter", "localhost:11434", … */
  label: string;
  /** A model the provider pins (Connect's settings); null when the picker decides. */
  pinnedModel: string | null;
  /** Server-specific request fields (see `CustomProvider.extraBody`). */
  extraBody: Record<string, unknown> | null;
}

/**
 * Every connection this browser knows, and which one answers. `connect` is a
 * flag rather than a record because Connect's settings are read live.
 */
export interface SavedProviders {
  active: ProviderKind | null;
  openrouter: { key: string } | null;
  custom: CustomProvider | null;
  connect: boolean;
}

export const NO_PROVIDERS: SavedProviders = {
  active: null,
  openrouter: null,
  custom: null,
  connect: false,
};

const PROVIDERS_STORAGE = "bai-chat-providers:v1";
/** Where reactor-browser's AI settings store persists Connect's endpoint. */
export const CONNECT_AI_SETTINGS_KEY = "ph-ai-chat-settings";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

/**
 * What people paste is rarely the exact base: a bare origin, a URL with the
 * `/chat/completions` tail, a host without a scheme. Normalise to the base
 * every OpenAI-compatible server exposes — `…/v1` — and default a local host
 * to http (nobody runs TLS on localhost:11434) and anything else to https.
 */
export function normalizeBaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    const host = s.split("/")[0];
    s = `${LOCAL_HOST_RE.test(host) ? "http" : "https"}://${s}`;
  }
  s = s.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  try {
    const u = new URL(s);
    if (u.pathname === "" || u.pathname === "/") return `${u.origin}/v1`;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return s;
  }
}

/** Whether the endpoint is on this machine — decides the CORS hint. */
export function isLocalEndpoint(url: string): boolean {
  try {
    return LOCAL_HOST_RE.test(new URL(url).host);
  } catch {
    return false;
  }
}

function hostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface ConnectAiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Connect's AI-assistant settings, when a version of Connect that has them
 * saved an endpoint and a model in this browser. The key is optional here on
 * purpose: Connect's own form requires one, but a local server needs none.
 */
export function connectAiSettings(): ConnectAiSettings | null {
  try {
    const raw = localStorage.getItem(CONNECT_AI_SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as {
      baseUrl?: unknown;
      apiKey?: unknown;
      model?: unknown;
    };
    const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim() : "";
    const model = typeof p.model === "string" ? p.model.trim() : "";
    if (!baseUrl || !model) return null;
    return {
      baseUrl,
      apiKey: typeof p.apiKey === "string" ? p.apiKey.trim() : "",
      model,
    };
  } catch {
    return null;
  }
}

function compatibleEndpoint(
  baseUrl: string,
  apiKey: string | null,
  label: string,
  pinnedModel: string | null,
): ChatEndpoint | null {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return null;
  return {
    completionsUrl: `${base}/chat/completions`,
    modelsUrl: `${base}/models`,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    openRouter: /^https:\/\/openrouter\.ai\//i.test(base),
    label,
    pinnedModel,
    extraBody: null,
  };
}

/** The endpoint a provider resolves to; null when it is not (yet) usable. */
export function endpointFor(p: ChatProvider): ChatEndpoint | null {
  switch (p.kind) {
    case "openrouter":
      return {
        completionsUrl: `${OPENROUTER_BASE}/chat/completions`,
        modelsUrl: `${OPENROUTER_BASE}/models`,
        headers: { Authorization: `Bearer ${p.key}` },
        openRouter: true,
        label: "OpenRouter",
        pinnedModel: null,
        extraBody: null,
      };
    case "custom": {
      const ep = compatibleEndpoint(
        p.baseUrl,
        p.apiKey,
        hostLabel(normalizeBaseUrl(p.baseUrl)),
        null,
      );
      return ep ? { ...ep, extraBody: p.extraBody } : null;
    }
    case "connect": {
      const s = connectAiSettings();
      if (!s) return null;
      return compatibleEndpoint(
        s.baseUrl,
        s.apiKey || null,
        `Connect's AI settings · ${hostLabel(normalizeBaseUrl(s.baseUrl))}`,
        s.model,
      );
    }
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function plainObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Every saved connection. A browser that connected to OpenRouter before this
 * existed has only the key under its old name; that still counts, unchanged,
 * so nobody has to reconnect after an upgrade.
 */
export function readSavedProviders(): SavedProviders {
  let saved: SavedProviders = { ...NO_PROVIDERS };
  try {
    const raw = localStorage.getItem(PROVIDERS_STORAGE);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Record<keyof SavedProviders, unknown>>;
      const or = plainObject(p.openrouter);
      const custom = plainObject(p.custom);
      saved = {
        active:
          p.active === "openrouter" || p.active === "custom" || p.active === "connect"
            ? p.active
            : null,
        openrouter: or && str(or.key) ? { key: str(or.key)! } : null,
        custom:
          custom && str(custom.baseUrl)
            ? {
                baseUrl: str(custom.baseUrl)!,
                apiKey: str(custom.apiKey),
                model: str(custom.model),
                extraBody: plainObject(custom.extraBody),
              }
            : null,
        connect: p.connect === true,
      };
    }
  } catch {
    saved = { ...NO_PROVIDERS };
  }
  if (!saved.openrouter) {
    const legacy = getStoredKey();
    if (legacy) {
      saved.openrouter = { key: legacy };
      if (!saved.active) saved.active = "openrouter";
    }
  }
  // An active kind with nothing saved under it is a stale pointer.
  if (saved.active && !providerOf(saved, saved.active)) saved.active = null;
  return saved;
}

export function writeSavedProviders(s: SavedProviders): void {
  try {
    localStorage.setItem(PROVIDERS_STORAGE, JSON.stringify(s));
  } catch {
    // Private mode / quota: the in-memory state still carries it this session.
  }
}

/** The saved connection of one kind, as a provider. */
export function providerOf(s: SavedProviders, kind: ProviderKind): ChatProvider | null {
  switch (kind) {
    case "openrouter":
      return s.openrouter ? { kind: "openrouter", key: s.openrouter.key } : null;
    case "custom":
      return s.custom ? { kind: "custom", ...s.custom } : null;
    case "connect":
      return s.connect ? { kind: "connect" } : null;
  }
}

/** The connection that answers, or null when none is active. */
export function activeProvider(s: SavedProviders): ChatProvider | null {
  return s.active ? providerOf(s, s.active) : null;
}

/** Kinds with a saved connection, in the order the UI lists them. */
export function savedKinds(s: SavedProviders): ProviderKind[] {
  const out: ProviderKind[] = [];
  if (s.custom) out.push("custom");
  if (s.openrouter) out.push("openrouter");
  if (s.connect) out.push("connect");
  return out;
}

/**
 * Reasoning models think before every reply — including every tool round of
 * the agent loop, which is where a local model spends most of its time. The
 * switch is a request field, spelled the way each server family reads it:
 * top-level `enable_thinking` (Unsloth Studio, Qwen-style servers) and
 * `chat_template_kwargs.enable_thinking` (vLLM, llama.cpp, SGLang). Servers
 * ignore the spelling they do not know. Ollama's `think` rides along too.
 */
const THINKING_OFF: Record<string, unknown> = {
  enable_thinking: false,
  think: false,
  chat_template_kwargs: { enable_thinking: false },
};

/** True when the extra fields switch the model's thinking off. */
export function thinkingDisabled(extraBody: Record<string, unknown> | null): boolean {
  return extraBody?.enable_thinking === false;
}

/**
 * The extra fields with thinking switched on or off. Turning it on removes
 * exactly what turning it off added and nothing else — a user's own
 * `chat_template_kwargs` keys survive.
 */
export function withThinking(
  extraBody: Record<string, unknown> | null,
  enabled: boolean,
): Record<string, unknown> | null {
  const rest = { ...(extraBody ?? {}) };
  const kwargs =
    rest.chat_template_kwargs && typeof rest.chat_template_kwargs === "object"
      ? { ...(rest.chat_template_kwargs as Record<string, unknown>) }
      : {};
  if (enabled) {
    delete rest.enable_thinking;
    delete rest.think;
    delete kwargs.enable_thinking;
    if (Object.keys(kwargs).length > 0) rest.chat_template_kwargs = kwargs;
    else delete rest.chat_template_kwargs;
    return Object.keys(rest).length > 0 ? rest : null;
  }
  return {
    ...rest,
    ...THINKING_OFF,
    chat_template_kwargs: { ...kwargs, enable_thinking: false },
  };
}

/** A model as an OpenAI-compatible `/models` listing names it. */
export interface EndpointModel {
  id: string;
  name: string;
}

/**
 * The endpoint's model catalog. `[]` when the server serves completions but
 * no catalog (404/405 — some gateways); throws with the HTTP status when the
 * server refused (a wrong key shows up here, at connect time), and with the
 * network error when it could not be reached at all.
 */
export async function fetchEndpointModels(
  endpoint: ChatEndpoint,
  signal?: AbortSignal,
): Promise<EndpointModel[]> {
  const res = await fetch(endpoint.modelsUrl, {
    headers: endpoint.headers,
    signal,
  });
  if (res.status === 404 || res.status === 405) return [];
  if (!res.ok) {
    throw new Error(`${endpoint.label} answered ${res.status} to /models`);
  }
  const json = (await res.json().catch(() => null)) as {
    data?: unknown;
    models?: unknown;
  } | null;
  const list = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];
  return list
    .map((m): EndpointModel | null => {
      if (typeof m === "string") return { id: m, name: m };
      if (m && typeof m === "object") {
        const o = m as { id?: unknown; name?: unknown; model?: unknown };
        const id =
          typeof o.id === "string" ? o.id : typeof o.model === "string" ? o.model : null;
        if (!id) return null;
        return { id, name: typeof o.name === "string" && o.name ? o.name : id };
      }
      return null;
    })
    .filter((m): m is EndpointModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
