import { useMemo, useState } from "react";
import type { PHDocument } from "document-model";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import {
  documentTitle,
  type ChatDocument,
} from "../chat/core/ref-candidates.js";
import {
  askForDocumentText,
  documentTypeName,
  resolveTargetDocument,
  routeChatTurn,
} from "../chat/core/target-document.js";
import { v1Catalog } from "../chat/core/v1-pipeline.js";
import { useChatLlm, type ProposedAction } from "../hooks/use-chat-llm.js";
import { ChatProposalCard } from "./ChatProposalCard.js";

interface ChatMessage {
  role: "user" | "assistant" | "system" | "error";
  text: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A drive document as the chat sees it (global state only). */
export function toChatDocument(d: PHDocument): ChatDocument {
  const state: unknown = d.state;
  const global = isRecord(state) && isRecord(state.global) ? state.global : {};
  return {
    id: d.header.id,
    docType: d.header.documentType,
    title: documentTitle(global, d.header.name || d.header.id),
    state: global,
  };
}

const NO_ACTION_TEXT: Record<string, string> = {
  model: "the model chose no document change",
  gate: "the no-action gate",
  "no-ops": "this document type has no operations",
};

/**
 * Chat tab, v1 pipeline (R2c, prompt format r6.1): a request on the target
 * document becomes one proposed action (confirm before dispatch); a request
 * the model maps to no change is answered. Without a target document the
 * tab answers questions and asks for a document for anything else.
 */
export function ChatView({ documents }: { documents: PHDocument[] }) {
  const llm = useChatLlm();
  const [docId, setDocId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<ProposedAction | null>(null);

  const supportedTypes = useMemo(
    () => new Set(v1Catalog().map((e) => e.docType)),
    [],
  );
  const docs = useMemo(() => documents.map(toChatDocument), [documents]);
  const pickable = docs.filter((d) => supportedTypes.has(d.docType));

  function push(msg: ChatMessage) {
    setMessages((m) => [...m, msg]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setProposal(null);
    push({ role: "user", text });
    const route = routeChatTurn(
      text,
      resolveTargetDocument({
        selectedId: docId,
        documents: docs,
        supportedTypes,
        utterance: text,
      }),
    );
    if (route.kind === "ask") {
      push({
        role: "system",
        text: askForDocumentText(route.reason, route.options),
      });
      return;
    }
    setBusy(true);
    try {
      if (route.kind === "answer") {
        const reply = await llm.ask(text);
        push({
          role: "system",
          text: "No target document; answering the question.",
        });
        if (reply.kind === "answer") push({ role: "assistant", text: reply.text });
        return;
      }
      if (route.via === "title") {
        setDocId(route.doc.id);
        push({
          role: "system",
          text: `Target: "${route.doc.title}" (named in the request).`,
        });
      }
      const reply = await llm.send(text, route.doc, docs);
      if (reply.kind === "answer") {
        const why =
          reply.result?.kind === "no-action"
            ? NO_ACTION_TEXT[reply.result.reason]
            : "no change";
        push({ role: "system", text: `No document change (${why}); answering.` });
        push({ role: "assistant", text: reply.text });
      } else setProposal(reply.proposal);
    } catch (err) {
      push({
        role: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!proposal?.action) return;
    const { doc, result } = proposal;
    setDispatching(true);
    const errors: string[] = [];
    try {
      const ok = await dispatchActions(proposal.action, doc.id, (errs) =>
        errors.push(...errs.map((e) => e.message)),
      );
      if (ok && errors.length === 0)
        push({
          role: "system",
          text: `Dispatched ${result.entry.opName} to "${doc.title}".`,
        });
      else
        push({
          role: "error",
          text: `Dispatch failed: ${errors.join("; ") || "the reactor returned no result"}. Nothing was changed.`,
        });
    } catch (err) {
      push({
        role: "error",
        text: `Dispatch failed: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`,
      });
    } finally {
      setDispatching(false);
      setProposal(null);
    }
  }

  function handleCancel() {
    if (proposal)
      push({
        role: "system",
        text: `Cancelled ${proposal.result.entry.opName}; nothing dispatched.`,
      });
    setProposal(null);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Target document"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          className="rounded-md px-2 py-1 text-xs"
          style={{
            border: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text-secondary)",
          }}
        >
          <option value="">Target document...</option>
          {pickable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} ({documentTypeName(d.docType)})
            </option>
          ))}
        </select>
        <LlmStatus llm={llm} />
      </div>
      <ModelSetting llm={llm} />

      <div className="flex-1 space-y-2 overflow-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className="whitespace-pre-wrap rounded-md px-3 py-2"
            style={{
              backgroundColor:
                m.role === "user" ? "var(--bai-hover)" : "transparent",
              color:
                m.role === "error"
                  ? "#ef4444"
                  : m.role === "system"
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
            dispatching={dispatching}
            onConfirm={() => void handleConfirm()}
            onCancel={handleCancel}
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
          name="chat-input"
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
        ? `Model ready${llm.load ? ` (${llm.load.llm.backend}, load ${Math.round(llm.load.llm.loadMs)} ms)` : ""}`
        : llm.status === "error"
          ? `Model error: ${llm.error ?? ""}`
          : "Model loads on first message";
  return (
    <span className="ml-auto flex items-center gap-2 text-xs">
      {llm.status === "loading" && (
        <progress max={1} value={llm.progress} className="h-1 w-24" />
      )}
      <span
        data-testid="chat-llm-status"
        style={{ color: "var(--bai-text-muted)" }}
      >
        {label}
      </span>
    </span>
  );
}

/** Which model is loaded, and a field to point the tab at another GGUF. */
function ModelSetting({ llm }: { llm: ReturnType<typeof useChatLlm> }) {
  const [draft, setDraft] = useState(
    llm.model.source.kind === "url" ? llm.model.source.url : "",
  );
  return (
    <details className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
      <summary className="cursor-pointer">
        <span data-testid="chat-model-label">{llm.model.label}</span>
        {!llm.model.measured && (
          <span style={{ color: "#d97706" }}>
            {" "}
            · not measured with this pipeline; expect more wrong proposals
          </span>
        )}
      </summary>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          llm.setModelUrl(draft);
        }}
      >
        <input
          aria-label="Model GGUF URL"
          name="chat-model-url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="GGUF URL (empty = base model from Hugging Face)"
          className="flex-1 rounded-md px-2 py-1"
          style={{
            border: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text)",
          }}
        />
        <button
          type="submit"
          className="rounded-md px-3 py-1"
          style={{ border: "1px solid var(--bai-border)" }}
        >
          Use
        </button>
      </form>
      <div className="mt-1">
        Saved in this browser; the model loads on the next message.
        {llm.model.from === "env" && " Currently from VITE_CHAT_MODEL_URL."}
      </div>
    </details>
  );
}
