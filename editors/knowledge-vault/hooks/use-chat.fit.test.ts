import "../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_CEILING_TOKENS,
  LAST_RESULT_MAX_CHARS,
  RETRY_DELAY_MS,
  fitTranscript,
  isContextOverflow,
  isTransientFailure,
  runAgentLoop,
  shortenedResult,
  type TrailEntry,
} from "./use-chat.js";
import { ProviderError, type ChatMessage } from "../lib/chat/completions-client.js";
import { endpointFor } from "../lib/chat/provider.js";

/** The desktop app's model, through its gateway — the setup the 504 came from. */
const HOST = endpointFor({
  kind: "host",
  baseUrl: "http://127.0.0.1:4202/llm/v1",
  model: "gpt-6.1-sol",
  label: "gpt-6.1-sol on your ChatGPT plan",
  headers: {},
})!;
const base = { endpoint: HOST, model: "gpt-6.1-sol", driveId: "d" };
const tc = (name: string, args: string, id: string) => ({ id, type: "function" as const, function: { name, arguments: args } });
const answer = (text: string) => ({ text, toolCalls: [], finishReason: "stop", model: null });
const wantsTool = (id: string) => ({ text: "", toolCalls: [tc("read_note", `{"documentId":"${id}"}`, `call-${id}`)], finishReason: "tool_calls", model: null });
const note = (id: string, body: string) => ({
  ok: true as const,
  summary: `read "${id}"`,
  data: { documentId: id, title: `Note ${id}`, documentType: "bai/knowledge-note", content: body },
});

afterEach(() => vi.useRealTimers());

describe("a service that fails for a moment", () => {
  it("asks the same round again, keeping the reading already done", async () => {
    vi.useFakeTimers();
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(wantsTool("n1"))
      .mockRejectedValueOnce(new ProviderError(504, "ChatGPT answered 504 (Gateway time-out)", "", HOST.label, false))
      .mockResolvedValueOnce(answer("Inference strategy is a product decision [[n1]]."));
    const executeTool = vi.fn().mockResolvedValue(note("n1", "Body"));
    const run = runAgentLoop({ ...base, messages: [{ role: "user", content: "inference?" }], deps: { streamChat, executeTool } as never });
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const r = await run;
    expect(r.text).toBe("Inference strategy is a product decision [[n1]].");
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(r.trail.map((e) => e.summary)).toEqual([
      'read "n1"',
      "gpt-6.1-sol on your ChatGPT plan did not answer (HTTP 504) — asked again",
    ]);
    // The retry sent the same conversation, tool result included.
    const retried = streamChat.mock.calls[2][0] as { messages: ChatMessage[] };
    expect(retried.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-n1" });
  });

  it("gives up after two retries and lets the failure through", async () => {
    vi.useFakeTimers();
    const fail = new ProviderError(502, "Bad gateway", "", HOST.label, false);
    const streamChat = vi.fn().mockRejectedValue(fail);
    const run = runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool: vi.fn() } as never });
    const settled = run.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2);
    expect(await settled).toBe(fail);
    expect(streamChat).toHaveBeenCalledTimes(3);
  });

  it("asks again only once after a slow failure: each already cost a long wait", async () => {
    vi.useFakeTimers();
    const slow = new ProviderError(504, "Gateway time-out", "", HOST.label, false);
    const streamChat = vi.fn().mockRejectedValue(slow);
    const settled = runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool: vi.fn() } as never }).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2);
    expect(await settled).toBe(slow);
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("leaves a 503 to the gateway, which already asked again", async () => {
    const unavailable = new ProviderError(503, "Service unavailable", "", HOST.label, false);
    const streamChat = vi.fn().mockRejectedValue(unavailable);
    await expect(
      runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool: vi.fn() } as never }),
    ).rejects.toBe(unavailable);
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("does not ask again once part of the reply has reached the reader", async () => {
    const streamChat = vi.fn().mockImplementation((o: { onText?: (d: string) => void }) => {
      o.onText?.("Partial ");
      return Promise.reject(new ProviderError(504, "Gateway time-out", "", HOST.label, false));
    });
    await expect(
      runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool: vi.fn() } as never }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("stops waiting the moment the person stops the answer", async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const streamChat = vi.fn().mockRejectedValue(new ProviderError(502, "Bad gateway", "", HOST.label, false));
    const run = runAgentLoop({ ...base, signal: ctrl.signal, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool: vi.fn() } as never });
    const settled = run.then(
      () => null,
      (e: unknown) => e,
    );
    // The first ask failed and the loop is pausing before the second.
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2);
    ctrl.abort();
    expect(await settled).toMatchObject({ name: "AbortError" });
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("knows a brief failure from a refusal", () => {
    for (const status of [408, 502, 504, 524, 529]) {
      expect(isTransientFailure(new ProviderError(status, "", "", "x", false))).toBe(true);
    }
    // 503 is the gateway's to retry; 429 is a limit, not a blip.
    for (const status of [400, 401, 402, 404, 429, 500, 503]) {
      expect(isTransientFailure(new ProviderError(status, "", "", "x", false))).toBe(false);
    }
  });
});

describe("a model whose context window is full", () => {
  it("recognises how each kind of server says so", () => {
    const said = [
      "The model server on this computer answered 400: the request exceeds the available context size, try increasing it",
      "This model's maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens.",
      "prompt is too long: 210000 tokens > 200000 maximum",
      "The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).",
      '{"error":{"code":"context_length_exceeded"}}',
    ];
    for (const s of said) expect(isContextOverflow(new ProviderError(400, s, s, "x", false))).toBe(true);
    expect(isContextOverflow(new ProviderError(400, "Unsupported value: 'temperature'", "", "x", false))).toBe(false);
  });

  it("shortens what the model already read and asks again", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(wantsTool("n1"))
      .mockResolvedValueOnce(wantsTool("n2"))
      .mockRejectedValueOnce(
        new ProviderError(400, "The model server on this computer answered 400: the request exceeds the available context size", "", HOST.label, false),
      )
      .mockResolvedValueOnce(answer("Both notes agree [[n1]] [[n2]]."));
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce(note("n1", "x".repeat(5000)))
      .mockResolvedValueOnce(note("n2", "y".repeat(5000)));
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool } as never });
    expect(r.text).toBe("Both notes agree [[n1]] [[n2]].");
    expect(r.trail.at(-1)?.summary).toBe("the model's context window was full — shortened 1 earlier tool result and asked again");
    const sent = (streamChat.mock.calls[3][0] as { messages: ChatMessage[] }).messages.filter((m) => m.role === "tool");
    // The earlier result is shortened to what it found; the latest is whole.
    expect(JSON.parse(sent[0].content)).toEqual({
      shortened: "This earlier result was shortened to fit the model's context window. Call the tool again if you need its details.",
      summary: 'read "n1"',
      documents: [{ documentId: "n1", title: "Note n1", documentType: "bai/knowledge-note" }],
    });
    expect(sent[1].content).toContain("y".repeat(5000));
    // The trail keeps everything, so citations and evidence are unaffected.
    expect((r.trail[0].data as { content: string }).content).toHaveLength(5000);
  });

  it("shortens before sending when a conversation passes the ceiling, whatever the model", async () => {
    const huge = "z".repeat(Math.ceil(CONTEXT_CEILING_TOKENS * 3.5) + 1000);
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(wantsTool("big"))
      .mockResolvedValueOnce(answer("Done [[big]]."));
    const executeTool = vi.fn().mockResolvedValueOnce(note("big", huge));
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool } as never });
    expect(r.text).toBe("Done [[big]].");
    const sent = (streamChat.mock.calls[1][0] as { messages: ChatMessage[] }).messages.find((m) => m.role === "tool")!;
    expect(sent.content.length).toBeLessThan(LAST_RESULT_MAX_CHARS + 400);
    expect((JSON.parse(sent.content) as { truncated: string }).truncated).toMatch(/^Only the first 24000 of \d+ characters of this result fit/);
    expect(r.trail.filter((e) => e.tool === "compat").map((e) => e.summary)).toEqual([
      "the conversation passed the size any answer is allowed — shortened 0 earlier tool results and asked again",
      "the conversation passed the size any answer is allowed — shortened 1 earlier tool result and asked again",
    ]);
  });
});

describe("fitTranscript", () => {
  const entry = (summary: string, id: string): TrailEntry => ({
    tool: "read_note",
    summary,
    ok: true,
    data: { documentId: id, title: `T ${id}` },
  });
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
    { role: "assistant", content: "", tool_calls: [tc("read_note", "{}", "a")] },
    { role: "tool", tool_call_id: "a", content: "A".repeat(100) },
    { role: "assistant", content: "", tool_calls: [tc("read_note", "{}", "b"), tc("read_note", "{}", "c")] },
    { role: "tool", tool_call_id: "b", content: "B".repeat(100) },
    { role: "tool", tool_call_id: "c", content: "C".repeat(30_000) },
  ];
  const results = new Map([
    ["a", { round: 1, entry: entry('read "a"', "a") }],
    ["b", { round: 2, entry: entry('read "b"', "b") }],
    ["c", { round: 2, entry: entry('read "c"', "c") }],
  ]);
  const contents = (level: 0 | 1 | 2) => fitTranscript(messages, results, level).map((m) => m.content.slice(0, 14));

  it("leaves the conversation as it is at level 0", () => {
    expect(fitTranscript(messages, results, 0)).toEqual(messages);
  });

  it("at level 1 shortens every round's results but the latest", () => {
    expect(contents(1)).toEqual(["sys", "q", "", '{"shortened":"', "", "BBBBBBBBBBBBBB", "CCCCCCCCCCCCCC"]);
  });

  it("at level 2 keeps only the last result, cut to size", () => {
    const fitted = fitTranscript(messages, results, 2);
    expect(contents(2).slice(3)).toEqual(['{"shortened":"', "", '{"shortened":"', '{"truncated":"']);
    expect((JSON.parse(fitted[6].content) as { partial: string }).partial).toHaveLength(LAST_RESULT_MAX_CHARS);
    // System, question and the model's own turns are never touched.
    expect(fitted.slice(0, 3)).toEqual(messages.slice(0, 3));
  });

  it("keeps the documents a shortened result named, so they stay citable", () => {
    expect(JSON.parse(shortenedResult({ summary: "s", data: { hits: [{ documentId: "x", title: "X" }, { documentId: "y", title: "Y", documentType: "bai/moc" }] } }))).toMatchObject({
      documents: [
        { documentId: "x", title: "X" },
        { documentId: "y", title: "Y", documentType: "bai/moc" },
      ],
    });
  });
});
