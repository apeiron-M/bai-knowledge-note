import "../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHostConfig, type KnowledgeVaultHostConfig } from "../../shared/host-config.js";
import { writeSavedProviders } from "../lib/chat/provider.js";
import { ChatView } from "./ChatView.js";

vi.mock("@powerhousedao/reactor-browser", () => ({ useSelectedDriveId: () => "drive-1" }));
vi.mock("../hooks/use-vault-name.js", () => ({ useVaultName: () => "Research" }));

const declare = (extra: Partial<KnowledgeVaultHostConfig> = {}) =>
  setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201", ...extra });

const GATEWAY = {
  baseUrl: "http://127.0.0.1:4202/llm/v1",
  model: "gpt-oss-20b",
  label: "gpt-oss-20b on this computer",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => setHostConfig(undefined));

describe("ChatView in the desktop app", () => {
  it("shows the app's model and a way to change it, and none of the browser's connection controls", () => {
    declare({ model: GATEWAY, openModelSettings: () => {} });
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("gpt-oss-20b on this computer");
    expect(html).toContain("The AI model set in the app&#x27;s Settings › Models");
    expect(html).toMatch(/<button[^>]*>Change in Settings<\/button>/);
    expect(html).not.toContain("Disconnect");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("Connect with OpenRouter");
    expect(html).toContain("Ask Research anything");
  });

  it("offers no settings button when the app gave the chat no way to open them", () => {
    declare({ model: GATEWAY });
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("gpt-oss-20b on this computer");
    expect(html).not.toContain("Change in Settings");
    expect(html).not.toContain("Disconnect");
  });

  it("asks for a model, instead of a connection, when the app has none set up", () => {
    declare({ model: null, openModelSettings: () => {} });
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("No AI model is set up yet");
    expect(html).toContain("Set up an AI model");
    expect(html).not.toContain("Connect with OpenRouter");
    expect(html).not.toContain("Ask Research anything");
  });

  it("does not use a connection this browser remembers", () => {
    writeSavedProviders({
      active: "custom",
      openrouter: null,
      custom: { baseUrl: "http://127.0.0.1:8888/v1", apiKey: null, model: "qwen3", extraBody: null },
      connect: false,
    });
    declare({ model: null });
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("No AI model is set up yet");
    expect(html).not.toContain("Ask Research anything");
  });
});

describe("ChatView in a browser or Connect", () => {
  it("shows the connect screen until a model is connected", () => {
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("Connect with OpenRouter");
    expect(html).not.toContain("No AI model is set up yet");
    expect(html).not.toContain("Change in Settings");
  });

  it("keeps its own connection controls once one is saved", () => {
    writeSavedProviders({
      active: "custom",
      openrouter: null,
      custom: { baseUrl: "http://127.0.0.1:8888/v1", apiKey: null, model: "qwen3", extraBody: null },
      connect: false,
    });
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("Disconnect");
    expect(html).toContain("Which model endpoint answers");
    expect(html).toContain("Choose a model");
    expect(html).not.toContain("Change in Settings");
  });

  it("a desktop host that declares no model leaves the chat as it is", () => {
    declare();
    const html = renderToStaticMarkup(<ChatView />);
    expect(html).toContain("Connect with OpenRouter");
    expect(html).not.toContain("No AI model is set up yet");
  });
});
