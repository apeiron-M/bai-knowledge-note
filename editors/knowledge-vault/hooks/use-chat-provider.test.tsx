import "../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHostConfig, type KnowledgeVaultHostConfig } from "../../shared/host-config.js";
import { getStoredKey } from "../lib/chat/openrouter-auth.js";
import { readSavedProviders, writeSavedProviders, type SavedProviders } from "../lib/chat/provider.js";
import { useChatProvider, type UseChatProvider } from "./use-chat-provider.js";

/** One render of the hook, read the way the chat view reads it. */
function renderChat(): UseChatProvider {
  let seen: UseChatProvider | undefined;
  function Probe() {
    seen = useChatProvider();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return seen!;
}

const declare = (extra: Partial<KnowledgeVaultHostConfig> = {}) =>
  setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201", ...extra });

const GATEWAY = {
  baseUrl: "http://127.0.0.1:4202/llm/v1",
  model: "gpt-oss-20b",
  label: "gpt-oss-20b on this computer",
  headers: () => ({ authorization: "Bearer ctl" }),
};
const REMEMBERED: SavedProviders = {
  active: "custom",
  openrouter: { key: "sk-or-saved" },
  custom: { baseUrl: "http://127.0.0.1:8888/v1", apiKey: null, model: "qwen3", extraBody: null },
  connect: false,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  setHostConfig(undefined);
  vi.restoreAllMocks();
});

describe("useChatProvider in a browser or Connect (the host declares no model)", () => {
  it("is not connected until a connection is saved, and is not host-managed", () => {
    const chat = renderChat();
    expect(chat.hostManaged).toBe(false);
    expect(chat.openModelSettings).toBeNull();
    expect(chat.provider).toBeNull();
    expect(chat.isConnected).toBe(false);
    expect(chat.models).toEqual([]);
  });

  it("answers with the saved connection, exactly as before", () => {
    writeSavedProviders(REMEMBERED);
    const chat = renderChat();
    expect(chat.hostManaged).toBe(false);
    expect(chat.openModelSettings).toBeNull();
    expect(chat.provider?.kind).toBe("custom");
    expect(chat.isConnected).toBe(true);
    expect(chat.providerLabel).toBe("127.0.0.1:8888");
    expect(chat.model).toBe("qwen3");
    expect(chat.saved.map((c) => c.kind)).toEqual(["custom", "openrouter"]);
  });

  it("treats a desktop host that declares no model the same way", () => {
    writeSavedProviders(REMEMBERED);
    declare();
    const chat = renderChat();
    expect(chat.hostManaged).toBe(false);
    expect(chat.provider?.kind).toBe("custom");
    expect(chat.openModelSettings).toBeNull();
  });
});

describe("useChatProvider in the desktop app (the host declares its model)", () => {
  it("uses the declared model through the app's gateway, pinned", () => {
    const openModelSettings = () => {};
    declare({ model: GATEWAY, openModelSettings });
    const chat = renderChat();
    expect(chat.hostManaged).toBe(true);
    expect(chat.openModelSettings).toBe(openModelSettings);
    expect(chat.isConnected).toBe(true);
    expect(chat.provider?.kind).toBe("host");
    expect(chat.endpoint?.completionsUrl).toBe("http://127.0.0.1:4202/llm/v1/chat/completions");
    expect(chat.endpoint?.headers).toEqual({ authorization: "Bearer ctl", "x-kv-priority": "interactive" });
    expect(chat.providerLabel).toBe("gpt-oss-20b on this computer");
    expect(chat.model).toBe("gpt-oss-20b");
    expect(chat.models).toMatchObject([{ id: "gpt-oss-20b", name: "gpt-oss-20b" }]);
    expect(chat.modelsLoading).toBe(false);
    expect(chat.modelIsExplicit).toBe(true);
    expect(chat.modelIsFree).toBe(false);
    expect(chat.modelFellBack).toBe(false);
    expect(chat.fallbackModels).toEqual([]);
    expect(chat.saved).toEqual([]);
    expect(chat.connectSettings).toBeNull();
    expect(chat.thinkingDisabled).toBeNull();
    expect(chat.isCompletingOAuth).toBe(false);
    expect(chat.interruptedAttempt).toBe(false);
  });

  it("follows the declaration: a new model is picked up on the next read", () => {
    declare({ model: GATEWAY });
    expect(renderChat().model).toBe("gpt-oss-20b");
    declare({ model: { ...GATEWAY, model: "qwen3-8b", label: "qwen3-8b on this computer" } });
    const chat = renderChat();
    expect(chat.model).toBe("qwen3-8b");
    expect(chat.providerLabel).toBe("qwen3-8b on this computer");
  });

  it("is managed but not connected when the app has no model set up", () => {
    const openModelSettings = () => {};
    declare({ model: null, openModelSettings });
    const chat = renderChat();
    expect(chat.hostManaged).toBe(true);
    expect(chat.isConnected).toBe(false);
    expect(chat.provider).toBeNull();
    expect(chat.endpoint).toBeNull();
    expect(chat.model).toBe("");
    expect(chat.models).toEqual([]);
    expect(chat.openModelSettings).toBe(openModelSettings);
  });

  it("has no settings opener when the app declares none", () => {
    declare({ model: null });
    expect(renderChat().openModelSettings).toBeNull();
    declare({ model: GATEWAY });
    expect(renderChat().openModelSettings).toBeNull();
  });

  it("ignores the connections this browser remembers, even with the app's model unset", () => {
    writeSavedProviders(REMEMBERED);
    declare({ model: GATEWAY });
    expect(renderChat().provider?.kind).toBe("host");
    declare({ model: null });
    const chat = renderChat();
    expect(chat.isConnected).toBe(false);
    expect(chat.provider).toBeNull();
    expect(chat.saved).toEqual([]);
  });

  it("changes nothing in this browser: every connection action is a no-op", async () => {
    writeSavedProviders(REMEMBERED);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    declare({ model: GATEWAY });
    const chat = renderChat();

    chat.switchTo("openrouter");
    chat.addAnother();
    chat.setModel("another-model");
    chat.setThinking(false);
    chat.skipModel("gpt-oss-20b");
    chat.disconnect();
    expect(chat.useConnectSettings()).toBe(false);
    await chat.connectOpenRouter({ driveId: "d", draft: "" });
    expect(await chat.connectWithOpenRouterKey("sk-or-new")).toBe(false);
    expect(await chat.connectCustom({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3.1" })).toBe(
      "The desktop app sets the model in Settings › Models.",
    );

    expect(readSavedProviders()).toEqual(REMEMBERED);
    expect(getStoredKey()).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
