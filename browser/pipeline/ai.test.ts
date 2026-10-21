import "../../editors/shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSavedProviders } from "../../editors/knowledge-vault/lib/chat/provider.js";
import { AiRefusedError, AiUnreachableError, CALL_BUDGET, CallBudgetError, pipelineAi } from "./ai.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** The fetch the page has: records each request, answers models lists and completions. */
function page(answer: (url: string) => Response | Promise<Response> = () => json({ choices: [{ message: { content: "{}" } }] })) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (url.includes("/models")) return json({ data: [{ id: "x/model", context_length: 64000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"], created: 1 }] });
    return answer(url);
  });
  vi.stubGlobal("fetch", fetch);
  return seen;
}
const openRouter = () => writeSavedProviders({ active: "openrouter", openrouter: { key: "or-key" }, custom: null, connect: false });
const local = (model: string | null = "llama3") =>
  writeSavedProviders({ active: "custom", openrouter: null, custom: { baseUrl: "http://localhost:11434/v1", apiKey: null, model, extraBody: null }, connect: false });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("pipelineAi", () => {
  it("is null when the visitor connected no AI", async () => {
    page();
    expect(await pipelineAi()).toBeNull();
  });

  it("uses the OpenRouter key and the model the chat uses", async () => {
    page();
    openRouter();
    localStorage.setItem("bai-chat-model:v1", "x/model");
    const ai = await pipelineAi();
    expect(ai).toMatchObject({ model: "x/model", local: false, label: "OpenRouter" });
    expect(ai?.llm.credentials).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-key", defaultModel: "x/model" });
  });

  it("uses a local AI's own model, and sends it no OpenRouter headers and no empty key", async () => {
    const seen = page();
    local();
    const ai = await pipelineAi();
    expect(ai).toMatchObject({ model: "llama3", local: true });
    await ai!.fetchImpl("http://localhost:11434/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer ", "Content-Type": "application/json", "HTTP-Referer": "https://powerhouse.inc", "X-Title": "Powerhouse Knowledge Vault" },
      body: "{}",
    });
    const sent = seen.at(-1)!.headers;
    expect(sent["http-referer"]).toBeUndefined();
    expect(sent["x-title"]).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
    expect(sent["content-type"]).toBe("application/json");
  });

  it("keeps OpenRouter's attribution headers for OpenRouter", async () => {
    const seen = page();
    openRouter();
    const ai = await pipelineAi();
    await ai!.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer or-key", "X-Title": "Powerhouse Knowledge Vault" } });
    expect(seen.at(-1)!.headers).toMatchObject({ authorization: "Bearer or-key", "x-title": "Powerhouse Knowledge Vault" });
  });

  it(`stops a source at ${CALL_BUDGET} model calls`, async () => {
    page();
    local();
    const ai = (await pipelineAi())!;
    for (let i = 0; i < CALL_BUDGET; i++) await ai.fetchImpl("http://localhost:11434/v1/chat/completions", { method: "POST" });
    expect(ai.calls()).toBe(CALL_BUDGET);
    await expect(ai.fetchImpl("http://localhost:11434/v1/chat/completions", { method: "POST" })).rejects.toBeInstanceOf(CallBudgetError);
    // Asking for the model list is not a model call.
    await ai.fetchImpl("http://localhost:11434/v1/models");
  });

  it("calls an AI the browser cannot reach unreachable, not failed", async () => {
    page(() => {
      throw new TypeError("Failed to fetch");
    });
    local();
    const ai = (await pipelineAi())!;
    await expect(ai.fetchImpl("http://localhost:11434/v1/chat/completions", { method: "POST" })).rejects.toBeInstanceOf(AiUnreachableError);
  });

  it("calls a refused key refused", async () => {
    page(() => json({ error: { message: "bad key" } }, 401));
    openRouter();
    const ai = (await pipelineAi())!;
    await expect(ai.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST" })).rejects.toBeInstanceOf(AiRefusedError);
  });
});
