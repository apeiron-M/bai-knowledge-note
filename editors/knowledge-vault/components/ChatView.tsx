/**
 * Chat with the vault.
 *
 * Gemini's shape, as briefed: a centred greeting over a pill composer with
 * suggestion chips; on the first message the greeting lifts away, the
 * transcript takes the column, and the composer docks to the bottom.
 *
 * What makes it this vault's chat rather than a generic one: the greeting
 * carries the vault's own name, the suggestion chips are its real top topics,
 * progress is shown as the reading trail of graph queries the model actually
 * ran, and every citation opens the real note.
 *
 * Everything runs in the browser: the model through OpenRouter or any
 * OpenAI-compatible endpoint the user names (see lib/chat/provider.ts), the
 * data via the same Switchboard endpoints the search field uses. Nothing here
 * can write.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useVaultName } from "../hooks/use-vault-name.js";
import { useChatProvider } from "../hooks/use-chat-provider.js";
import { useChat, type ChatFailure } from "../hooks/use-chat.js";
import { executeTool } from "../lib/chat/vault-tools.js";
import {
  buildSystemPrompt,
  MAX_ORIENTATION_TOPICS,
} from "../lib/chat/system-prompt.js";
import { LoadingLine } from "./LoadingStates.js";
import { ChatComposer } from "./chat/ChatComposer.js";
import { ChatConnectPanel } from "./chat/ChatConnectPanel.js";
import { ChatHistoryMenu } from "./chat/ChatHistoryMenu.js";
import { ChatMessage } from "./chat/ChatMessage.js";
import { currencyLookup } from "../lib/supersession.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { ModelPicker } from "./chat/ModelPicker.js";
import { EndpointPicker } from "./chat/EndpointPicker.js";
import { LandingStage } from "./chat/LandingStage.js";

interface Orientation {
  stats: {
    nodeCount: number;
    noteCount?: number;
    mocCount?: number;
    openTensionCount?: number;
    edgeCount: number;
  } | null;
  topics: { name: string; noteCount: number }[];
  loaded: boolean;
}

/**
 * Stats and top topics, fetched once per drive through the same two tools the
 * model itself uses. They seed the system prompt and the suggestion chips.
 */
function useOrientation(
  driveId: string | undefined,
  enabled: boolean,
): Orientation {
  const [o, setO] = useState<Orientation>({
    stats: null,
    topics: [],
    loaded: false,
  });
  useEffect(() => {
    if (!driveId || !enabled) return;
    let cancelled = false;
    setO({ stats: null, topics: [], loaded: false });
    void Promise.all([
      executeTool("vault_stats", {}, { driveId }),
      executeTool(
        "list_topics",
        { limit: MAX_ORIENTATION_TOPICS },
        { driveId },
      ),
    ]).then(([s, t]) => {
      if (cancelled) return;
      setO({
        stats: s.ok ? (s.data as Orientation["stats"]) : null,
        topics: t.ok ? (t.data as Orientation["topics"]) : [],
        loaded: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [driveId, enabled]);
  return o;
}

export function ChatView({
  initialDraft = "",
  notes = [],
}: {
  initialDraft?: string;
  /** The drive's notes, for marking cited documents that are superseded or archived. */
  notes?: KnowledgeNoteInfo[];
}) {
  const currency = useMemo(() => currencyLookup(notes), [notes]);
  const driveId = useSelectedDriveId();
  const vaultName = useVaultName();
  const prov = useChatProvider();
  const orientation = useOrientation(driveId, prov.isConnected);
  // The composer's draft survives the chat view being replaced by a note
  // editor. Tab-scoped like the current-thread pointer; the OAuth return
  // intent takes precedence when both exist.
  const draftKey = driveId ? `bai-chat:draft:v1:${driveId}` : null;
  const [draft, setDraftState] = useState(
    () =>
      initialDraft ||
      (draftKey ? (sessionStorage.getItem(draftKey) ?? "") : ""),
  );
  const setDraft = (text: string) => {
    setDraftState(text);
    if (!draftKey) return;
    if (text) sessionStorage.setItem(draftKey, text);
    else sessionStorage.removeItem(draftKey);
  };
  const composerAnchorRef = useRef<HTMLDivElement>(null);

  const systemPrompt = useMemo(
    () =>
      buildSystemPrompt({
        vaultName,
        stats: orientation.stats,
        topics: orientation.topics,
      }),
    [vaultName, orientation.stats, orientation.topics],
  );

  const chat = useChat({
    driveId,
    endpoint: prov.endpoint,
    model: prov.model,
    fallbackModels: prov.fallbackModels,
    modelName: prov.modelName,
    systemPrompt,
  });

  // Automation only touches automatically chosen OpenRouter models. When one
  // is down — either OpenRouter fell back mid-request, or the whole request
  // failed for that model — skip it for the rest of the session so the next
  // turn starts on a model that works. An explicit choice is never swapped
  // out, and a server the user named has nothing to fall back to.
  const { modelIsExplicit, skipModel } = prov;
  const openRouter = prov.endpoint?.openRouter ?? false;
  useEffect(() => {
    if (!openRouter || modelIsExplicit) return;
    if (chat.routedFrom) skipModel(chat.routedFrom);
    if (chat.failure?.kind === "model-unavailable")
      skipModel(chat.failure.model);
  }, [chat.routedFrom, chat.failure, openRouter, modelIsExplicit, skipModel]);
  const inConversation = chat.messages.length > 0 || chat.isStreaming;

  // Follow the stream, but only if the user is already near the bottom —
  // scrolling someone away from an earlier answer they are reading is rude.
  const scrollRef = useRef<HTMLDivElement>(null);
  const openedAtBottom = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A transcript restored on mount (coming back from a cited note) opens at
    // the bottom, where the citation the user clicked was.
    if (!openedAtBottom.current && chat.messages.length > 0) {
      openedAtBottom.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streamingText, chat.trail]);

  if (!driveId) return null;

  if (!prov.isConnected) {
    return (
      <div className="flex h-full flex-col">
        <ChatConnectPanel
          vaultName={vaultName}
          busy={prov.isCompletingOAuth}
          interrupted={prov.interruptedAttempt}
          onConnect={() => void prov.connectOpenRouter({ driveId, draft })}
          onConnectWithKey={prov.connectWithOpenRouterKey}
          onConnectCustom={prov.connectCustom}
          connectSettings={prov.connectSettings}
          onUseConnectSettings={prov.useConnectSettings}
          saved={prov.saved}
          onUseSaved={prov.switchTo}
        />
      </div>
    );
  }

  const composer = (
    <ChatComposer
      initialDraft={draft}
      placeholder={inConversation ? "Follow up…" : `Ask ${vaultName} anything`}
      streaming={chat.isStreaming}
      autoFocus
      onSend={(t) => void chat.send(t)}
      onStop={chat.stop}
      onDraftChange={setDraft}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ borderBottom: "1px solid var(--bai-border)" }}
      >
        <ChatHistoryMenu
          threads={chat.threads}
          currentId={chat.thread?.id ?? null}
          onOpen={chat.openThread}
          onDelete={chat.removeThread}
        />
        {inConversation && (
          <button
            type="button"
            onClick={chat.newThread}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
            style={{ color: "var(--bai-text-tertiary)" }}
            title="Start a new chat"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <EndpointPicker
            active={prov.provider?.kind ?? null}
            label={prov.providerLabel}
            saved={prov.saved}
            onSwitch={prov.switchTo}
            onAdd={prov.addAnother}
          />
          <ModelPicker
            model={prov.model}
            models={prov.models}
            loading={prov.modelsLoading}
            fellBack={prov.modelFellBack}
            onChange={prov.setModel}
            allowCustomId={!openRouter}
          />
          <button
            type="button"
            onClick={prov.disconnect}
            className="rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
            style={{ color: "var(--bai-text-muted)" }}
            title={`Forget the ${prov.providerLabel} connection in this browser`}
          >
            Disconnect
          </button>
        </div>
      </div>

      {inConversation ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto px-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
              {/* Persisted turns carry no trail by design — tool payloads are
                  not stored — so only the live turn below renders one. */}
              {chat.messages.map((m, i) => (
                <ChatMessage key={i} message={m} currency={currency} />
              ))}
              {chat.isStreaming && (
                <ChatMessage
                  message={{ role: "assistant", content: chat.streamingText }}
                  trail={chat.trail}
                  streaming
                  currency={currency}
                />
              )}
              {!chat.isStreaming &&
                chat.trail.length > 0 &&
                chat.messages.at(-1)?.role === "assistant" && (
                  <TrailFooter count={chat.trail.length} />
                )}
              {chat.failure && chat.failure.kind !== "aborted" && (
                <FailureNotice
                  failure={chat.failure}
                  openRouter={openRouter}
                  providerLabel={prov.providerLabel}
                  modelIsFree={prov.modelIsFree}
                  modelIsExplicit={prov.modelIsExplicit}
                  nextModel={prov.model}
                  modelName={prov.modelName}
                />
              )}
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="mx-auto w-full max-w-3xl">{composer}</div>
          </div>
        </>
      ) : (
        <LandingStage
          anchorRef={composerAnchorRef}
          tail={
            <div className="flex w-full flex-wrap justify-center gap-2 pt-6">
              {!orientation.loaded && (
                <LoadingLine label="Reading the vault's topics…" />
              )}
              {orientation.topics.slice(0, 8).map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() =>
                    void chat.send(`What does the vault say about ${t.name}?`)
                  }
                  className="rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-[var(--bai-accent-soft)]"
                  style={{
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-accent)",
                  }}
                  title={`${t.noteCount} notes`}
                >
                  #{t.name}
                </button>
              ))}
            </div>
          }
        >
          <h1
            className="text-center text-3xl font-medium tracking-tight sm:text-4xl"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--bai-text) 20%, var(--bai-accent) 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Ask {vaultName} anything
          </h1>
          <p
            className="mt-3 text-sm"
            style={{ color: "var(--bai-text-muted)" }}
          >
            {orientation.stats
              ? `${(orientation.stats.noteCount ?? orientation.stats.nodeCount).toLocaleString()} notes · ${orientation.stats.edgeCount.toLocaleString()} links${orientation.stats.openTensionCount ? ` · ${orientation.stats.openTensionCount} open tension${orientation.stats.openTensionCount === 1 ? "" : "s"}` : ""} · read-only`
              : "Answers come from the vault's own notes, with citations you can open."}
          </p>
          <div ref={composerAnchorRef} className="mt-8 w-full">
            {composer}
          </div>
        </LandingStage>
      )}
    </div>
  );
}

function TrailFooter({ count }: { count: number }) {
  return (
    <p className="-mt-3 text-[11px]" style={{ color: "var(--bai-text-faint)" }}>
      {count} vault {count === 1 ? "query" : "queries"} behind this answer
    </p>
  );
}

/**
 * One notice per failure kind, each ending in the thing the user can do.
 * The provider's own sentence comes first — for billing and quota it is the
 * authoritative statement — and ours follows as the next step.
 */
function FailureNotice({
  failure,
  openRouter,
  providerLabel,
  modelIsFree,
  modelIsExplicit,
  nextModel,
  modelName,
}: {
  failure: ChatFailure;
  /** OpenRouter's billing and quota advice only makes sense on OpenRouter. */
  openRouter: boolean;
  providerLabel: string;
  modelIsFree: boolean;
  modelIsExplicit: boolean;
  /** The model the next turn will use (already re-resolved after a skip). */
  nextModel: string;
  modelName: (id: string) => string;
}) {
  let next: ReactNode = null;
  switch (failure.kind) {
    case "auth":
      next = (
        <>
          {providerLabel} rejected the key. Disconnect, then connect again with
          a valid one{openRouter ? "" : " — or with none, if the server does not need it"}.
        </>
      );
      break;
    case "unreachable":
      next = <>Once the server answers, just send the message again.</>;
      break;
    case "credits":
      next = !openRouter ? null : modelIsFree ? null : (
        <>
          This model bills per token. Pick one marked{" "}
          <span className="font-semibold">free</span> from the model menu, or
          add credits on OpenRouter.
        </>
      );
      break;
    case "free-quota":
      next = !openRouter ? null : (
        <>
          You have used today&apos;s free-model quota on OpenRouter — it is
          shared across every free model, so switching will not help and each
          retry counts against it. It resets daily. To continue now, add $10 of
          credits (raises the free quota to 1,000 requests a day) or pick a paid
          model.
        </>
      );
      break;
    case "model-unavailable":
      next = !openRouter ? (
        <>
          {providerLabel} could not serve {modelName(failure.model)}. Pick a
          model it lists from the menu — or, for Ollama, pull it first
          (<span className="font-mono">ollama pull {failure.model}</span>) —
          and send again.
        </>
      ) : modelIsExplicit ? (
        <>
          {modelName(failure.model)} is not responding right now. Pick another
          model from the menu and send again.
        </>
      ) : nextModel !== failure.model ? (
        <>
          {modelName(failure.model)} is not responding right now. Your next
          message will use {modelName(nextModel)} — just send it again.
        </>
      ) : (
        <>
          No free model is answering right now. Try again in a minute or pick a
          paid model.
        </>
      );
      break;
    default:
      next = null;
  }

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{
        backgroundColor: "rgba(239,68,68,0.08)",
        color: "#ef4444",
        border: "1px solid rgba(239,68,68,0.25)",
      }}
      role="alert"
    >
      <p>{failure.message}</p>
      {next && <p className="mt-1.5 opacity-80">{next}</p>}
    </div>
  );
}
