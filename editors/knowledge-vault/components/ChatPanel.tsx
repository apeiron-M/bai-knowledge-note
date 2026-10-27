import { useMemo, useState, type RefObject } from "react";
import { generateId } from "document-model";
import { dispatchActions, useGetDocument } from "@powerhousedao/reactor-browser";
import { toChatDocument } from "../chat/context/chat-document.js";
import type { ContextTarget, DocumentTarget } from "../chat/context/context-frame.js";
import type { HistoryEntry } from "../chat/context/history-store.js";
import { driveRefContext, type ChatDocument } from "../chat/core/ref-candidates.js";
import {
  resolveTargetDocument,
  routeChatTurn,
  type CreateIntent,
} from "../chat/core/target-document.js";
import { v1Catalog } from "../chat/core/v1-pipeline.js";
import type { ChatContextValue } from "../hooks/use-chat-context.js";
import {
  useChatLlm,
  type ChatLlm,
  type ChatReply,
  type ChatStage,
  type ModelState,
} from "../hooks/use-chat-llm.js";
import type { ChatCard, ChatSession } from "../hooks/use-chat-session.js";
import {
  ChatChoiceCard,
  opChoiceOptions,
  pickChoiceOptions,
  targetChoiceOptions,
} from "./ChatChoiceCard.js";
import { ChatModelSettings } from "./ChatModelSettings.js";
import { ChatProposalCard } from "./ChatProposalCard.js";
import { targetLabel } from "./ChatTargetTag.js";

const STAGE_TEXT: Record<ChatStage, string> = {
  choose: "Choosing the operation...",
  score: "Scoring alternatives...",
  "wait-kev": "Waiting for the decision model...",
  fill: "Filling arguments...",
  answer: "Answering...",
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface ChatPanelProps {
  context: ChatContextValue;
  session: ChatSession;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Opens the New dialog for a drive-level create request. */
  onCreate: (intent: CreateIntent) => void;
}

/** What the card for a turn acts on, fixed when the turn is sent. */
interface CardMeta {
  target: DocumentTarget;
  context: ContextTarget;
  retargetedFrom?: DocumentTarget;
}

/**
 * The sheet's chat, configuration C (X5 LoRA x Kev-FT, margin gate): a
 * request on the target document becomes one proposed action (confirm
 * before dispatch), or a choice among the fused top 3 when the models are
 * not sure; a request the LoRA maps to no change is answered. The target is
 * the viewed document (the tag) unless the request names exactly one other
 * document; when it also points at the open document ("this", "it"), the
 * chat first asks which of the two to change. A mention that is not a
 * document's exact title ("the CRDT MOC") asks with its top 3 matches plus
 * the open document. A card keeps its own target after the tag moves on.
 */
export function ChatPanel({ context, session, inputRef, onCreate }: ChatPanelProps) {
  const llm = useChatLlm();
  const getDocument = useGetDocument();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [createOffers, setCreateOffers] = useState<Record<string, CreateIntent>>({});
  const { frame, documents } = context;
  const { state } = session;
  const card = state.pending;

  const supportedTypes = useMemo(() => new Set(v1Catalog().map((e) => e.docType)), []);

  async function loadDoc(id: string): Promise<ChatDocument> {
    return toChatDocument(await getDocument(id));
  }

  function showReply(reply: ChatReply, meta: CardMeta, turnId: string) {
    const about = { turnId, target: meta.target };
    if (reply.kind === "answer") {
      session.append(
        "system",
        "No document change (the model chose no document change); answering.",
        about,
      );
      session.append("assistant", reply.text, about);
    } else if (reply.kind === "choose") {
      session.setPending({ ...meta, payload: { kind: "choice", choice: reply.choice } });
      session.append(
        "system",
        `Asked which change to make on "${meta.target.title}" (${reply.choice.options.length} options).`,
        about,
      );
    } else {
      const pr = reply.proposal.provenance;
      if (pr.kind === "lora-alone" && pr.reason.startsWith("failed"))
        session.append("system", "Decision model failed on this message; LoRA alone.", about);
      session.setPending({ ...meta, payload: { kind: "proposal", proposal: reply.proposal } });
      session.append(
        "system",
        `Proposed ${reply.proposal.entry.opName} on "${meta.target.title}" (waiting for Confirm).`,
        about,
      );
    }
  }

  /** Runs the pipeline on `chosen` and shows its card. `from`: the viewed
   * document a retarget or a target choice switched away from. */
  async function runOnDocument(
    text: string,
    chosen: DocumentTarget,
    viewing: ContextTarget,
    turnId: string,
    opts: { from?: DocumentTarget; chosen?: boolean; keepIds?: string[] } = {},
  ) {
    const { from } = opts;
    const doc = await loadDoc(chosen.id);
    const target: DocumentTarget = { ...chosen, title: doc.title, docType: doc.docType };
    if (chosen.id !== viewing.id)
      session.append(
        "system",
        from
          ? `Target: "${target.title}" (${opts.chosen ? "chosen" : "named in the request"}), not the viewed "${from.title}".`
          : `Target: "${target.title}" (${opts.chosen ? "chosen" : "named in the request"}).`,
        { turnId, target },
      );
    const wbsRef = typeof doc.state.wbsRef === "string" ? doc.state.wbsRef : "";
    const linkedWbs =
      doc.docType === "bai/project" && wbsRef
        ? await loadDoc(wbsRef).catch(() => undefined)
        : undefined;
    const refContext = driveRefContext(doc, documents, {
      linkedWbs,
      utterance: text,
      recentIds: frame.recentIds,
      keepIds: opts.keepIds,
    });
    const reply = await llm.send(text, doc, refContext);
    showReply(reply, { target, context: viewing, retargetedFrom: from }, turnId);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    const turnId = generateId();
    const viewing = frame.target;
    setInput("");
    session.settle();
    session.append("user", text, { turnId, context: viewing, target: viewing });
    const route = routeChatTurn(
      text,
      resolveTargetDocument({
        context: viewing,
        documents,
        supportedTypes,
        utterance: text,
        recentIds: frame.recentIds,
      }),
    );
    if (route.kind === "explain") {
      session.append("system", route.text, { turnId, target: viewing });
      const intent = route.create;
      if (intent) setCreateOffers((o) => ({ ...o, [turnId]: intent }));
      return;
    }
    setBusy(true);
    try {
      if (route.kind === "answer") {
        const reply = await llm.ask(text);
        session.append(
          "system",
          route.because === "drive"
            ? "No document open; answering the question."
            : "No operations for this document's type; answering the question.",
          { turnId, target: viewing },
        );
        if (reply.kind === "answer")
          session.append("assistant", reply.text, { turnId, target: viewing });
        return;
      }
      if (route.kind === "ask") {
        session.setPending({
          target: route.open,
          context: viewing,
          payload: { kind: "target", utterance: text, open: route.open, named: route.named },
        });
        session.append(
          "system",
          `Asked which document to change: "${route.open.title}" (open) or "${route.named.title}" (named in the request).`,
          { turnId, target: viewing },
        );
        return;
      }
      if (route.kind === "pick") {
        const { candidates, open, phrase } = route;
        session.setPending({
          // nothing dispatches from this card; with nothing open it has no
          // document of its own, so it carries the best match
          target: open ?? candidates[0],
          context: viewing,
          payload: { kind: "pick", utterance: text, phrase, candidates, open },
        });
        const names = candidates.map((c) => `"${c.title}"`).join(", ");
        session.append(
          "system",
          `Asked which document "${phrase}" means: ${names}${open ? `, or "${open.title}" (open)` : ""}.`,
          { turnId, target: viewing },
        );
        return;
      }
      await runOnDocument(text, route.target, viewing, turnId, { from: route.from });
    } catch (err) {
      session.append("error", errText(err), { turnId, target: viewing });
    } finally {
      setBusy(false);
    }
  }

  /** The target choice: run the models on the chosen document; the other
   * one stays a ref candidate. */
  async function handleChooseTarget(index: number) {
    if (!card || card.payload.kind !== "target" || busy) return;
    const { utterance, open, named } = card.payload;
    const chosen = [open, named].at(index);
    if (!chosen) return;
    const other = chosen.id === open.id ? named : open;
    const turnId = generateId();
    const viewed = card.context;
    session.settle();
    setBusy(true);
    try {
      await runOnDocument(utterance, chosen, viewed, turnId, {
        from: chosen.id === open.id ? undefined : open,
        chosen: true,
        keepIds: [other.id],
      });
    } catch (err) {
      session.append("error", errText(err), { turnId, target: chosen });
    } finally {
      setBusy(false);
    }
  }

  /** A non-verbatim mention: run the models on the chosen document. A
   * match chosen keeps the open document as a ref candidate; the open one
   * chosen keeps the matches, so "link this note to the CRDT MOC" can
   * still point at the MOC. */
  async function handleChoosePick(index: number) {
    if (!card || card.payload.kind !== "pick" || busy) return;
    const { utterance, candidates, open } = card.payload;
    const chosen = [...candidates, ...(open ? [open] : [])].at(index);
    if (!chosen) return;
    const keepIds = (chosen.id === open?.id ? candidates : open ? [open] : []).map((d) => d.id);
    const turnId = generateId();
    const viewed = card.context;
    session.settle();
    setBusy(true);
    try {
      await runOnDocument(utterance, chosen, viewed, turnId, {
        // the switch box whenever the choice leaves the viewed document
        from: viewed.kind === "document" && chosen.id !== viewed.id ? viewed : undefined,
        chosen: true,
        keepIds,
      });
    } catch (err) {
      session.append("error", errText(err), { turnId, target: chosen });
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose(index: number) {
    if (!card || card.payload.kind !== "choice" || busy) return;
    const { choice } = card.payload;
    const opt = choice.options.at(index);
    if (!opt) return;
    const turnId = generateId();
    setBusy(true);
    try {
      const reply = await llm.choose(choice, opt.entry);
      session.settle();
      const { target, context: viewed, retargetedFrom } = card;
      showReply(reply, { target, context: viewed, retargetedFrom }, turnId);
    } catch (err) {
      session.append("error", errText(err), { turnId, target: card.target });
    } finally {
      setBusy(false);
    }
  }

  function handleNone() {
    if (!card) return;
    session.settle();
    session.append(
      "system",
      "Nothing changed. Try rephrasing, or name the change more directly.",
      { turnId: generateId(), target: card.target },
    );
  }

  async function handleConfirm(c: ChatCard) {
    if (c.payload.kind !== "proposal" || !c.payload.proposal.action) return;
    const { entry, action } = c.payload.proposal;
    const meta = { turnId: generateId(), target: c.target };
    setDispatching(true);
    const errors: string[] = [];
    try {
      // the card's own target, never the tag's current value
      const ok = await dispatchActions(action, c.target.id, (errs) =>
        errors.push(...errs.map((e) => e.message)),
      );
      if (ok && errors.length === 0) {
        session.append("system", `Dispatched ${entry.opName} to "${c.target.title}".`, meta);
        session.touchRecent(c.target);
      } else
        session.append(
          "error",
          `Dispatch failed: ${errors.join("; ") || "the reactor returned no result"}. Nothing was changed.`,
          meta,
        );
    } catch (err) {
      session.append("error", `Dispatch failed: ${errText(err)}. Nothing was changed.`, meta);
    } finally {
      setDispatching(false);
      session.settle();
    }
  }

  function handleCancel(c: ChatCard) {
    if (c.payload.kind === "proposal")
      session.append(
        "system",
        `Cancelled ${c.payload.proposal.entry.opName}; nothing dispatched.`,
        { turnId: generateId(), target: c.target },
      );
    session.settle();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <ChatModelSettings llm={llm} />
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
            <code>{llm.legacyModelFile}</code>) is no longer used: the chat now runs
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

      <div className="min-h-0 flex-1 space-y-2 overflow-auto" data-testid="chat-thread">
        {state.entries.map((m) => (
          <ThreadEntry
            key={m.id}
            entry={m}
            create={m.role === "system" ? createOffers[m.turnId] : undefined}
            onCreate={onCreate}
          />
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
        {card?.payload.kind === "choice" && (
          <ChatChoiceCard
            heading="Which change did you mean?"
            hint="The models were not sure enough to pick one."
            options={opChoiceOptions(card.payload.choice)}
            noneLabel="None of these"
            card={card}
            viewing={frame.target}
            busy={busy}
            onChoose={(i) => void handleChoose(i)}
            onNone={handleNone}
          />
        )}
        {card?.payload.kind === "target" && (
          <ChatChoiceCard
            heading="Which document should change?"
            hint="The request points at the open document and names another. Either could be the one to change."
            options={targetChoiceOptions(card.payload.open, card.payload.named)}
            noneLabel="Neither"
            card={card}
            viewing={frame.target}
            showTarget={false}
            busy={busy}
            onChoose={(i) => void handleChooseTarget(i)}
            onNone={handleNone}
          />
        )}
        {card?.payload.kind === "pick" && (
          <ChatChoiceCard
            heading="Which document did you mean?"
            hint={`"${card.payload.phrase}" is not the exact title of a document. These match best.`}
            options={pickChoiceOptions(card.payload.candidates, card.payload.open)}
            noneLabel="None of these"
            card={card}
            viewing={frame.target}
            showTarget={false}
            busy={busy}
            onChoose={(i) => void handleChoosePick(i)}
            onNone={handleNone}
          />
        )}
        {card?.payload.kind === "proposal" && (
          <ChatProposalCard
            proposal={card.payload.proposal}
            card={card}
            viewing={frame.target}
            dispatching={dispatching}
            onConfirm={() => void handleConfirm(card)}
            onCancel={() => handleCancel(card)}
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
          ref={inputRef}
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

function ThreadEntry({
  entry: m,
  create,
  onCreate,
}: {
  entry: HistoryEntry;
  create?: CreateIntent;
  onCreate: (intent: CreateIntent) => void;
}) {
  return (
    <div
      data-testid={`chat-entry-${m.role}`}
      className="whitespace-pre-wrap rounded-md px-3 py-2"
      style={{
        backgroundColor: m.role === "user" ? "var(--bai-hover)" : "transparent",
        color:
          m.role === "error"
            ? "#ef4444"
            : m.role === "system"
              ? "var(--bai-text-muted)"
              : "var(--bai-text-secondary)",
      }}
    >
      {m.text}
      {m.role === "user" && m.context && (
        <span
          className="mt-0.5 block text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          on {targetLabel(m.context)}
        </span>
      )}
      {create && (
        <button
          type="button"
          data-testid="chat-create-offer"
          onClick={() => onCreate(create)}
          className="mt-1 block rounded-md px-3 py-1 text-xs font-medium"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          New {create.label}
        </button>
      )}
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
