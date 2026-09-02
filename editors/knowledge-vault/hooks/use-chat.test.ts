import "../../shared/test/browser-globals.js";
import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_NOW,
  MAX_ITERATIONS,
  consultedDocuments,
  extractCitations,
  resolveCitations,
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
    ).toBe(10);
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
          { documentId: P1, title: "Auth Scope Enforcement", documentType: "bai/project", wbs: { documentId: "w1", documentType: "bai/wbs" } },
          { documentId: "p2", title: "Paperless × Powerhouse demo", documentType: "bai/project" },
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
      { documentId: P1, title: "Auth Scope Enforcement", documentType: "bai/project" },
    ]);
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

  it("keeps an unseen UUID with a fallback title — still a door the user can try", () => {
    expect(extractCitations(`[[${N1}]]`, trail)).toEqual([
      { documentId: N1, title: N1, documentType: null },
    ]);
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
    const r = resolveCitations(text, trail);
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
    expect(r.text).toBe(
      `No hooks exist [[${N1}]]. Also [[${P1}]] is active. Unknown id 11111111-2222-3333-4444-555555555555 stays.`,
    );
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
      data: { documentId: "p1", title: "Vault chat", documentType: "bai/project", deliverables: [{ url: "https://github.com/powerhouse/vault/pull/7" }] },
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
    expect(resolveCitations(prose, trail)).toEqual({ text: prose, citations: [] });
  });
});

describe("consultedDocuments", () => {
  const trail: TrailEntry[] = [
    { tool: "search_vault", summary: "s", ok: true, data: [{ documentId: "hit", title: "A hit", documentType: "bai/knowledge-note" }] },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n1", title: "Read one", documentType: "bai/knowledge-note", content: "…" } },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n2", title: "Read two", documentType: "bai/moc", content: "…" } },
    { tool: "read_note", summary: "r", ok: true, data: { documentId: "n1", title: "Read one", content: "…" } },
    { tool: "read_document", summary: "d", ok: true, data: { documentId: "p1", title: "A project", documentType: "bai/project", text: "…" } },
    { tool: "read_note", summary: "x", ok: false, error: "gone" },
  ];

  it("lists documents read in full and not cited, once each, in read order", () => {
    expect(consultedDocuments(trail, [{ documentId: "n2", title: "Read two" }])).toEqual([
      { documentId: "n1", title: "Read one", documentType: "bai/knowledge-note" },
      { documentId: "p1", title: "A project", documentType: "bai/project" },
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
