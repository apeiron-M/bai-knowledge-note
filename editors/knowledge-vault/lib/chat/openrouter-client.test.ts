import "../../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSseChunk, streamChat } from "./openrouter-client.js";

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
      key: "k",
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
    const r = await streamChat({ key: "k", model: "m", messages: [] });
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
    const r = await streamChat({ key: "k", model: "m", messages: [] });
    expect(r.toolCalls.map((t) => t.function.name)).toEqual(["a", "b"]);
  });

  it("handles an event split mid-JSON across two frames", async () => {
    mockStream([
      'data: {"choices":[{"delta":{"cont',
      'ent":"ok"}}]}\n\ndata: [DONE]\n\n',
    ]);
    expect(
      (await streamChat({ key: "k", model: "m", messages: [] })).text,
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
      (await streamChat({ key: "k", model: "m", messages: [] })).text,
    ).toBe("a");
  });

  it("sends tools and tool_choice only when tools are given", async () => {
    mockStream(["data: [DONE]\n\n"]);
    await streamChat({ key: "k", model: "m", messages: [] });
    expect(lastRequest().body).not.toHaveProperty("tools");

    mockStream(["data: [DONE]\n\n"]);
    const tool = {
      type: "function" as const,
      function: { name: "t", description: "d", parameters: {} },
    };
    await streamChat({
      key: "k",
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
      streamChat({ key: "k", model: "m", messages: [] }),
    ).rejects.toThrow(/402.*Insufficient credits/);
  });

  it("forwards the abort signal to fetch", async () => {
    mockStream(["data: [DONE]\n\n"]);
    const ctrl = new AbortController();
    await streamChat({
      key: "k",
      model: "m",
      messages: [],
      signal: ctrl.signal,
    });
    expect(lastRequest().init.signal).toBe(ctrl.signal);
  });
});
