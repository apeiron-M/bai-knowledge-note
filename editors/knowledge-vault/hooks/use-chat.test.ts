import "../../shared/test/browser-globals.js";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ITERATIONS,
  extractCitations,
  runAgentLoop,
  type TrailEntry,
} from "./use-chat.js";

const tc = (name: string, args: string, id = "c1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});
const base = { key: "k", model: "m", driveId: "d" };

describe("runAgentLoop", () => {
  it("returns a plain answer when the model asks for no tools", async () => {
    const streamChat = vi.fn().mockResolvedValue({
      text: "Hi there",
      toolCalls: [],
      finishReason: "stop",
    });
    const executeTool = vi.fn();
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "hi" }],
      deps: { streamChat, executeTool } as never,
    });
    expect(r.text).toBe("Hi there");
    expect(r.trail).toEqual([]);
    expect(r.iterations).toBe(1);
    expect(executeTool).not.toHaveBeenCalled();
    // Tools are always offered so the model can choose.
    expect(
      (streamChat.mock.calls[0][0] as { tools: unknown[] }).tools.length,
    ).toBe(9);
  });

  it("executes a tool call and feeds the result back keyed to the call id", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [tc("search_vault", '{"query":"x"}')],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        text: "Final answer",
        toolCalls: [],
        finishReason: "stop",
      });
    const executeTool = vi.fn().mockResolvedValue({
      ok: true,
      data: [{ documentId: "n1" }],
      summary: 'searched "x" → 1 note',
    });
    const trail: TrailEntry[] = [];

    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "hi" }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool } as never,
    });

    expect(r.text).toBe("Final answer");
    expect(r.iterations).toBe(2);
    expect(executeTool).toHaveBeenCalledWith(
      "search_vault",
      { query: "x" },
      { driveId: "d" },
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      tool: "search_vault",
      ok: true,
      summary: 'searched "x" → 1 note',
    });

    const second = streamChat.mock.calls[1][0] as {
      messages: {
        role: string;
        tool_call_id?: string;
        tool_calls?: unknown[];
        content: string;
      }[];
    };
    const assistant = second.messages.find(
      (m) => m.role === "assistant" && m.tool_calls,
    );
    expect(assistant?.tool_calls).toHaveLength(1);
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("c1");
    expect(JSON.parse(toolMsg!.content)).toEqual([{ documentId: "n1" }]);
  });

  it("runs parallel tool calls and returns one tool message per call", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [tc("vault_stats", "{}", "a"), tc("list_topics", "{}", "b")],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        text: "done",
        toolCalls: [],
        finishReason: "stop",
      });
    const executeTool = vi
      .fn()
      .mockResolvedValue({ ok: true, data: {}, summary: "s" });
    const r = await runAgentLoop({
      ...base,
      messages: [],
      deps: { streamChat, executeTool } as never,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    const second = streamChat.mock.calls[1][0] as {
      messages: { role: string; tool_call_id?: string }[];
    };
    expect(
      second.messages
        .filter((m) => m.role === "tool")
        .map((m) => m.tool_call_id),
    ).toEqual(["a", "b"]);
    expect(r.trail).toHaveLength(2);
  });

  it("keeps going when a tool fails, recording the failure for the model and the trail", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [tc("search_vault", '{"query":"x"}')],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        text: "Recovered",
        toolCalls: [],
        finishReason: "stop",
      });
    const executeTool = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "network down" });

    const r = await runAgentLoop({
      ...base,
      messages: [],
      deps: { streamChat, executeTool } as never,
    });
    expect(r.text).toBe("Recovered");
    expect(r.trail[0].ok).toBe(false);
    const toolMsg = (
      streamChat.mock.calls[1][0] as {
        messages: { role: string; content: string }[];
      }
    ).messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("network down");
  });

  it("treats malformed tool arguments as a tool failure, not a crash", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [tc("search_vault", "{not json")],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
      });
    const executeTool = vi.fn();

    const r = await runAgentLoop({
      ...base,
      messages: [],
      deps: { streamChat, executeTool } as never,
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(r.trail[0].ok).toBe(false);
    expect(r.text).toBe("ok");
  });

  it("caps runaway loops and forces a final answer with tools disabled", async () => {
    const streamChat = vi
      .fn()
      .mockImplementation((o: { toolChoice?: string }) =>
        o.toolChoice === "none"
          ? Promise.resolve({
              text: "Forced",
              toolCalls: [],
              finishReason: "stop",
            })
          : Promise.resolve({
              text: "",
              toolCalls: [tc("vault_stats", "{}")],
              finishReason: "tool_calls",
            }),
      );
    const executeTool = vi
      .fn()
      .mockResolvedValue({ ok: true, data: {}, summary: "stats" });

    const r = await runAgentLoop({
      ...base,
      messages: [],
      deps: { streamChat, executeTool } as never,
    });

    expect(r.iterations).toBe(MAX_ITERATIONS + 1);
    expect(executeTool).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(r.text).toBe("Forced");
    expect(
      (streamChat.mock.calls.at(-1)![0] as { toolChoice?: string }).toolChoice,
    ).toBe("none");
  });

  it("forwards text deltas and the abort signal", async () => {
    const seen: string[] = [];
    const ctrl = new AbortController();
    const streamChat = vi
      .fn()
      .mockImplementation(
        (o: { onText?: (d: string) => void; signal?: AbortSignal }) => {
          o.onText?.("a");
          o.onText?.("b");
          expect(o.signal).toBe(ctrl.signal);
          return Promise.resolve({
            text: "ab",
            toolCalls: [],
            finishReason: "stop",
          });
        },
      );
    await runAgentLoop({
      ...base,
      messages: [],
      onText: (d) => seen.push(d),
      signal: ctrl.signal,
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("runAgentLoop routing", () => {
  it("forwards fallback models to every request", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValue({
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
        model: "a/one",
      });
    await runAgentLoop({
      ...base,
      model: "a/one",
      fallbackModels: ["b/two", "c/three"],
      messages: [],
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(
      (streamChat.mock.calls[0][0] as { fallbackModels?: string[] })
        .fallbackModels,
    ).toEqual(["b/two", "c/three"]);
  });

  it("records a router trail entry when a fallback answered, naming both models", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValue({
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
        model: "b/two",
      });
    const names: Record<string, string> = { "a/one": "One", "b/two": "Two" };
    const r = await runAgentLoop({
      ...base,
      model: "a/one",
      fallbackModels: ["b/two"],
      messages: [],
      modelName: (id) => names[id] ?? id,
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(r.answeredBy).toBe("b/two");
    expect(r.trail).toHaveLength(1);
    expect(r.trail[0]).toMatchObject({ tool: "router", ok: true });
    expect(r.trail[0].summary).toContain("Two");
    expect(r.trail[0].summary).toContain("One");
  });

  it("adds no router entry when the requested model answered", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValue({
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
        model: "a/one",
      });
    const r = await runAgentLoop({
      ...base,
      model: "a/one",
      fallbackModels: ["b/two"],
      messages: [],
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(r.answeredBy).toBe("a/one");
    expect(r.trail).toEqual([]);
  });
});

describe("extractCitations", () => {
  const trail: TrailEntry[] = [
    {
      tool: "search_vault",
      summary: "s",
      ok: true,
      data: [
        { documentId: "n1", title: "First" },
        { documentId: "n2", title: "Second" },
      ],
    },
    {
      tool: "read_note",
      summary: "r",
      ok: true,
      data: { documentId: "n3", title: "Third", content: "..." },
    },
    {
      tool: "linked_notes",
      summary: "l",
      ok: true,
      data: { outgoing: [{ documentId: "n4", title: "Fourth" }], incoming: [] },
    },
    { tool: "vault_stats", summary: "v", ok: false },
  ];

  it("resolves [[documentId]] markers to titles seen in the trail, in order of first mention, deduplicated", () => {
    const c = extractCitations(
      "Because [[n3]] and [[n1]]; again [[n3]].",
      trail,
    );
    expect(c).toEqual([
      { documentId: "n3", title: "Third" },
      { documentId: "n1", title: "First" },
    ]);
  });

  it("finds ids nested inside tool result objects", () => {
    expect(extractCitations("[[n4]]", trail)).toEqual([
      { documentId: "n4", title: "Fourth" },
    ]);
  });

  it("keeps an unknown id with a fallback title rather than dropping the citation", () => {
    expect(extractCitations("[[zzz]]", trail)).toEqual([
      { documentId: "zzz", title: "zzz" },
    ]);
  });

  it("returns an empty list when nothing is cited", () => {
    expect(extractCitations("no citations here", trail)).toEqual([]);
  });
});
