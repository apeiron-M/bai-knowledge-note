import "../../shared/test/browser-globals.js";
import { describe, expect, it, vi } from "vitest";
import {
  asksForDocuments,
  consultedDocuments,
  documentsRead,
  needsSubstance,
  pointsInsteadOfAnswering,
  runAgentLoop,
  type TrailEntry,
} from "./use-chat.js";
import type { ChatMessage } from "../lib/chat/completions-client.js";
import { endpointFor } from "../lib/chat/provider.js";

const HOST = endpointFor({ kind: "host", baseUrl: "http://127.0.0.1:4202/llm/v1", model: "m", label: "the app's model", headers: {} })!;
const base = { endpoint: HOST, model: "m", driveId: "d" };
const answer = (text: string) => ({ text, toolCalls: [], finishReason: "stop", model: null });
const search = (ids: string[], withText: string[] = []): TrailEntry => ({
  tool: "search_vault",
  summary: `searched → ${ids.length} notes`,
  ok: true,
  data: {
    hits: ids.map((id) => ({
      documentId: id,
      title: `Title ${id}`,
      documentType: "bai/knowledge-note",
      ...(withText.includes(id) ? { content: `Body ${id}` } : {}),
    })),
  },
});

/** What the chat answered you: a reading list, taken from the conversation. */
const READING_LIST = [
  "**Start with the core concepts.**",
  "Reading that note will show you the order in which engineers approach the problem [[n1]].",
  "From there you can drill into the concrete patterns and observations: the note “Kernel implementation is a material lever for inference performance” explains how low‑level GPU kernels drive throughput [[n2]].",
  "Follow the notes in the order above [[n3]].",
].join("\n");

describe("telling a reading list from an answer", () => {
  it("catches the wording that points instead of answering", () => {
    expect(pointsInsteadOfAnswering(READING_LIST)).toBe(true);
    expect(
      pointsInsteadOfAnswering(
        "Batching lets requests advance together token by token, which raises throughput but not every user's latency [[a]]. Read throughput rises too.",
      ),
    ).toBe(false);
  });

  it("knows when the person did ask which notes to read", () => {
    expect(asksForDocuments("Which notes should I read about batching?")).toBe(true);
    expect(asksForDocuments("List the notes on quantization")).toBe(true);
    expect(asksForDocuments("If I want to learn about inference engineering, where should I start?")).toBe(false);
  });

  it("sends back an answer that leans on notes it never read, not one built on what it read", () => {
    const trail = [search(["n1", "n2", "n3", "n4"], ["n1"])];
    const leaning = "Batching helps [[n2]]. Caching helps [[n3]]. Quantization helps [[n4]]. Kernels matter [[n1]].";
    expect(needsSubstance(leaning, trail, "q")?.unread.map((d) => d.documentId)).toEqual(["n2", "n3", "n4"]);
    const readTrail = [...trail, { tool: "read_notes", summary: "read 3", ok: true, data: { notes: [{ documentId: "n2" }, { documentId: "n3" }, { documentId: "n4" }] } }];
    expect(needsSubstance(leaning, readTrail, "q")).toBeNull();
  });

  it("counts what search handed over with its text as read, and what was read in full as consulted", () => {
    const trail: TrailEntry[] = [
      search(["n1", "n2"], ["n1"]),
      { tool: "read_notes", summary: "read 1", ok: true, data: { notes: [{ documentId: "n5", title: "Five" }] } },
    ];
    expect([...documentsRead(trail)].sort()).toEqual(["n1", "n5"]);
    // Search bodies were handed over unasked: not listed as consulted.
    expect(consultedDocuments(trail, []).map((c) => c.documentId)).toEqual(["n5"]);
  });
});

describe("the chat reads for the model", () => {
  it("reads the unread notes a draft leans on itself, hands their text over, and asks for the answer from them", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [{ id: "c1", type: "function", function: { name: "search_vault", arguments: '{"query":"inference"}' } }], finishReason: "tool_calls", model: null })
      .mockResolvedValueOnce(answer(READING_LIST))
      .mockResolvedValueOnce(answer("Kernels are a real lever: better kernels raise throughput and cut latency [[n2]]."));
    const executeTool = vi.fn((name: string, args: Record<string, unknown>) =>
      Promise.resolve(
        name === "search_vault"
          ? { ok: true, summary: "searched", data: search(["n1", "n2", "n3"]).data }
          : { ok: true, summary: `read ${(args.documentIds as string[]).length} notes`, data: { notes: (args.documentIds as string[]).map((id) => ({ documentId: id, title: `Title ${id}`, content: `Body ${id}` })) } },
      ),
    );
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "Where should I start with inference?" }], deps: { streamChat, executeTool } as never });
    expect(r.text).toBe("Kernels are a real lever: better kernels raise throughput and cut latency [[n2]].");
    // The loop read them — the model was not asked to.
    expect(executeTool).toHaveBeenLastCalledWith("read_notes", { documentIds: ["n1", "n2", "n3"] }, { driveId: "d" });
    expect(r.trail.map((e) => e.tool)).toEqual(["search_vault", "compat", "read_notes"]);
    expect(r.trail[1].summary).toBe("answer pointed to notes instead of answering — asked once to answer from them");
    const sent = (streamChat.mock.calls[2][0] as { messages: ChatMessage[] }).messages.slice(-3);
    expect(sent[0]).toMatchObject({ role: "assistant", tool_calls: [{ function: { name: "read_notes" } }] });
    expect(sent[1]).toMatchObject({ role: "tool" });
    expect(sent[1].content).toContain("Body n2");
    expect(sent[2].role).toBe("system");
    expect(sent[2].content).toContain("their full text is in the read_notes result just above");
    expect(sent[2].content).toContain(`Your draft was:\n---\n${READING_LIST}\n---`);
  });

  it("sends it back once more only while it still points, and never a third time", async () => {
    const streamChat = vi.fn().mockResolvedValue(answer(READING_LIST));
    const executeTool = vi.fn().mockResolvedValue({ ok: true, summary: "read", data: { notes: [] } });
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "Where should I start?" }], deps: { streamChat, executeTool } as never });
    expect(r.trail.filter((e) => e.tool === "compat" && /pointed/.test(e.summary))).toHaveLength(2);
    expect(streamChat).toHaveBeenCalledTimes(3);
    expect(r.text).toBe(READING_LIST);
  });

  it("leaves a list alone when the person asked for one", async () => {
    const streamChat = vi.fn().mockResolvedValue(answer(READING_LIST));
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "Which notes should I read first?" }], deps: { streamChat, executeTool: vi.fn() } as never });
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(r.text).toBe(READING_LIST);
  });

  it("asks a follow-up written from the conversation to cite what the conversation cited", async () => {
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(answer("Step one: understand why serving strategy is a product decision."))
      .mockResolvedValueOnce(answer("Step one: serving strategy is a product decision [[n11]]."));
    const r = await runAgentLoop({
      ...base,
      messages: [{ role: "user", content: "Make that a plan" }],
      priorCitations: [{ documentId: "n11", title: "Inference strategy is part of competitive AI product design", documentType: "bai/knowledge-note" }],
      deps: { streamChat, executeTool: vi.fn() } as never,
    });
    expect(r.text).toBe("Step one: serving strategy is a product decision [[n11]].");
    const nudge = (streamChat.mock.calls[1][0] as { messages: ChatMessage[] }).messages.at(-1)!;
    expect(nudge.content).toContain("- [[n11]] Inference strategy is part of competitive AI product design (bai/knowledge-note)");
  });
});
