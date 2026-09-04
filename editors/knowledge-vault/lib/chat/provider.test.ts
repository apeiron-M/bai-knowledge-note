import "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storeKey } from "./openrouter-auth.js";
import {
  CONNECT_AI_SETTINGS_KEY,
  NO_PROVIDERS,
  activeProvider,
  connectAiSettings,
  endpointFor,
  fetchEndpointModels,
  isLocalEndpoint,
  normalizeBaseUrl,
  readSavedProviders,
  savedKinds,
  writeSavedProviders,
} from "./provider.js";

const local = { baseUrl: "http://127.0.0.1:8888/v1", apiKey: "sk-unsloth-x", model: "unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-IQ3_S", extraBody: { enable_thinking: false } };

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("normalizeBaseUrl", () => {
  it("adds the /v1 every OpenAI-compatible server exposes to a bare origin", () => {
    expect(normalizeBaseUrl("http://localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("http://localhost:11434/")).toBe("http://localhost:11434/v1");
  });

  it("keeps an explicit path, strips trailing slashes and a pasted /chat/completions tail", () => {
    expect(normalizeBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
    expect(normalizeBaseUrl("https://gw.example/openai/v1/chat/completions")).toBe("https://gw.example/openai/v1");
    expect(normalizeBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("defaults a local host to http and anything else to https when no scheme is given", () => {
    expect(normalizeBaseUrl("localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1");
    expect(normalizeBaseUrl("llm.example.com")).toBe("https://llm.example.com/v1");
    expect(normalizeBaseUrl("  ")).toBe("");
  });

  it("knows which endpoints are on this machine", () => {
    expect(isLocalEndpoint("http://localhost:11434/v1/chat/completions")).toBe(true);
    expect(isLocalEndpoint("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalEndpoint("https://openrouter.ai/api/v1")).toBe(false);
    expect(isLocalEndpoint("nonsense")).toBe(false);
  });
});

describe("endpointFor", () => {
  it("OpenRouter: fixed URLs, bearer key, fallback and attribution enabled", () => {
    expect(endpointFor({ kind: "openrouter", key: "k" })).toEqual({
      completionsUrl: "https://openrouter.ai/api/v1/chat/completions",
      modelsUrl: "https://openrouter.ai/api/v1/models",
      headers: { Authorization: "Bearer k" },
      openRouter: true,
      label: "OpenRouter",
      pinnedModel: null,
      extraBody: null,
    });
  });

  it("a named server: normalised base, key only when given, labelled by host, extras carried", () => {
    expect(endpointFor({ kind: "custom", baseUrl: "localhost:11434", apiKey: null, model: "llama3.1", extraBody: null })).toEqual({
      completionsUrl: "http://localhost:11434/v1/chat/completions",
      modelsUrl: "http://localhost:11434/v1/models",
      headers: {},
      openRouter: false,
      label: "localhost:11434",
      pinnedModel: null,
      extraBody: null,
    });
    const unsloth = endpointFor({ kind: "custom", ...local })!;
    expect(unsloth.completionsUrl).toBe("http://127.0.0.1:8888/v1/chat/completions");
    expect(unsloth.headers).toEqual({ Authorization: "Bearer sk-unsloth-x" });
    expect(unsloth.label).toBe("127.0.0.1:8888");
    expect(unsloth.extraBody).toEqual({ enable_thinking: false });
    expect(endpointFor({ kind: "custom", baseUrl: "", apiKey: null, model: null, extraBody: null })).toBeNull();
  });

  it("a named server that happens to be OpenRouter keeps OpenRouter's request extras", () => {
    expect(endpointFor({ kind: "custom", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: null, extraBody: null })?.openRouter).toBe(true);
  });

  it("Connect's settings: read live from reactor-browser's key, model pinned, key optional", () => {
    expect(endpointFor({ kind: "connect" })).toBeNull();
    localStorage.setItem(
      CONNECT_AI_SETTINGS_KEY,
      JSON.stringify({ enabled: true, baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen2.5", autoApproveWrites: false }),
    );
    expect(connectAiSettings()).toEqual({ baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen2.5" });
    expect(endpointFor({ kind: "connect" })).toEqual({
      completionsUrl: "http://localhost:1234/v1/chat/completions",
      modelsUrl: "http://localhost:1234/v1/models",
      headers: {},
      openRouter: false,
      label: "Connect's AI settings · localhost:1234",
      pinnedModel: "qwen2.5",
      extraBody: null,
    });
    localStorage.setItem(CONNECT_AI_SETTINGS_KEY, JSON.stringify({ baseUrl: "http://x/v1", model: "" }));
    expect(connectAiSettings()).toBeNull();
    localStorage.setItem(CONNECT_AI_SETTINGS_KEY, "garbage");
    expect(connectAiSettings()).toBeNull();
  });
});

describe("saved providers", () => {
  it("remembers every connection at once, with one active", () => {
    writeSavedProviders({ active: "custom", openrouter: { key: "k" }, custom: local, connect: true });
    const s = readSavedProviders();
    expect(s).toEqual({ active: "custom", openrouter: { key: "k" }, custom: local, connect: true });
    expect(savedKinds(s)).toEqual(["custom", "openrouter", "connect"]);
    expect(activeProvider(s)).toEqual({ kind: "custom", ...local });
    expect(activeProvider({ ...s, active: "openrouter" })).toEqual({ kind: "openrouter", key: "k" });
    expect(activeProvider({ ...s, active: null })).toBeNull();
  });

  it("drops a stale active pointer and empty optional fields", () => {
    writeSavedProviders({ active: "connect", openrouter: null, custom: { baseUrl: "http://x/v1", apiKey: "", model: "", extraBody: null } as never, connect: false });
    const s = readSavedProviders();
    expect(s.active).toBeNull();
    expect(s.custom).toEqual({ baseUrl: "http://x/v1", apiKey: null, model: null, extraBody: null });
  });

  it("still honours a key stored by the OpenRouter-only version, as the active connection", () => {
    storeKey("legacy-key");
    expect(readSavedProviders()).toEqual({ active: "openrouter", openrouter: { key: "legacy-key" }, custom: null, connect: false });
  });

  it("is empty when nothing is stored, and survives a corrupt record", () => {
    expect(readSavedProviders()).toEqual(NO_PROVIDERS);
    localStorage.setItem("bai-chat-providers:v1", "{not json");
    expect(readSavedProviders()).toEqual(NO_PROVIDERS);
  });
});

describe("fetchEndpointModels", () => {
  const ep = endpointFor({ kind: "custom", baseUrl: "http://localhost:11434/v1", apiKey: "k", model: null, extraBody: null })!;
  const respond = (status: number, body: unknown) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }) as unknown as typeof fetch;
  };

  it("reads the OpenAI `data` shape, sorted by name, sending the endpoint's headers", async () => {
    respond(200, { data: [{ id: "qwen2.5", object: "model" }, { id: "llama3.1", object: "model" }] });
    const list = await fetchEndpointModels(ep);
    expect(list).toEqual([
      { id: "llama3.1", name: "llama3.1" },
      { id: "qwen2.5", name: "qwen2.5" },
    ]);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("tolerates a `models` array of strings or {name} objects, and a missing catalog", async () => {
    respond(200, { models: ["a", { name: "b", model: "b:latest" }] });
    expect(await fetchEndpointModels(ep)).toEqual([
      { id: "a", name: "a" },
      { id: "b:latest", name: "b" },
    ]);
    respond(404, {});
    expect(await fetchEndpointModels(ep)).toEqual([]);
  });

  it("throws on a refusal so a bad key fails at connect time", async () => {
    respond(401, { error: "unauthorised" });
    await expect(fetchEndpointModels(ep)).rejects.toThrow(/localhost:11434 answered 401/);
  });
});
