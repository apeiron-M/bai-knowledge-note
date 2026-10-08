import "../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setHostConfig,
  type KnowledgeVaultHostConfig,
} from "../../shared/host-config.js";
import type { ChatFailure, UseChat } from "../hooks/use-chat.js";
import { ProviderError } from "../lib/chat/completions-client.js";
import { classifyFailure, type FailureKind } from "../lib/chat/failure.js";
import { writeSavedProviders } from "../lib/chat/provider.js";
import { ChatView } from "./ChatView.js";

// A failure notice only appears once a turn has failed, and a static render never runs the
// effects that would send one. So the chat hook is stood in for with one failed turn; the
// provider, the header and the notice around it are the real ones.
const turn = vi.hoisted(() => ({ failure: null as ChatFailure | null }));

vi.mock("@powerhousedao/reactor-browser", () => ({
  useSelectedDriveId: () => "drive-1",
}));
vi.mock("../hooks/use-vault-name.js", () => ({
  useVaultName: () => "Research",
}));
vi.mock("../hooks/use-chat.js", () => ({
  useChat: (): UseChat => ({
    threads: [],
    thread: null,
    messages: [
      { role: "user", content: "What does the vault say about drift?" },
    ],
    streamingText: "",
    trail: [],
    isStreaming: false,
    failure: turn.failure,
    routedFrom: null,
    send: () => Promise.resolve(),
    stop: () => {},
    newThread: () => {},
    openThread: () => {},
    removeThread: () => {},
  }),
}));

type Where = { label: string; completionsUrl: string };

/** A failed turn as the chat records it: the real classifier, the model the turn was addressed to. */
const failed = (err: unknown, at: Where, model: string): ChatFailure => ({
  ...classifyFailure(err, at),
  model,
});

/** The failure notice out of a whole render; throws when there is none. */
function noticeOf(html: string): string {
  const found = /<div[^>]*role="alert"[^>]*>.*?<\/div>/s.exec(html);
  if (!found) throw new Error("the render has no failure notice");
  return found[0];
}

const render = () => renderToStaticMarkup(<ChatView />);

/** The notice's frame, exactly as the browser has always rendered it. */
const FRAME =
  '<div class="rounded-lg px-3 py-2 text-xs" style="background-color:rgba(239,68,68,0.08);color:#ef4444;border:1px solid rgba(239,68,68,0.25)" role="alert">';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  turn.failure = null;
  setHostConfig(undefined);
});

describe("a failed turn in the desktop app", () => {
  const GATEWAY = {
    baseUrl: "http://127.0.0.1:4202/llm/v1",
    model: "gpt-oss-20b",
    label: "gpt-oss-20b on this computer",
  };
  const at: Where = {
    label: GATEWAY.label,
    completionsUrl: `${GATEWAY.baseUrl}/chat/completions`,
  };
  const openModelSettings = vi.fn();
  const REMEDY = "Check the AI model in the app&#x27;s Settings › Models.";
  // Every remedy the browser's notices give, and every control they point at.
  const BROWSER_ONLY = /disconnect|ollama|lm studio|\bcors\b|from the menu/i;

  const declare = (
    extra: Partial<KnowledgeVaultHostConfig> = {
      model: GATEWAY,
      openModelSettings,
    },
  ) =>
    setHostConfig({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
      ...extra,
    });

  it.each([
    {
      when: "the key the app holds is refused",
      err: new ProviderError(
        401,
        "OpenRouter refused the API key.",
        "{}",
        at.label,
        false,
      ),
      said: "OpenRouter refused the API key.",
    },
    {
      // 404, any 5xx, and any 429 on an endpoint that is not OpenRouter all land here:
      // routinely a local model that is still loading, or has crashed.
      when: "the model cannot be served",
      err: new ProviderError(
        503,
        "The model server on this computer answered 503: the model is loading.",
        "{}",
        at.label,
        false,
      ),
      said: "The model server on this computer answered 503: the model is loading.",
    },
  ])(
    "$when: the provider's own sentence, then the app's settings",
    ({ err, said }) => {
      turn.failure = failed(err, at, GATEWAY.model);
      declare();
      const html = render();
      const notice = noticeOf(html);
      expect(notice.startsWith(FRAME)).toBe(true);
      expect(notice).toContain(`<p>${said}</p>`);
      expect(notice).toContain(REMEDY);
      expect(notice).toMatch(/<button[^>]*>Open Settings<\/button>/);
      expect(html).not.toMatch(BROWSER_ONLY);
    },
  );

  it("the app's model service not answering says so in plain words, with none of the browser's advice", () => {
    const failure = failed(new TypeError("Failed to fetch"), at, GATEWAY.model);
    // The classifier cannot tell the app's loopback gateway from a local server the user named,
    // so the failure the notice is handed does carry the browser's advice. The notice must not show it.
    expect(failure.kind).toBe("unreachable");
    expect(failure.message).toContain("OLLAMA_ORIGINS");
    turn.failure = failure;
    declare();
    const html = render();
    const notice = noticeOf(html);
    expect(notice).toContain(
      "<p>The app&#x27;s AI model service did not answer.</p>",
    );
    expect(notice).toContain(REMEDY);
    expect(notice).toMatch(/<button[^>]*>Open Settings<\/button>/);
    expect(html).not.toMatch(BROWSER_ONLY);
    expect(html).not.toContain("OLLAMA_ORIGINS");
    expect(html).not.toContain("send the message again");
  });

  it.each<[FailureKind, string]>([
    ["credits", "OpenRouter says the account is out of credit."],
    ["free-quota", "OpenRouter is rate-limiting requests."],
    ["other", "The model gateway could not handle the request."],
  ])(
    "%s: the provider's own sentence, then the app's settings",
    (kind, said) => {
      turn.failure = { kind, message: said, model: GATEWAY.model };
      declare();
      const html = render();
      const notice = noticeOf(html);
      expect(notice).toContain(`<p>${said}</p>`);
      expect(notice).toContain(REMEDY);
      expect(notice).toMatch(/<button[^>]*>Open Settings<\/button>/);
      expect(html).not.toMatch(BROWSER_ONLY);
    },
  );

  it("Open Settings is the only way offered; with no opener the notice says where to go and shows no dead button", () => {
    turn.failure = failed(
      new ProviderError(
        401,
        "OpenRouter refused the API key.",
        "{}",
        at.label,
        false,
      ),
      at,
      GATEWAY.model,
    );
    declare({ model: GATEWAY });
    const notice = noticeOf(render());
    expect(notice).toContain("<p>OpenRouter refused the API key.</p>");
    expect(notice).toContain(REMEDY);
    expect(notice).not.toContain("<button");
  });

  it("shows no notice for a turn the user stopped", () => {
    turn.failure = {
      kind: "aborted",
      message: "Stopped.",
      model: GATEWAY.model,
    };
    declare();
    expect(render()).not.toContain('role="alert"');
  });
});

describe("the same failed turns in a browser", () => {
  const at: Where = {
    label: "127.0.0.1:8888",
    completionsUrl: "http://127.0.0.1:8888/v1/chat/completions",
  };

  const connect = (saved: Partial<Parameters<typeof writeSavedProviders>[0]>) =>
    writeSavedProviders({
      active: null,
      openrouter: null,
      custom: null,
      connect: false,
      ...saved,
    });
  const server = () =>
    connect({
      active: "custom",
      custom: {
        baseUrl: "http://127.0.0.1:8888/v1",
        apiKey: null,
        model: "qwen3",
        extraBody: null,
      },
    });

  it("a refused key still says to disconnect and connect again", () => {
    server();
    turn.failure = failed(
      new ProviderError(401, "refused", "{}", at.label, false),
      at,
      "qwen3",
    );
    expect(noticeOf(render())).toBe(
      `${FRAME}<p>refused</p><p class="mt-1.5 opacity-80">127.0.0.1:8888 rejected the key. Disconnect, then connect again with a valid one — or with none, if the server does not need it.</p></div>`,
    );
  });

  it("a model the server cannot serve still points at the model menu and Ollama", () => {
    server();
    turn.failure = failed(
      new ProviderError(
        404,
        "model not found, try pulling it first",
        "{}",
        at.label,
        false,
      ),
      at,
      "qwen3",
    );
    expect(noticeOf(render())).toBe(
      `${FRAME}<p>model not found, try pulling it first</p><p class="mt-1.5 opacity-80">127.0.0.1:8888 could not serve qwen3. Pick a model it lists from the menu — or, for Ollama, pull it first (<span class="font-mono">ollama pull qwen3</span>) — and send again.</p></div>`,
    );
  });

  it("a server that does not answer still gets the Ollama and LM Studio advice", () => {
    server();
    turn.failure = failed(new TypeError("Failed to fetch"), at, "qwen3");
    expect(noticeOf(render())).toBe(
      `${FRAME}<p>Could not reach 127.0.0.1:8888 (Failed to fetch). Is the server running, and does it allow browser requests from http://localhost:3000? Ollama: start it with OLLAMA_ORIGINS=&quot;http://localhost:3000&quot;. LM Studio: enable CORS in the server settings.</p><p class="mt-1.5 opacity-80">Once the server answers, just send the message again.</p></div>`,
    );
  });

  it("a billing failure on OpenRouter still points at the free models and credits", () => {
    connect({ active: "openrouter", openrouter: { key: "sk-or-saved" } });
    turn.failure = failed(
      new ProviderError(402, "Insufficient credits", "{}", "OpenRouter", true),
      {
        label: "OpenRouter",
        completionsUrl: "https://openrouter.ai/api/v1/chat/completions",
      },
      "some/model",
    );
    expect(noticeOf(render())).toBe(
      `${FRAME}<p>Insufficient credits</p><p class="mt-1.5 opacity-80">This model bills per token. Pick one marked <span class="font-semibold">free</span> from the model menu, or add credits on OpenRouter.</p></div>`,
    );
  });

  it("a failure with no next step shows the provider's sentence alone", () => {
    server();
    turn.failure = {
      kind: "other",
      message: "Something else went wrong.",
      model: "qwen3",
    };
    expect(noticeOf(render())).toBe(
      `${FRAME}<p>Something else went wrong.</p></div>`,
    );
  });

  it("a desktop host that declares no model leaves the notice as it was", () => {
    server();
    setHostConfig({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
      openModelSettings: () => {},
    });
    turn.failure = failed(
      new ProviderError(401, "refused", "{}", at.label, false),
      at,
      "qwen3",
    );
    const notice = noticeOf(render());
    expect(notice).toContain("Disconnect, then connect again with a valid one");
    expect(notice).not.toContain("Open Settings");
  });
});
