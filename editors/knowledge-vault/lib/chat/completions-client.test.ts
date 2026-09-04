import "../../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MODELS_IN_REQUEST,
  ProviderError,
  ThinkFilter,
  parseSseChunk,
  streamChat,
} from "./completions-client.js";
import { endpointFor, type ChatEndpoint } from "./provider.js";

const OR = endpointFor({ kind: "openrouter", key: "k" })!;
/** A local OpenAI-compatible server: no key, no OpenRouter extras. */
const LOCAL: ChatEndpoint = endpointFor({
  kind: "custom",
  baseUrl: "http://localhost:11434",
  apiKey: null,
  model: "llama3.1",
  extraBody: null,
})!;

afterEach(() => vi.restoreAllMocks());

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}
function mockStream(frames: string[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: sseBody(frames),
  }) as unknown as typeof fetch;
}
function lastRequest() {
  const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
    .calls[0] as [string, RequestInit];
  return {
    url,
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

describe("parseSseChunk", () => {
  it("splits complete events and keeps the partial remainder", () => {
    const { events, rest } = parseSseChunk('data: {"a":1}\n\ndata: {"b":');
    expect(events).toEqual(['data: {"a":1}']);
    expect(rest).toBe('data: {"b":');
  });

  it("treats CRLF delimiters as event boundaries too", () => {
    const { events, rest } = parseSseChunk(
      'data: {"a":1}\r\n\r\ndata: x\r\n\r\n',
    );
    expect(events).toEqual(['data: {"a":1}', "data: x"]);
    expect(rest).toBe("");
  });
});

describe("streamChat", () => {
  it("assembles text deltas split across frames", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const seen: string[] = [];
    const r = await streamChat({
      endpoint: OR,
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      onText: (d) => seen.push(d),
    });
    expect(r.text).toBe("Hello");
    expect(seen).toEqual(["Hel", "lo"]);
    expect(r.finishReason).toBe("stop");
    expect(r.toolCalls).toEqual([]);
  });

  it("accumulates tool-call arguments arriving as fragments", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"search_vault","arguments":"{\\"qu"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\\":\\"x\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const r = await streamChat({ endpoint: OR, model: "m", messages: [] });
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].id).toBe("c1");
    expect(r.toolCalls[0].function.name).toBe("search_vault");
    expect(JSON.parse(r.toolCalls[0].function.arguments)).toEqual({
      query: "x",
    });
  });

  it("keeps parallel tool calls separate by index and in order", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"b","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"a","arguments":"{}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const r = await streamChat({ endpoint: OR, model: "m", messages: [] });
    expect(r.toolCalls.map((t) => t.function.name)).toEqual(["a", "b"]);
  });

  it("handles an event split mid-JSON across two frames", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"cont',
      'ent":"ok"}}]}\n\ndata: [DONE]\n\n',
    ]);
    expect(
      (await streamChat({ endpoint: OR, model: "m", messages: [] })).text,
    ).toBe("ok");
  });

  it("ignores SSE comments, keep-alives and malformed frames", async () => {
    mockStream([
      ": OPENROUTER PROCESSING\n\n",
      "data: not json at all\n\n",
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(
      (await streamChat({ endpoint: OR, model: "m", messages: [] })).text,
    ).toBe("a");
  });

  it("sends tools and tool_choice only when tools are given", async () => {
    mockStream(["data: [DONE]\n\n"]);
    await streamChat({ endpoint: OR, model: "m", messages: [] });
    expect(lastRequest().body).not.toHaveProperty("tools");

    mockStream(["data: [DONE]\n\n"]);
    const tool = {
      type: "function" as const,
      function: { name: "t", description: "d", parameters: {} },
    };
    await streamChat({
      endpoint: OR,
      model: "m",
      messages: [],
      tools: [tool],
      toolChoice: "none",
    });
    const { body, init } = lastRequest();
    expect(body.tools).toEqual([tool]);
    expect(body.tool_choice).toBe("none");
    expect(body.stream).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer k",
    );
  });

  it("throws with the provider's message on a non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: () =>
        Promise.resolve('{"error":{"message":"Insufficient credits"}}'),
    }) as unknown as typeof fetch;
    await expect(
      streamChat({ endpoint: OR, model: "m", messages: [] }),
    ).rejects.toThrow(/402.*Insufficient credits/);
  });

  it("sends a models array for server-side fallback when fallbacks are given", async () => {
    mockStream(["data: [DONE]\n\n"]);
    await streamChat({
      endpoint: OR,
      model: "a/primary",
      messages: [],
      fallbackModels: ["b/two", "c/three"],
    });
    const { body } = lastRequest();
    expect(body.model).toBe("a/primary");
    expect(body.models).toEqual(["a/primary", "b/two", "c/three"]);

    mockStream(["data: [DONE]\n\n"]);
    await streamChat({ endpoint: OR, model: "a/primary", messages: [] });
    expect(lastRequest().body).not.toHaveProperty("models");
  });

  it("never sends more models than OpenRouter accepts, primary included", async () => {
    mockStream(["data: [DONE]\n\n"]);
    await streamChat({
      endpoint: OR,
      model: "a/primary",
      messages: [],
      fallbackModels: ["b", "c", "d", "e"],
    });
    const models = lastRequest().body.models as string[];
    expect(models).toHaveLength(MAX_MODELS_IN_REQUEST);
    expect(models[0]).toBe("a/primary");
    expect(MAX_MODELS_IN_REQUEST).toBe(3);
  });

  it("reports which model actually answered", async () => {
    mockStream([
      'data: {"model":"b/two","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"model":"b/two","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const r = await streamChat({
      endpoint: OR,
      model: "a/primary",
      messages: [],
      fallbackModels: ["b/two"],
    });
    expect(r.model).toBe("b/two");
  });

  it("throws an ProviderError carrying the status and raw body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(
          '{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day"}}',
        ),
    }) as unknown as typeof fetch;
    const err = await streamChat({ endpoint: OR, model: "m", messages: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderError);
    const e = err as ProviderError;
    expect(e.status).toBe(429);
    expect(e.providerMessage).toBe("Rate limit exceeded: free-models-per-day");
    expect(e.raw).toContain("free-models-per-day");
  });

  it("forwards the abort signal to fetch", async () => {
    mockStream(["data: [DONE]\n\n"]);
    const ctrl = new AbortController();
    await streamChat({
      endpoint: OR,
      model: "m",
      messages: [],
      signal: ctrl.signal,
    });
    expect(lastRequest().init.signal).toBe(ctrl.signal);
  });
});

describe("streamChat against a plain OpenAI-compatible server", () => {
  it("posts to the server's completions URL with no key, no attribution headers and no models array", async () => {
    mockStream(["data: [DONE]\n\n"]);
    await streamChat({
      endpoint: LOCAL,
      model: "llama3.1",
      messages: [],
      fallbackModels: ["b", "c"],
    });
    const { url, init, body } = lastRequest();
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(body).not.toHaveProperty("models");
    expect(body.model).toBe("llama3.1");
    expect(body.stream).toBe(true);
  });

  it("sends the key as a bearer token when the endpoint has one", async () => {
    mockStream(["data: [DONE]\n\n"]);
    const keyed = endpointFor({ kind: "custom", baseUrl: "https://llm.example/v1", apiKey: "s3cret", model: null, extraBody: null })!;
    await streamChat({ endpoint: keyed, model: "m", messages: [] });
    expect((lastRequest().init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
  });

  it("keeps tool calls apart by id when the server omits index, and continues the last one for id-less fragments", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"a","function":{"name":"search_vault","arguments":"{\\"q"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"uery\\":1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"b","function":{"name":"read_note","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const r = await streamChat({ endpoint: LOCAL, model: "m", messages: [] });
    expect(r.toolCalls.map((t) => [t.id, t.function.name, t.function.arguments])).toEqual([
      ["a", "search_vault", '{"query":1}'],
      ["b", "read_note", "{}"],
    ]);
  });

  it("accepts a whole JSON completion from a server that ignored stream: true", async () => {
    mockStream([
      JSON.stringify({
        model: "llama3.1",
        choices: [
          {
            message: {
              content: "Hello there",
              tool_calls: [{ id: "x", type: "function", function: { name: "vault_stats", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    ]);
    const seen: string[] = [];
    const r = await streamChat({ endpoint: LOCAL, model: "m", messages: [], onText: (d) => seen.push(d) });
    expect(r.text).toBe("Hello there");
    expect(seen).toEqual(["Hello there"]);
    expect(r.model).toBe("llama3.1");
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls.map((t) => t.function.name)).toEqual(["vault_stats"]);
  });

  it("names the endpoint, not OpenRouter, in its errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":{"message":"model \'llama3.1\' not found, try pulling it first"}}'),
    }) as unknown as typeof fetch;
    const err = (await streamChat({ endpoint: LOCAL, model: "llama3.1", messages: [] }).catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/^localhost:11434 404: model 'llama3.1' not found/);
    expect(err.openRouter).toBe(false);
  });
});

describe("server-specific request fields and reasoning models", () => {
  it("merges the endpoint's extra fields into the body without letting them override the protocol's", async () => {
    mockStream(["data: [DONE]\n\n"]);
    const unsloth = endpointFor({
      kind: "custom",
      baseUrl: "http://127.0.0.1:8888/v1",
      apiKey: "sk-unsloth-x",
      model: "unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-IQ3_S",
      extraBody: { enable_thinking: false, temperature: 0.7, model: "ignored", stream: false },
    })!;
    await streamChat({ endpoint: unsloth, model: "unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-IQ3_S", messages: [] });
    const { url, body, init } = lastRequest();
    expect(url).toBe("http://127.0.0.1:8888/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-unsloth-x");
    expect(body.enable_thinking).toBe(false);
    expect(body.temperature).toBe(0.7);
    expect(body.model).toBe("unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-IQ3_S");
    expect(body.stream).toBe(true);
  });

  it("filters <think> blocks out of the streamed text, even when a tag straddles chunks", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"nk>let me reason"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" about it</th"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ink>\\nThe answer"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" is 42 <"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"3"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const seen: string[] = [];
    const r = await streamChat({ endpoint: LOCAL, model: "m", messages: [], onText: (d) => seen.push(d) });
    expect(r.text).toBe("The answer is 42 <3");
    expect(seen.join("")).toBe("The answer is 42 <3");
  });

  it("ignores reasoning_content deltas and strips thinking from a whole completion too", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"reasoning_content":"hmm","content":null}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect((await streamChat({ endpoint: LOCAL, model: "m", messages: [] })).text).toBe("ok");

    mockStream([JSON.stringify({ choices: [{ message: { content: "<think>x</think>\nplain" }, finish_reason: "stop" }] })]);
    expect((await streamChat({ endpoint: LOCAL, model: "m", messages: [] })).text).toBe("plain");
  });

  it("ThinkFilter keeps text that merely resembles a tag", () => {
    const f = new ThinkFilter();
    expect(f.push("a < b and <thin") + f.flush()).toBe("a < b and <thin");
    const g = new ThinkFilter();
    expect(g.push("<think>secret") + g.flush()).toBe("");
  });
});
