import { describe, expect, it } from "vitest";
import {
  hasToolCallMarkup,
  parseTextToolCalls,
  stripToolCallMarkup,
} from "./text-tool-calls.js";

const ID = "3086699a-f507-475b-8c3a-cac515a617d4";

describe("parseTextToolCalls", () => {
  it("leaves ordinary text alone", () => {
    const r = parseTextToolCalls("Authorization is layered [[x]].");
    expect(r).toEqual({ text: "Authorization is layered [[x]].", calls: [] });
  });

  it("parses the GLM arg_key/arg_value template, as seen on the vault", () => {
    const text =
      `<tool_call>read_note\n\n<arg_key>documentId</arg_key>\n\n<arg_value>${ID}</arg_value>\n\n</tool_call>\n\n` +
      `<tool_call>search_vault\n<arg_key>query</arg_key>\n<arg_value>auth policy</arg_value>\n<arg_key>limit</arg_key>\n<arg_value>5</arg_value>\n</tool_call>`;
    const r = parseTextToolCalls(text, "r1");
    expect(r.text).toBe("");
    expect(r.calls).toEqual([
      { id: "r1-1", type: "function", function: { name: "read_note", arguments: JSON.stringify({ documentId: ID }) } },
      { id: "r1-2", type: "function", function: { name: "search_vault", arguments: JSON.stringify({ query: "auth policy", limit: 5 }) } },
    ]);
  });

  it("parses the dots / Anthropic invoke-parameter template, as seen on the vault", () => {
    const text =
      `<dots_function_call>\n\n<invoke name="read_note">\n\n<parameter name="documentId">\n\n${ID}\n\n</parameter>\n\n</invoke>\n\n</dots_function_call>\n\n` +
      `<function_calls><invoke name="vault_stats"></invoke></function_calls>`;
    const r = parseTextToolCalls(text);
    expect(r.text).toBe("");
    expect(r.calls.map((c) => [c.function.name, c.function.arguments])).toEqual([
      ["read_note", JSON.stringify({ documentId: ID })],
      ["vault_stats", "{}"],
    ]);
  });

  it("parses Hermes/Qwen JSON, Llama <function=…> and Mistral [TOOL_CALLS] templates", () => {
    const text =
      `<tool_call>\n{"name": "read_note", "arguments": {"documentId": "${ID}"}}\n</tool_call>\n` +
      `<function=notes_by_topic>{"topic": "auth", "limit": 3}</function>\n` +
      `[TOOL_CALLS][{"name": "list_projects", "arguments": {}}, {"name": "read_document", "arguments": "{\\"documentId\\": \\"p1\\"}"}]\n`;
    const r = parseTextToolCalls(text);
    expect(r.text).toBe("");
    expect(r.calls.map((c) => [c.function.name, JSON.parse(c.function.arguments) as unknown])).toEqual([
      ["read_note", { documentId: ID }],
      ["notes_by_topic", { topic: "auth", limit: 3 }],
      ["list_projects", {}],
      ["read_document", { documentId: "p1" }],
    ]);
  });

  it("keeps the prose around the calls and collapses the gap they leave", () => {
    const r = parseTextToolCalls(
      `Let me check.\n\n<tool_call>vault_stats\n</tool_call>\n\n\n\nThen I will answer.`,
    );
    expect(r.text).toBe("Let me check.\n\nThen I will answer.");
    expect(r.calls.map((c) => c.function.name)).toEqual(["vault_stats"]);
  });

  it("does not mistake an unrelated tag or a bare bracket list for a call", () => {
    const r = parseTextToolCalls("Use <code>tool_call</code>; see [1], [2].");
    expect(r.calls).toEqual([]);
  });

  it("parses Qwen3's <function=…><parameter=…> template, wrapped in <tool_call> or bare, as seen from a local server", () => {
    const text =
      `Now let me read the most recent ones:\n\n` +
      `<tool_call>\n\n<function=read_note>\n\n<parameter=documentId>\n\n[[${ID}]]\n\n</parameter>\n\n</function>\n\n</tool_call>\n\n` +
      `<function=search_vault>\n<parameter=query>\nrecent changes\n</parameter>\n<parameter=limit>\n5\n</parameter>\n</function>\n` +
      `<tool_call><function=vault_stats></function></tool_call>`;
    const r = parseTextToolCalls(text, "q");
    expect(r.text).toBe("Now let me read the most recent ones:");
    expect(r.calls.map((c) => [c.function.name, JSON.parse(c.function.arguments) as unknown])).toEqual([
      // The [[…]] a model copies from our citation syntax is unwrapped.
      ["read_note", { documentId: ID }],
      ["search_vault", { query: "recent changes", limit: 5 }],
      ["vault_stats", {}],
    ]);
  });

  it("leaves markup it cannot turn into a call in the text, and says so", () => {
    const text = "Thinking…\n<tool_call>\n<weird>read_note</weird>\n</tool_call>\nDone.";
    const r = parseTextToolCalls(text);
    expect(r.calls).toEqual([]);
    expect(r.text).toBe(text);
    expect(hasToolCallMarkup(text)).toBe(true);
    expect(hasToolCallMarkup("plain prose [[x]]")).toBe(false);
  });

  it("strips every tool-call-shaped block as a last resort, keeping the prose", () => {
    const text =
      `Here is what I found.\n\n<tool_call>\n<weird/>\n</tool_call>\n\n\n<function=read_note><parameter=documentId>x</parameter></function>\n` +
      `[TOOL_CALLS][{"name":"a"}]\nThe answer is 42.`;
    expect(stripToolCallMarkup(text)).toBe("Here is what I found.\n\nThe answer is 42.");
  });
});
