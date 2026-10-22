import { useState } from "react";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { useChatLlm, type ProposedAction } from "../hooks/use-chat-llm.js";
import { ChatProposalCard } from "./ChatProposalCard.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

/**
 * Spike chat tab, v1 pipeline (prompt format r6.1): a request on the
 * selected knowledge note becomes one proposed action (confirm before
 * dispatch); a question or comment is answered instead.
 */
export function ChatView({ notes }: { notes: KnowledgeNoteInfo[] }) {
  const llm = useChatLlm();
  const [noteId, setNoteId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<ProposedAction | null>(null);

  const note = notes.find((n) => n.id === noteId);
  const noteTitle = note ? (note.title ?? note.name) : "";

  function push(msg: ChatMessage) {
    setMessages((m) => [...m, msg]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    if (!note) {
      push({ role: "system", text: "Pick a target note first." });
      return;
    }
    setInput("");
    setProposal(null);
    push({ role: "user", text });
    setBusy(true);
    try {
      const reply = await llm.send(text, note);
      if (reply.kind === "answer") {
        push({
          role: "system",
          text: `No document change (${reply.result.kind === "no-action" ? reply.result.reason : "answer"}); answering.`,
        });
        push({ role: "assistant", text: reply.text });
      } else setProposal(reply.proposal);
    } catch (err) {
      push({
        role: "system",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!proposal?.action || !note) return;
    setDispatching(true);
    const errors: string[] = [];
    const result = await dispatchActions(proposal.action, note.id, (errs) =>
      errors.push(...errs.map((e) => e.message)),
    );
    setDispatching(false);
    push({
      role: "system",
      text:
        result && errors.length === 0
          ? `Dispatched ${proposal.result.entry.opName} to "${noteTitle}".`
          : `Dispatch failed: ${errors.join("; ") || "unknown error"}`,
    });
    setProposal(null);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Target note"
          value={noteId}
          onChange={(e) => setNoteId(e.target.value)}
          className="rounded-md px-2 py-1 text-xs"
          style={{
            border: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text-secondary)",
          }}
        >
          <option value="">Target note...</option>
          {notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title ?? n.name}
            </option>
          ))}
        </select>
        <LlmStatus llm={llm} />
      </div>

      <div className="flex-1 space-y-2 overflow-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className="whitespace-pre-wrap rounded-md px-3 py-2"
            style={{
              backgroundColor:
                m.role === "user" ? "var(--bai-hover)" : "transparent",
              color:
                m.role === "system"
                  ? "var(--bai-text-muted)"
                  : "var(--bai-text-secondary)",
            }}
          >
            {m.text}
          </div>
        ))}
        {proposal && (
          <ChatProposalCard
            proposal={proposal}
            targetTitle={noteTitle}
            dispatching={dispatching}
            onConfirm={() => void handleConfirm()}
            onDiscard={() => setProposal(null)}
          />
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <input
          aria-label="Chat input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='e.g. "tag this note with distributed systems", or ask a question'
          className="flex-1 rounded-md px-3 py-2 text-sm"
          style={{
            border: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text)",
          }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md px-4 py-2 text-xs font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          {busy ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}

function LlmStatus({ llm }: { llm: ReturnType<typeof useChatLlm> }) {
  const label =
    llm.status === "loading"
      ? `Loading model ${Math.round(llm.progress * 100)}%`
      : llm.status === "ready"
        ? `Model ready${llm.load ? ` (${llm.load.llm.backend}, ${Math.round(llm.load.llm.loadMs)} ms; embedder ${Math.round(llm.load.embedderLoadMs)} ms)` : ""}`
        : llm.status === "error"
          ? `Model error: ${llm.error ?? ""}`
          : "Model loads on first message";
  return (
    <span className="ml-auto flex items-center gap-2 text-xs">
      {llm.status === "loading" && (
        <progress max={1} value={llm.progress} className="h-1 w-24" />
      )}
      <span style={{ color: "var(--bai-text-muted)" }}>{label}</span>
    </span>
  );
}
