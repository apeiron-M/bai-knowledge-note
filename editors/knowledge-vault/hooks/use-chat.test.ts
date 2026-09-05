import "../../shared/test/browser-globals.js";
import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_NOW,
  CHECK_NOW,
  MAX_ITERATIONS,
  NO_OUTAGE,
  TOOL_TEXT_RETRY,
  answeredWithoutLooking,
  claimsAnOutageThatDidNotHappen,
  consultedDocuments,
  extractCitations,
  needsCitationRepair,
  resolveCitations,
  runAgentLoop,
  type TrailEntry,
} from "./use-chat.js";
import { endpointFor } from "../lib/chat/provider.js";

const tc = (name: string, args: string, id = "c1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});
const ENDPOINT = endpointFor({ kind: "openrouter", key: "k" })!;
const base = { endpoint: ENDPOINT, model: "m", driveId: "d" };

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
    // Tools are always offered so the model can choose: the vault's thirteen
    // plus search_web, ens_lookup and read_url.
    expect(
      (streamChat.mock.calls[0][0] as { tools: unknown[] }).tools.length,
    ).toBe(16);
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
    const last = streamChat.mock.calls.at(-1)![0] as {
      toolChoice?: string;
      messages: { role: string; content: string }[];
    };
    expect(last.toolChoice).toBe("none");
    // The model is told to answer, not just denied tools.
    expect(last.messages.at(-1)).toEqual({ role: "system", content: ANSWER_NOW });
  });

  it("runs tool calls a model wrote as text, and records that it had to", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({
        text:
          "<tool_call>read_note\n<arg_key>documentId</arg_key>\n<arg_value>n1</arg_value>\n</tool_call>",
        toolCalls: [],
        finishReason: "stop",
      })
      .mockResolvedValueOnce({ text: "Grounded answer [[n1]]", toolCalls: [], finishReason: "stop" });
    const executeTool = vi.fn().mockResolvedValue({
      ok: true,
      data: { documentId: "n1", title: "Note" },
      summary: 'read "Note"',
    });
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "q" }],
      deps: { streamChat, executeTool } as never,
    });
    expect(executeTool).toHaveBeenCalledWith("read_note", { documentId: "n1" }, { driveId: "d" });
    expect(r.text).toBe("Grounded answer [[n1]]");
    expect(r.trail.map((t) => t.tool)).toEqual(["compat", "read_note"]);
    expect(r.trail[0].summary).toContain("as text");
    // The transcript the model sees next carries structured calls, and the
    // template is gone from the assistant turn.
    const second = streamChat.mock.calls[1][0] as {
      messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[];
    };
    const assistant = second.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("");
    expect(assistant.tool_calls).toHaveLength(1);
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "text-1-1" });
  });

  it("clears the streamed text between rounds so a template never lingers", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [tc("vault_stats", "{}")], finishReason: "tool_calls" })
      .mockResolvedValueOnce({ text: "Done", toolCalls: [], finishReason: "stop" });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: {}, summary: "s" });
    const rounds: number[] = [];
    await runAgentLoop({
      ...base,
      messages: [],
      onRound: (n) => rounds.push(n),
      deps: { streamChat, executeTool } as never,
    });
    expect(rounds).toEqual([1, 2]);
  });

  it("gives a forced answer made only of tool-call text one retry, then says so honestly", async () => {
    const template = '<function_calls><invoke name="read_note"><parameter name="documentId">n9</parameter></invoke></function_calls>';
    const streamChat = vi.fn().mockImplementation((o: { toolChoice?: string }) =>
      o.toolChoice === "none"
        ? Promise.resolve({ text: template, toolCalls: [], finishReason: "stop" })
        : Promise.resolve({ text: "", toolCalls: [tc("vault_stats", "{}")], finishReason: "tool_calls" }),
    );
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: {}, summary: "stats" });
    const r = await runAgentLoop({ ...base, messages: [], deps: { streamChat, executeTool } as never });
    // Only the real rounds ran tools; the text call in the forced answer did not.
    expect(executeTool).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(r.iterations).toBe(MAX_ITERATIONS + 2);
    expect(r.text).toContain("kept trying to read");
    expect(r.trail.at(-1)).toMatchObject({ tool: "compat", ok: false });
    const retry = streamChat.mock.calls.at(-1)![0] as { messages: { role: string; content: string }[] };
    expect(retry.messages.at(-1)!.content).toContain("written as text");
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

describe("runAgentLoop unreadable tool markup", () => {
  const round = (text: string) => ({ text, toolCalls: [], finishReason: "stop" });
  const junk = "Let me look.\n<tool_call>\n<weird>read_note</weird>\n</tool_call>";

  it("asks once for a runnable form, then runs what comes back", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round(junk))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [tc("vault_stats", "{}")],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce(round("The vault holds 521 notes."));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: { noteCount: 521 }, summary: "vault: 521 notes" });
    const trail: TrailEntry[] = [];
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "how big?" }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool } as never,
    });
    expect(r.text).toBe("The vault holds 521 notes.");
    // The loop hands every round the same messages array, so look for the
    // nudge where it was inserted rather than at the end.
    const sent = (streamChat.mock.calls[1][0] as { messages: { role: string; content: string }[] }).messages;
    const nudge = sent.findIndex((m) => m.role === "system" && m.content === TOOL_TEXT_RETRY);
    expect(nudge).toBeGreaterThan(0);
    expect(sent[nudge].content).toContain('<tool_call>{"name": "<tool>"');
    expect(sent[nudge - 1]).toEqual({ role: "assistant", content: junk });
    expect(trail.map((e) => e.tool)).toEqual(["compat", "vault_stats"]);
    expect(trail[0].summary).toContain("runnable form");
  });

  it("strips the markup from the answer when the model does it again, and says so in the trail", async () => {
    const streamChat = vi.fn().mockResolvedValueOnce(round(junk)).mockResolvedValueOnce(round(`${junk}\nSo: 42.`));
    const trail: TrailEntry[] = [];
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "q" }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(r.text).toBe("Let me look.\n\nSo: 42.");
    expect(trail.map((e) => [e.tool, e.ok])).toEqual([["compat", true], ["compat", false]]);
  });

  it("runs Qwen-style text calls directly, with no nudge", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("<tool_call>\n<function=vault_stats>\n</function>\n</tool_call>"))
      .mockResolvedValueOnce(round("521 notes."));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: { noteCount: 521 }, summary: "vault: 521 notes" });
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "q" }], deps: { streamChat, executeTool } as never });
    expect(executeTool).toHaveBeenCalledWith("vault_stats", {}, { driveId: "d" });
    expect(r.text).toBe("521 notes.");
    expect(r.trail.map((e) => e.tool)).toEqual(["compat", "vault_stats"]);
  });
});

describe("runAgentLoop false outage", () => {
  const round = (text: string, toolCalls: unknown[] = []) => ({
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  });

  it("asks once when an answer blames the vault though nothing failed", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("I cannot access the vault right now — the tool for listing projects is not responding."))
      .mockResolvedValueOnce(round("", [tc("list_projects", "{}")]))
      .mockResolvedValueOnce(round("There is one project: Powerhouse PMF [[s1]]."));
    const executeTool = vi.fn().mockResolvedValue({
      ok: true,
      data: { projects: [{ documentId: "s1", title: "Powerhouse PMF" }] },
      summary: "listed 1 envelope across 1 scope",
    });
    const trail: TrailEntry[] = [];
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "What projects are there?" }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool } as never,
    });
    expect(r.text).toContain("Powerhouse PMF");
    const sent = (streamChat.mock.calls[1][0] as { messages: { role: string; content: string }[] }).messages;
    expect(sent.some((m) => m.role === "system" && m.content === NO_OUTAGE)).toBe(true);
    expect(trail[0].summary).toContain("reported the vault as unreachable");
  });

  it("leaves the answer alone when a tool really did fail", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("list_projects", "{}")]))
      .mockResolvedValueOnce(round("I could not retrieve the projects: the reactor answered 502."));
    const executeTool = vi.fn().mockResolvedValue({ ok: false, error: "HTTP 502 from the reactor" });
    const streams = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "What projects are there?" }],
      deps: { streamChat, executeTool } as never,
    });
    // Two rounds, not three: the claim was true, so nothing was asked again.
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(streams.text).toContain("502");
  });

  it("claimsAnOutageThatDidNotHappen recognises the phrasings models use", () => {
    const clean: TrailEntry[] = [{ tool: "list_projects", summary: "ok", ok: true, data: {} }];
    const failed: TrailEntry[] = [{ tool: "list_projects", summary: "boom", ok: false, error: "HTTP 500" }];
    for (const claim of [
      "The vault is currently inaccessible.",
      "I cannot access the vault right now.",
      "the tool for listing projects is not responding",
      "This appears to be a temporary outage.",
      "I am unable to retrieve Scope of Work documents.",
    ]) {
      expect(claimsAnOutageThatDidNotHappen(claim, clean)).toBe(true);
      // The same words are fair once something actually failed.
      expect(claimsAnOutageThatDidNotHappen(claim, failed)).toBe(false);
    }
    expect(claimsAnOutageThatDidNotHappen("The vault holds 505 notes.", clean)).toBe(false);
    // A document that is genuinely absent is not an outage claim.
    expect(claimsAnOutageThatDidNotHappen("The vault has no note about Docling.", clean)).toBe(false);
  });
});

describe("runAgentLoop freshness", () => {
  const round = (text: string, toolCalls: unknown[] = []) => ({
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  });
  const ASKED = "What was the last change in the vault, and by who?";

  it("asks once when a question about now is answered without looking", async () => {
    const streamChat = vi
      .fn()
      // The model repeats an earlier answer from the transcript.
      .mockResolvedValueOnce(round("The last change was on 2026-09-04 by 0xadbA…BcA4."))
      .mockResolvedValueOnce(round("", [tc("recent_changes", "{}")]))
      .mockResolvedValueOnce(round("The last change was today at 14:03 by liberuum.eth [[s1]]."));
    const executeTool = vi.fn().mockResolvedValue({
      ok: true,
      data: { items: [{ documentId: "s1", title: "Powerhouse PMF", change: "Deliverable progress updated" }] },
      summary: "listed the 1 most recently edited document",
    });
    const trail: TrailEntry[] = [];
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: ASKED }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool } as never,
    });
    expect(r.text).toContain("14:03");
    const sent = (streamChat.mock.calls[1][0] as { messages: { role: string; content: string }[] }).messages;
    expect(sent.some((m) => m.role === "system" && m.content === CHECK_NOW)).toBe(true);
    expect(trail[0]).toMatchObject({ tool: "compat", ok: true });
    expect(trail[0].summary).toContain("without checking the vault");
  });

  it("does not nudge when the turn did consult the vault, nor for a question that is not about now", async () => {
    const answered = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("search_vault", '{"query":"x"}')]))
      .mockResolvedValueOnce(round("Here is what the vault says [[n1]]."));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: [{ documentId: "n1", title: "A note" }], summary: "searched" });
    const consulted = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: ASKED }],
      deps: { streamChat: answered, executeTool } as never,
    });
    expect(answered).toHaveBeenCalledTimes(2);
    expect(consulted.text).toContain("Here is what the vault says");

    const chatty = vi.fn().mockResolvedValueOnce(round("I can search notes, read documents and follow links."));
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "What can you do?" }],
      deps: { streamChat: chatty, executeTool: vi.fn() } as never,
    });
    expect(chatty).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("I can search notes");
  });

  it("answeredWithoutLooking fires only on a present-tense question with no tool of substance", () => {
    const searched: TrailEntry[] = [{ tool: "recent_changes", summary: "s", ok: true, data: {} }];
    const onlyHarness: TrailEntry[] = [{ tool: "compat", summary: "c", ok: true }];
    expect(answeredWithoutLooking("what changed last?", [])).toBe(true);
    expect(answeredWithoutLooking("who is working on the vault?", onlyHarness)).toBe(true);
    expect(answeredWithoutLooking("what changed last?", searched)).toBe(false);
    expect(answeredWithoutLooking("explain event sourcing", [])).toBe(false);
    expect(answeredWithoutLooking("thanks!", [])).toBe(false);
  });
});

describe("runAgentLoop citation repair", () => {
  const readNote = {
    ok: true,
    data: { documentId: "n1", title: "Operation store", documentType: "bai/knowledge-note", content: "…" },
    summary: 'read "Operation store"',
  };
  const round = (text: string, toolCalls: unknown[] = []) => ({
    text,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  });

  it("asks once for a cited rewrite when an answer built on tool reads cites nothing", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("read_note", '{"documentId":"n1"}')]))
      .mockResolvedValueOnce(round("The reactor stores operations in PGlite."))
      .mockResolvedValueOnce(round("The reactor stores operations in PGlite [[n1]]."));
    const executeTool = vi.fn().mockResolvedValue(readNote);
    const trail: TrailEntry[] = [];

    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "where are operations stored?" }],
      onTrail: (e) => trail.push(e),
      deps: { streamChat, executeTool } as never,
    });

    expect(r.text).toBe("The reactor stores operations in PGlite [[n1]].");
    expect(r.iterations).toBe(3);
    expect(streamChat).toHaveBeenCalledTimes(3);
    // The repair round only rewrites: no tools, and the ids spelled out.
    const repair = streamChat.mock.calls[2][0] as {
      toolChoice: string;
      messages: { role: string; content: string }[];
    };
    expect(repair.toolChoice).toBe("none");
    expect(repair.messages.at(-2)).toEqual({
      role: "assistant",
      content: "The reactor stores operations in PGlite.",
    });
    expect(repair.messages.at(-1)?.role).toBe("system");
    expect(repair.messages.at(-1)?.content).toContain("cites none of them");
    expect(repair.messages.at(-1)?.content).toContain("- [[n1]] Operation store (bai/knowledge-note)");
    // The intervention is visible in the trail, like every other harness move.
    expect(trail.map((e) => e.tool)).toEqual(["read_note", "compat"]);
    expect(trail[1]).toMatchObject({ ok: true, data: { documents: 1 } });
    expect(trail[1].summary).toContain("cited rewrite");
  });

  it("leaves an answer that already cites what it read alone", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("read_note", '{"documentId":"n1"}')]))
      .mockResolvedValueOnce(round("Operations live in PGlite [[n1]]."));
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "q" }],
      deps: { streamChat, executeTool: vi.fn().mockResolvedValue(readNote) } as never,
    });
    expect(r.text).toBe("Operations live in PGlite [[n1]].");
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(r.trail.map((e) => e.tool)).toEqual(["read_note"]);
  });

  it("does not ask when no tool surfaced a document to cite", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("vault_stats", "{}")]))
      .mockResolvedValueOnce(round("The vault holds 521 notes."));
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "how big?" }],
      deps: {
        streamChat,
        executeTool: vi.fn().mockResolvedValue({ ok: true, data: { noteCount: 521 }, summary: "vault: 521 notes" }),
      } as never,
    });
    expect(r.text).toBe("The vault holds 521 notes.");
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("asks only once, and keeps the uncited draft when the rewrite comes back empty", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(round("", [tc("read_note", '{"documentId":"n1"}')]))
      .mockResolvedValueOnce(round("Uncited but useful."))
      .mockResolvedValueOnce(round(""));
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "q" }],
      deps: { streamChat, executeTool: vi.fn().mockResolvedValue(readNote) } as never,
    });
    expect(r.text).toBe("Uncited but useful.");
    expect(streamChat).toHaveBeenCalledTimes(3);
  });

  it("needsCitationRepair recognises bracketed titles and Sources sections as citations", () => {
    const trail: TrailEntry[] = [{ tool: "read_note", ok: true, summary: "", data: readNote.data }];
    expect(needsCitationRepair("Plain prose.", trail)).toBe(true);
    expect(needsCitationRepair("Prose [[n1]].", trail)).toBe(false);
    expect(needsCitationRepair("Prose [Operation store].", trail)).toBe(false);
    expect(needsCitationRepair("Prose.\n\nSources:\n- Operation store", trail)).toBe(false);
    expect(needsCitationRepair("", trail)).toBe(false);
    expect(needsCitationRepair("Plain prose.", [])).toBe(false);
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

describe("extractCitations / resolveCitations", () => {
  const P1 = "8360bb12-3c20-4a31-88cf-7258d957c24b";
  const N1 = "cd5a7a91-a92d-48cd-874c-87d1c180703f";
  const trail: TrailEntry[] = [
    {
      tool: "search_vault",
      summary: "s",
      ok: true,
      data: [
        { documentId: "n1", title: "First", documentType: "bai/knowledge-note" },
        { documentId: "n2", title: "Second", documentType: "bai/moc" },
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
    {
      tool: "list_projects",
      summary: "p",
      ok: true,
      data: {
        total: 2,
        projects: [
          { documentId: P1, title: "Auth Scope Enforcement", documentType: "powerhouse/scopeofwork", wbs: { documentId: "w1", documentType: "bai/wbs" } },
          { documentId: "p2", title: "Paperless × Powerhouse demo", documentType: "powerhouse/scopeofwork" },
        ],
      },
    },
    { tool: "vault_stats", summary: "v", ok: false },
  ];

  it("resolves [[documentId]] markers to titles seen in the trail, in order of first mention, deduplicated", () => {
    const c = extractCitations(
      "Because [[n3]] and [[n1]]; again [[n3]].",
      trail,
    );
    expect(c).toEqual([
      { documentId: "n3", title: "Third", documentType: null },
      { documentId: "n1", title: "First", documentType: "bai/knowledge-note" },
    ]);
  });

  it("finds ids nested inside tool result objects and keeps their kind", () => {
    expect(extractCitations("[[n4]] [[n2]]", trail)).toEqual([
      { documentId: "n4", title: "Fourth", documentType: null },
      { documentId: "n2", title: "Second", documentType: "bai/moc" },
    ]);
  });

  it("cites projects exactly like notes — any document with a documentId", () => {
    expect(extractCitations(`The project [[${P1}]] is active.`, trail)).toEqual([
      { documentId: P1, title: "Auth Scope Enforcement", documentType: "powerhouse/scopeofwork" },
    ]);
  });

  it("resolves an anchored marker to its document and keeps the item id on the rewritten marker", () => {
    const r = resolveCitations(`PPD is half delivered [[${P1}#e1]]; the goal is blocked [[n3#g2]]. Plain [[${P1}]].`, trail);
    // One citation per document; the anchors ride on the markers, not the list.
    // n3 is not a UUID but a document the trail surfaced, so it anchors too.
    expect(r.citations.map((c) => c.documentId)).toEqual([P1, "n3"]);
    expect(r.text).toBe(`PPD is half delivered [[${P1}#e1]]; the goal is blocked [[n3#g2]]. Plain [[${P1}]].`);
  });

  it("does not treat a hash inside a by-name label as an anchor", () => {
    const r = resolveCitations("[[C# notes]]", trail);
    expect(r.citations).toEqual([]);
    expect(r.text).toBe("");
  });

  it("resolves a by-name citation to the one document it names, and rewrites the marker", () => {
    const r = resolveCitations("See [[AuthScope]] and [[Paperless × Powerhouse demo]].", trail);
    expect(r.citations.map((c) => c.documentId)).toEqual([P1, "p2"]);
    expect(r.text).toBe(`See [[${P1}]] and [[p2]].`);
  });

  it("drops a label that names nothing, or more than one thing, instead of rendering a dead link", () => {
    const r = resolveCitations("[[zzz]] and [[Auth]] and [[Pa]] and [[First]]", trail);
    // "zzz" matches nothing; "Auth" is a prefix but too short to trust;
    // "Pa" is too short for anything; "First" is an exact title.
    expect(r.citations).toEqual([{ documentId: "n1", title: "First", documentType: "bai/knowledge-note" }]);
    expect(r.text).toBe(" and  and  and [[n1]]");
  });

  it("collapses a marker repeated back to back — '[[a]] [[a]]' is one citation, not a stutter", () => {
    const r = resolveCitations("Blocked by Apeiron [[n1]] [[n1]] [[n1]]. Also [[n2]] [[n1]].", trail);
    expect(r.text).toBe("Blocked by Apeiron [[n1]]. Also [[n2]] [[n1]].");
    expect(r.citations.map((c) => c.documentId)).toEqual(["n1", "n2"]);
  });

  it("drops a UUID no tool returned and no earlier turn cited — an id the model cannot know is invented", () => {
    const r = resolveCitations(`Real [[n1]] and invented [[${N1}]] and (${N1}).`, trail);
    expect(r.citations.map((c) => c.documentId)).toEqual(["n1"]);
    expect(r.text).toBe("Real [[n1]] and invented  and .");
    expect(r.dropped).toBe(2);
    // The same id cited in an earlier turn is known, and kept.
    const prior = [{ documentId: N1, title: "Known before", documentType: "bai/knowledge-note" }];
    expect(resolveCitations(`[[${N1}]]`, trail, prior).citations).toEqual(prior);
  });

  it("uses earlier turns' citations for titles and by-name resolution", () => {
    const prior = [{ documentId: N1, title: "Powerhouse trades consultancy for scalability", documentType: "bai/knowledge-note" }];
    const r = resolveCitations(`As before: [[${N1}]] and [[Powerhouse trades consultancy for scalability]]`, [], prior);
    expect(r.citations).toEqual([prior[0]]);
    expect(r.text).toBe(`As before: [[${N1}]] and [[${N1}]]`);
  });

  it("accepts the single-bracket form models drift to — a UUID or an exact title — and leaves other brackets alone", () => {
    const text =
      `Sessions live in a cookie [1], [${P1}]. Every op passes four gates [${N1}]. ` +
      `No hooks for authorization [linked_notes]. Mapped in the [Auth Scope Enforcement] project. ` +
      `See [the docs](https://example.com) and [[n1]].`;
    // N1 is known from an earlier turn; an id nothing surfaced would be dropped.
    const r = resolveCitations(text, trail, [{ documentId: N1, title: "Four gates", documentType: "bai/knowledge-note" }]);
    expect(r.citations.map((c) => c.documentId)).toEqual([P1, N1, "n1"]);
    // The example.com link is unwrapped: no tool result produced that URL,
    // so it is the model's invention, not something the vault knows.
    expect(r.text).toBe(
      `Sessions live in a cookie [1], [[${P1}]]. Every op passes four gates [[${N1}]]. ` +
        `No hooks for authorization [linked_notes]. Mapped in the [[${P1}]] project. ` +
        `See the docs and [[n1]].`,
    );
  });

  it("treats a parenthesised UUID as a citation, and a bare one only when the document is known", () => {
    const r = resolveCitations(
      `No hooks exist (${N1}). Also ${P1} is active. Unknown id 11111111-2222-3333-4444-555555555555 stays.`,
      [...trail],
      [{ documentId: N1, title: "No hooks", documentType: "bai/knowledge-note" }],
    );
    expect(r.citations.map((c) => c.documentId)).toEqual([N1, P1]);
    // A bare unknown UUID is data being discussed, not a citation: untouched.
    expect(r.text).toBe(
      `No hooks exist [[${N1}]]. Also [[${P1}]] is active. Unknown id 11111111-2222-3333-4444-555555555555 stays.`,
    );
    expect(r.dropped).toBe(0);
  });

  it("does not let single brackets resolve by prefix — prose is not a citation", () => {
    const r = resolveCitations("The [AuthScope] work and [[AuthScope]] again", trail);
    expect(r.citations.map((c) => c.documentId)).toEqual([P1]);
    expect(r.text).toBe(`The [AuthScope] work and [[${P1}]] again`);
  });

  it("returns an empty list when nothing is cited", () => {
    expect(extractCitations("no citations here", trail)).toEqual([]);
  });
});

describe("groundMarkdownLinks (links the vault did not produce)", () => {
  const RBAC = "f1e2d3c4-0000-4000-8000-000000000001";
  const trail: TrailEntry[] = [
    {
      tool: "read_note",
      summary: "r",
      ok: true,
      data: {
        documentId: RBAC,
        title: "Reducer-level RBAC gates operations on action.context.signer.user.address so access control replicates with the document",
        documentType: "bai/knowledge-note",
        content: "See https://docs.powerhouse.io/recipes/rbac for the walkthrough.",
      },
    },
    {
      tool: "read_document",
      summary: "d",
      ok: true,
      data: { documentId: "p1", title: "Vault chat", documentType: "powerhouse/scopeofwork", deliverables: [{ url: "https://github.com/powerhouse/vault/pull/7" }] },
    },
  ];

  it("turns an invented link whose text names a known document into a citation, keeping the text", () => {
    const r = resolveCitations(
      "See the [Reducer-level RBAC gates operations](https://powerhouse.vault.io/moc/role-based-auth) for details.",
      trail,
    );
    expect(r.text).toBe(`See the Reducer-level RBAC gates operations [[${RBAC}]] for details.`);
    expect(r.citations.map((c) => c.documentId)).toEqual([RBAC]);
  });

  it("drops an invented URL whose text names nothing, leaving the text", () => {
    const r = resolveCitations("Read the [Role-Based Auth recipe](https://powerhouse.vault.io/recipe) now.", trail);
    expect(r.text).toBe("Read the Role-Based Auth recipe now.");
    expect(r.citations).toEqual([]);
  });

  it("keeps a link whose URL the vault itself produced, wherever it sat in the tool results", () => {
    const text =
      "Walkthrough: [rbac](https://docs.powerhouse.io/recipes/rbac). PR: [seven](https://github.com/powerhouse/vault/pull/7).";
    expect(resolveCitations(text, trail).text).toBe(text);
  });

  it("uses a UUID in the URL when the model linked to a document path", () => {
    const r = resolveCitations(`Open [the note](https://app.example/d/vault/${RBAC}).`, trail);
    expect(r.text).toBe(`Open the note [[${RBAC}]].`);
    expect(r.citations[0].documentId).toBe(RBAC);
  });

  it("leaves images alone", () => {
    const text = "![diagram](https://made.up/x.png)";
    expect(resolveCitations(text, trail).text).toBe(text);
  });
});

describe("foldSourcesSection (a model's own Sources list)", () => {
  const MOC = "719fa61f-2e0b-4309-84ab-1240dcfdfdb0";
  const trail: TrailEntry[] = [
    {
      tool: "search_vault",
      summary: "s",
      ok: true,
      data: [
        { documentId: MOC, title: "Authorization and Identity", documentType: "bai/moc" },
        { documentId: "n-renown", title: "Renown authentication creates a Decentralized Identifier (DID) from the user's Ethereum wallet, enabling pseudonymous but verifiable identity", documentType: "bai/knowledge-note" },
        { documentId: "n-sign", title: "Powerhouse uses header signing (document ID = cryptographic signature of creator) and action signing (every mutation signed with ECDSA P-256)", documentType: "bai/knowledge-note" },
      ],
    },
  ];

  it("turns the LFM-style trailing Sources list into chips and removes it from the text", () => {
    const text = [
      "Authorization is layered.",
      "",
      "Sources:",
      "",
      "Authorization and Identity (MOC) – Overview of decentralized identity",
      "Renown authentication (ARCHITECTURE) – Detailed login flow and verification process",
      "Powerhouse uses header signing (ARCHITECTURE) – Technical details of header and action signing",
    ].join("\n");
    const r = resolveCitations(text, trail);
    expect(r.text).toBe("Authorization is layered.");
    expect(r.citations.map((c) => c.documentId)).toEqual([MOC, "n-renown", "n-sign"]);
    expect(r.citations[0].documentType).toBe("bai/moc");
  });

  it("unwraps invented markdown links and accepts bullets, numbers and heading variants", () => {
    const text = [
      "Body [[n-sign]].",
      "## References",
      "1. [Authorization and Identity](https://light-colt.example/d/nowhere) — the map",
      "- **Renown authentication** – login flow",
    ].join("\n");
    const r = resolveCitations(text, trail);
    expect(r.text).toBe("Body [[n-sign]].");
    // Inline citation first, then the list, deduplicated against it.
    expect(r.citations.map((c) => c.documentId)).toEqual(["n-sign", MOC, "n-renown"]);
  });

  it("keeps the section in place when a line names nothing it knows, but still adds what it could resolve", () => {
    const text = "Body.\n\nSources:\n- Authorization and Identity\n- Some paper from outside the vault";
    const r = resolveCitations(text, trail);
    expect(r.text).toBe(text);
    expect(r.citations.map((c) => c.documentId)).toEqual([MOC]);
  });

  it("ignores a Sources heading that is not followed by a list, and ordinary prose", () => {
    expect(resolveCitations("Sources:\n", trail).text).toBe("Sources:\n");
    const prose = "The sources of truth are the reactor tables.";
    expect(resolveCitations(prose, trail)).toEqual({ text: prose, citations: [], dropped: 0 });
  });
});

describe("consultedDocuments", () => {
  const trail: TrailEntry[] = [
    { tool: "search_vault", summary: "s", ok: true, data: [{ documentId: "hit", title: "A hit", documentType: "bai/knowledge-note" }] },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n1", title: "Read one", documentType: "bai/knowledge-note", content: "…" } },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n2", title: "Read two", documentType: "bai/moc", content: "…" } },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n1", title: "Read one", content: "…" } },
    { tool: "read_document", summary: "d", ok: true, data: { documentId: "p1", title: "A project", documentType: "powerhouse/scopeofwork", text: "…" } },
    { tool: "read_note", summary: "x", ok: false, error: "gone" },
  ];

  it("lists documents read in full and not cited, once each, in read order", () => {
    expect(consultedDocuments(trail, [{ documentId: "n2", title: "Read two" }])).toEqual([
      { documentId: "n1", title: "Read one", documentType: "bai/knowledge-note" },
      { documentId: "p1", title: "A project", documentType: "powerhouse/scopeofwork" },
    ]);
  });

  it("does not count search hits the model merely saw", () => {
    expect(consultedDocuments(trail, []).map((c) => c.documentId)).not.toContain("hit");
  });

  it("is empty when everything read was cited", () => {
    const cited = ["n1", "n2", "p1"].map((id) => ({ documentId: id, title: id }));
    expect(consultedDocuments(trail, cited)).toEqual([]);
  });
});
