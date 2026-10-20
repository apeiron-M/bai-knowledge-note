/**
 * The chat loop and proposals: a refused proposal goes back to the model, the
 * turn keeps the last one that checked out, and a later request tells the
 * model what the person did with it.
 */
import "../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latestProposal, runAgentLoop, sentContent, type TrailEntry } from "./use-chat.js";
import { endpointFor } from "../lib/chat/provider.js";
import { readEdited, readOutcome, writeEdited, writeOutcome } from "../lib/chat/proposal-outcomes.js";
import type { ChatMessage } from "../lib/chat/completions-client.js";
import type { WorkProposal } from "../lib/chat/work-changes.js";

const LOCAL = endpointFor({ kind: "host", baseUrl: "http://127.0.0.1:4202/llm/v1", model: "gpt-oss-20b-vault", label: "gpt-oss-20b-vault on this computer", headers: {} })!;
const base = { endpoint: LOCAL, model: "gpt-oss-20b-vault", driveId: "d" };
const tc = (name: string, args: unknown, id: string) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
const calls = (...c: ReturnType<typeof tc>[]) => ({ text: "", toolCalls: c, finishReason: "tool_calls", model: null });
const answer = (text: string) => ({ text, toolCalls: [], finishReason: "stop", model: null });

const proposal = (id: string, summary: string, n = 2): WorkProposal => ({
  id,
  summary,
  documents: {},
  changes: Array.from({ length: n }, (_, k) => ({ kind: "create_scope" as const, ref: `new:s${k}`, title: `S${k}`, says: `Create scope of work “S${k}” in /projects` })),
  deletions: 0,
  refs: [],
  createdAt: "2026-10-15T12:00:00.000Z",
});
const entry = (ok: boolean, p?: WorkProposal): TrailEntry =>
  ok
    ? { tool: "propose_work_changes", ok: true, summary: "proposed", data: { proposal: p } }
    : { tool: "propose_work_changes", ok: false, summary: "propose_work_changes failed", error: "Nothing was proposed." };

afterEach(() => localStorage.clear());

describe("the proposal an answer keeps", () => {
  it("is the last one that checked out — a revision replaces the first, a refusal after it does not", () => {
    const first = proposal("p-1", "first");
    const second = proposal("p-2", "second");
    expect(latestProposal([entry(true, first), entry(true, second), entry(false)])).toBe(second);
    expect(latestProposal([entry(false)])).toBeNull();
    expect(latestProposal([{ tool: "search_vault", ok: true, summary: "s", data: { proposal: first } }])).toBeNull();
  });

  it("comes from a turn where the model fixed what the checker refused", async () => {
    const good = proposal("p-good", "Add Operations 2027");
    const streamChat = vi
      .fn()
      .mockResolvedValueOnce(calls(tc("propose_work_changes", { summary: "x", changes: [{ kind: "operation", document: "scope-1", type: "UPDATE_PROJECT", input: { id: "nope" } }] }, "c1")))
      .mockResolvedValueOnce(calls(tc("propose_work_changes", { summary: "Add Operations 2027", changes: [{ kind: "create_scope", ref: "new:ops", title: "Operations 2027" }] }, "c2")))
      .mockResolvedValueOnce(answer("I proposed a new scope, Operations 2027 — apply it from the card below."));
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Nothing was proposed. Fix these and propose again: change 1: UPDATE_PROJECT would be refused by document scope-1 — Project not found." })
      .mockResolvedValueOnce({ ok: true, summary: "proposed 1 change", data: { proposal: good, shown: "The person now sees these changes as a card" } });
    const r = await runAgentLoop({ ...base, messages: [{ role: "user", content: "Make a scope for operations" }], deps: { streamChat, executeTool } as never });
    // The refusal reached the model as the tool's answer, so it could fix the proposal.
    const second = streamChat.mock.calls[1][0] as { messages: ChatMessage[] };
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(String(second.messages.at(-1)!.content)).toContain("Project not found");
    expect(latestProposal(r.trail)).toBe(good);
    expect(r.text).toBe("I proposed a new scope, Operations 2027 — apply it from the card below.");
  });
});

describe("what the model is told about a proposal, the next time the conversation is sent", () => {
  const p = proposal("p-out", "Add Operations 2027 and its project");
  const message = { role: "assistant" as const, content: "I proposed it.", proposals: [p] };

  it("leaves messages without a proposal as they are", () => {
    expect(sentContent({ role: "user", content: "Make a scope" })).toBe("Make a scope");
    expect(sentContent({ role: "assistant", content: "An answer." })).toBe("An answer.");
  });

  it("says when the person has not applied it yet", () => {
    expect(sentContent(message)).toBe("I proposed it.\n\n(The proposal above — Add Operations 2027 and its project — has not been applied yet.)");
  });

  it("says it was applied, and what it created, with the ids to cite", () => {
    writeOutcome(p.id, { status: "applied", results: [{ status: "done" }, { status: "done" }], created: [{ documentId: "doc-1", documentType: "powerhouse/scopeofwork", title: "Operations 2027" }], touched: [], at: "t" });
    expect(sentContent(message)).toBe("I proposed it.\n\n(The person applied the proposal above: all 2 changes were made. Created: Operations 2027 [[doc-1]].)");
    writeOutcome(p.id, { status: "applied", results: [{ status: "done" }], created: [], touched: [], at: "t" });
    expect(sentContent(message)).toBe("I proposed it.\n\n(The person applied the proposal above: the change was made.)");
  });

  it("says where it stopped, and why", () => {
    writeOutcome(p.id, { status: "partial", results: [{ status: "done" }, { status: "failed", error: "Project not found" }], created: [], touched: [], at: "t" });
    expect(sentContent(message)).toBe("I proposed it.\n\n(The person applied the proposal above, but it stopped: 1 of 2 changes were made; the next failed — Project not found.)");
  });

  it("says it was cancelled", () => {
    writeOutcome(p.id, { status: "cancelled", results: [], created: [], touched: [], at: "t" });
    expect(sentContent(message)).toBe("I proposed it.\n\n(The person cancelled the proposal above: nothing was changed.)");
  });

  it("reads a damaged record as no record", () => {
    localStorage.setItem("bai-chat-proposal:v1:p-out", "{not json");
    expect(readOutcome("p-out")).toBeNull();
  });
});

describe("what the model is told about a proposal the person edited", () => {
  const original = proposal("p-edit", "Add Operations 2027 and its project");
  const message = { role: "assistant" as const, content: "I proposed it.", proposals: [original] };
  const edited = {
    ...original,
    edited: ["scopes[0]"],
    changes: [
      { kind: "create_scope" as const, at: "scopes[0]", ref: "new:s0", title: "Ops 2027", says: "Create scope of work “Ops 2027” in /projects" },
      { kind: "create_scope" as const, at: "scopes[1]", ref: "new:s1", title: "S1", says: "Create scope of work “S1” in /projects" },
    ],
  };

  it("names the edited changes — before applying, and after", () => {
    writeEdited(edited);
    expect(sentContent(message)).toBe(
      "I proposed it.\n\n(The proposal above — Add Operations 2027 and its project — has not been applied yet. The person edited it first: Create scope of work “Ops 2027” in /projects.)",
    );
    writeOutcome(original.id, { status: "applied", results: [{ status: "done" }, { status: "done" }], created: [{ documentId: "doc-1", documentType: "powerhouse/scopeofwork", title: "Ops 2027" }], touched: [], at: "t" });
    expect(sentContent(message)).toBe(
      "I proposed it.\n\n(The person applied the proposal above: all 2 changes were made. Created: Ops 2027 [[doc-1]]. The person edited it first: Create scope of work “Ops 2027” in /projects.)",
    );
  });

  it("reads an edited copy only for its own proposal", () => {
    writeEdited({ ...edited, id: "p-other" });
    expect(readEdited("p-edit")).toBeNull();
    localStorage.setItem("bai-chat-proposal-edit:v1:p-edit", "{broken");
    expect(readEdited("p-edit")).toBeNull();
  });
});
