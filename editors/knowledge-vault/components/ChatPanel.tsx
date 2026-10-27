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
import {
  useChatLlm,
  type ChatLlm,
  type ChatReply,
  type ChatStage,
  type ModelState,
  type PendingChoice,
  type ProposedAction,
} from "../hooks/use-chat-llm.js";
import { ChatChoiceCard } from "./ChatChoiceCard.js";
import { ChatModelSettings } from "./ChatModelSettings.js";
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

const STAGE_TEXT: Record<ChatStage, string> = {
  choose: "Choosing the operation...",
  score: "Scoring alternatives...",
  "wait-kev": "Waiting for the decision model...",
  fill: "Filling arguments...",
  answer: "Answering...",
};

/**
 * Chat tab, configuration C (X5 LoRA x Kev-FT, margin gate): a request on
 * the target document becomes one proposed action (confirm before
 * dispatch), or a choice among the fused top 3 when the models are not sure;
 * a request the LoRA maps to no change is answered. Without a target
 * document the tab answers questions and asks for a document otherwise.
 */
export function ChatView({ documents }: { documents: PHDocument[] }) {
  const llm = useChatLlm();
  const [docId, setDocId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<ProposedAction | null>(null);
  const [choice, setChoice] = useState<PendingChoice | null>(null);

  const supportedTypes = useMemo(
    () => new Set(v1Catalog().map((e) => e.docType)),
    [],
  );
  const docs = useMemo(() => documents.map(toChatDocument), [documents]);
  const pickable = docs.filter((d) => supportedTypes.has(d.docType));

  function push(msg: ChatMessage) {
    setMessages((m) => [...m, msg]);
  }

  function showReply(reply: ChatReply) {
    if (reply.kind === "answer") {
      push({
        role: "system",
        text: "No document change (the model chose no document change); answering.",
      });
      push({ role: "assistant", text: reply.text });
    } else if (reply.kind === "choose") setChoice(reply.choice);
    else {
      const pr = reply.proposal.provenance;
      if (pr.kind === "lora-alone" && pr.reason.startsWith("failed"))
        push({
          role: "system",
          text: "Decision model failed on this message; LoRA alone.",
        });
      setProposal(reply.proposal);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setProposal(null);
    setChoice(null);
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
      showReply(await llm.send(text, route.doc, docs));
    } catch (err) {
      push({
        role: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose(index: number) {
    const opt = choice?.options[index];
    if (!choice || !opt || busy) return;
    setBusy(true);
    try {
      const reply = await llm.choose(choice, opt.entry);
      setChoice(null);
      showReply(reply);
    } catch (err) {
      push({
        role: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function handleNone() {
    setChoice(null);
    push({
      role: "system",
      text: "Nothing changed. Try rephrasing, or name the change more directly.",
    });
  }

  async function handleConfirm() {
    if (!proposal?.action) return;
    const { doc, entry } = proposal;
    setDispatching(true);
    const errors: string[] = [];
    try {
      const ok = await dispatchActions(proposal.action, doc.id, (errs) =>
        errors.push(...errs.map((e) => e.message)),
      );
      if (ok && errors.length === 0)
        push({
          role: "system",
          text: `Dispatched ${entry.opName} to "${doc.title}".`,
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
        text: `Cancelled ${proposal.entry.opName}; nothing dispatched.`,
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
        <ModelStatusRows llm={llm} />
      </div>
      {llm.legacyModelFile && (
        <div
          data-testid="chat-legacy-notice"
          className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
          style={{
            border: "1px solid var(--bai-border)",
            color: "var(--bai-text-muted)",
          }}
        >
          <span className="flex-1">
            The model URL saved by the previous chat version (
            <code>{llm.legacyModelFile}</code>) is no longer used: the tab now runs
            configuration C&apos;s models. To try that file anyway, enter its URL as the
            command model under Model settings.
          </span>
          <button
            type="button"
            onClick={llm.dismissLegacyNotice}
            className="underline"
            style={{ color: "var(--bai-accent)" }}
          >
            Dismiss
          </button>
        </div>
      )}
      <ChatModelSettings llm={llm} />

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
        {busy && llm.stage && (
          <div
            data-testid="chat-stage"
            className="px-3 text-xs"
            style={{ color: "var(--bai-text-muted)" }}
          >
            {STAGE_TEXT[llm.stage]}
            {llm.stage === "wait-kev" && llm.kev.phase !== "ready" && (
              <>
                {" "}
                <button
                  type="button"
                  data-testid="chat-skip-kev"
                  onClick={llm.skipKev}
                  className="underline"
                  style={{ color: "var(--bai-accent)" }}
                >
                  Use LoRA alone for this message
                </button>
              </>
            )}
          </div>
        )}
        {choice && (
          <ChatChoiceCard
            choice={choice}
            busy={busy}
            onChoose={(i) => void handleChoose(i)}
            onNone={handleNone}
          />
        )}
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

function statusText(m: ModelState, idle: string): string {
  switch (m.phase) {
    case "idle":
      return idle;
    case "off":
      return "off";
    case "downloading":
      return `downloading ${Math.round(m.progress * 100)}%`;
    case "loading":
      return "loading";
    case "ready": {
      const i = m.info;
      if (!i) return "ready";
      const gpu = i.gpuLayers ? `, ${i.gpuLayers.offloaded}/${i.gpuLayers.total} layers on GPU` : "";
      return `ready (${i.backend}${gpu}, load ${Math.round(i.loadMs)} ms${i.useCache ? ", cached" : ""})`;
    }
    case "error":
      return `error: ${m.error ?? ""}`;
  }
}

function StatusRow({
  testId,
  name,
  state,
  idle,
}: {
  testId: string;
  name: string;
  state: ModelState;
  idle: string;
}) {
  return (
    <span className="flex items-center gap-2">
      {(state.phase === "downloading" || state.phase === "loading") && (
        <progress max={1} value={state.progress} className="h-1 w-20" />
      )}
      <span data-testid={testId} style={{ color: "var(--bai-text-muted)" }}>
        {name}: {statusText(state, idle)}
        {state.mismatch && (
          <span style={{ color: "#d97706" }}>
            {" "}
            · file differs from the measured C artifact ({state.mismatch})
          </span>
        )}
      </span>
    </span>
  );
}

/** The two models' status and the configuration the next turn runs. */
function ModelStatusRows({ llm }: { llm: ChatLlm }) {
  const { lora, kev } = llm.sources;
  return (
    <div className="ml-auto flex flex-col items-end gap-0.5 text-xs">
      <StatusRow
        testId="chat-lora-status"
        name={`Command model (${lora.matchesManifest ? "X5 LoRA 350M, 229 MB" : lora.fileName})`}
        state={llm.lora}
        idle="loads on first message"
      />
      <StatusRow
        testId="chat-kev-status"
        name={`Decision model (${kev.matchesManifest ? "Kev-FT 0.8B, 530 MB" : kev.fileName})`}
        state={llm.kev}
        idle={llm.settings.useKev ? "loads on first request to a document" : "off"}
      />
      <span
        data-testid="chat-config-label"
        style={{ color: llm.config.kind === "C" ? "var(--bai-text-muted)" : "#d97706" }}
      >
        {llm.config.text}
      </span>
    </div>
  );
}
