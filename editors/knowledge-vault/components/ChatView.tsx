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
 * data via the same Switchboard endpoints the search field uses. It writes
 * nothing by itself: changes to work come as a card the person applies.
 *
 * What it can do is shown where the person decides what to ask: task cards
 * under the empty composer, and the whole list on demand from the header's
 * "?" (chat/ChatStarters.tsx).
 *
 * Inside the desktop app the model is the app's: the connect screen and the
 * header's connection controls give way to the app's model (and a way back to
 * its settings), because there is nothing here to connect. A failed turn
 * points at those settings too, never at a key to reconnect or a menu to pick
 * from.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { chatRun, subscribeChatRun } from "../hooks/chat-runs.js";
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
import { SaveAnswer } from "./chat/SaveAnswer.js";
import { ChatHelpDialog, ChatStarters, useChatHelp } from "./chat/ChatStarters.js";
import { VaultIcon } from "./vault-icons.js";
import { currencyLookup } from "../lib/supersession.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { ModelPicker } from "./chat/ModelPicker.js";
import { EndpointPicker } from "./chat/EndpointPicker.js";
import { LandingStage } from "./chat/LandingStage.js";
import { HostModelMissing } from "./chat/HostModelMissing.js";
import { plainError } from "../../shared/plain-error.js";
import { orientationStats, type OrientationStats } from "../lib/chat/orientation.js";

interface Orientation {
  stats: OrientationStats | null;
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
        stats: s.ok ? orientationStats(s.data) : null,
        topics: t.ok && Array.isArray(t.data) ? (t.data as Orientation["topics"]) : [],
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
  ask,
  onAsked,
  notes = [],
}: {
  initialDraft?: string;
  /**
   * A question to ask at once, in a new conversation (the Ctrl K palette's
   * "Ask <vault> about …"). While no model is connected, or another answer is
   * still coming, it waits in the box instead. A new nonce asks again.
   */
  ask?: { text: string; nonce: number };
  /** The question was asked (or left in the box): the vault forgets it, so coming back never asks again. */
  onAsked?: () => void;
  /** The drive's notes, for marking cited documents that are superseded or archived. */
  notes?: KnowledgeNoteInfo[];
}) {
  const currency = useMemo(() => currencyLookup(notes), [notes]);
  const driveId = useSelectedDriveId();
  const vaultName = useVaultName();
  const prov = useChatProvider();
  // Ties the header's "Change in Settings" button to the model label it changes.
  const modelChipId = useId();
  const orientation = useOrientation(driveId, prov.isConnected);
  // What the chat can do: the panel's open state, and whether it was ever opened here.
  const help = useChatHelp();
  const topTopic = orientation.topics[0]?.name ?? null;
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

  // The palette's question: asked once the vault's orientation is in the
  // prompt (or after a short wait, so a slow index never swallows it).
  const askedNonce = useRef<number | null>(null);
  const [askWaited, setAskWaited] = useState(false);
  useEffect(() => {
    if (!ask) return;
    const timer = setTimeout(() => setAskWaited(true), 4000);
    return () => clearTimeout(timer);
  }, [ask]);
  // The vault streams one answer at a time, whichever conversation it is in.
  const subscribeRun = useCallback((notify: () => void) => subscribeChatRun(driveId, notify), [driveId]);
  const vaultAnswering = useSyncExternalStore(
    subscribeRun,
    () => chatRun(driveId)?.isStreaming ?? false,
    () => false,
  );
  const { send } = chat;
  useEffect(() => {
    if (!ask || !driveId || askedNonce.current === ask.nonce) return;
    if (!prov.isConnected) {
      // No model yet: the question waits in the box.
      askedNonce.current = ask.nonce;
      setDraftState(ask.text);
      if (draftKey) sessionStorage.setItem(draftKey, ask.text);
      onAsked?.();
      return;
    }
    // An answer still coming (the palette has stopped it) ends first.
    if (vaultAnswering) return;
    if (!orientation.loaded && !askWaited) return;
    askedNonce.current = ask.nonce;
    onAsked?.();
    void send(ask.text);
  }, [ask, driveId, draftKey, prov.isConnected, vaultAnswering, send, orientation.loaded, askWaited, onAsked]);
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

  if (prov.hostManaged && !prov.isConnected) {
    return (
      <HostModelMissing
        vaultName={vaultName}
        onOpenSettings={prov.openModelSettings}
      />
    );
  }

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
      placeholder={inConversation ? "Ask a follow-up" : `Ask ${vaultName} anything`}
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
            className="vault-btn"
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
          {prov.hostManaged ? (
            <>
              <span
                id={modelChipId}
                className="max-w-[240px] truncate rounded-md px-2 py-1 text-xs"
                style={{ color: "var(--bai-text-tertiary)" }}
                title={`${prov.providerLabel}. The AI model set in the app's Settings › Models`}
              >
                {prov.providerLabel}
              </span>
              {prov.openModelSettings && (
                <button
                  type="button"
                  aria-describedby={modelChipId}
                  onClick={() => prov.openModelSettings?.()}
                  className="vault-btn"
                >
                  Change in Settings
                </button>
              )}
            </>
          ) : (
            <>
              <EndpointPicker
                active={prov.provider?.kind ?? null}
                label={prov.providerLabel}
                saved={prov.saved}
                onSwitch={prov.switchTo}
                onAdd={prov.addAnother}
                thinkingDisabled={prov.thinkingDisabled}
                onToggleThinking={prov.setThinking}
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
                className="vault-btn"
                title={`Forget the ${prov.providerLabel} connection in this browser`}
              >
                Disconnect
              </button>
            </>
          )}
          <button
            type="button"
            onClick={help.show}
            className="vault-btn"
            aria-label="What the chat can do"
            title="What the chat can do"
          >
            <VaultIcon name="help" size={16} />
          </button>
        </div>
      </div>
      {help.open && (
        <ChatHelpDialog
          topic={topTopic}
          onAsk={(q) => {
            help.hide();
            void chat.send(q);
          }}
          onClose={help.hide}
        />
      )}

      {inConversation ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto px-4 pt-5">
            {/* The conversation is read like a document: on its own sheet, as
                the source editor's content is (white in light, the reading
                well in dark), so it never melts into the page. */}
            <style aria-hidden="true">{CHAT_SHEET_CSS}</style>
            <div className="vault-chat-sheet">
              {/* Persisted turns carry no trail by design — tool payloads are
                  not stored — so only the live turn below renders one. */}
              {chat.messages.map((m, i) => (
                <ChatMessage
                  key={i}
                  message={m}
                  currency={currency}
                  // The latest answer says how it was found, under what it used.
                  searches={
                    i === chat.messages.length - 1 &&
                    m.role === "assistant" &&
                    !chat.isStreaming &&
                    chat.trail.length > 0
                      ? chat.trail.length
                      : undefined
                  }
                  footer={
                    m.role === "assistant" && m.content.trim() ? (
                      <SaveAnswer
                        message={m}
                        question={chat.messages[i - 1]?.role === "user" ? chat.messages[i - 1].content : ""}
                        driveId={driveId}
                        threadId={chat.thread?.id ?? null}
                      />
                    ) : undefined
                  }
                />
              ))}
              {chat.isStreaming && (
                <ChatMessage
                  message={{ role: "assistant", content: chat.streamingText }}
                  trail={chat.trail}
                  streaming
                  currency={currency}
                />
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
                  hostManaged={prov.hostManaged}
                  openModelSettings={prov.openModelSettings}
                />
              )}
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="mx-auto w-full" style={{ maxWidth: "64rem" }}>{composer}</div>
          </div>
        </>
      ) : (
        <LandingStage
          anchorRef={composerAnchorRef}
          tail={
            <ChatStarters topic={topTopic} onAsk={(q) => void chat.send(q)} onHelp={help.show} seen={help.seen}>
              <div className="flex w-full flex-wrap justify-center gap-2" role="group" aria-label="Topics in this vault">
                {!orientation.loaded && (
                  <LoadingLine label="Reading the vault's topics…" />
                )}
                {orientation.topics.slice(0, 6).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() =>
                      void chat.send(`What does the vault say about ${t.name}?`)
                    }
                    className="vault-chip"
                    data-tone="accent"
                    title={`${t.noteCount} notes`}
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            </ChatStarters>
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
              ? `${(orientation.stats.noteCount ?? orientation.stats.nodeCount).toLocaleString()} notes · ${orientation.stats.edgeCount.toLocaleString()} links${orientation.stats.openTensionCount ? ` · ${orientation.stats.openTensionCount} open tension${orientation.stats.openTensionCount === 1 ? "" : "s"}` : ""}`
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

/**
 * The conversation's sheet (design: the answer view, `.convo` and `.a`). It is
 * read like a document — on its own surface, as the source editor's content
 * is: white in light, the reading well in dark — with soft edges rather than
 * a hard outline, and the answer set at reading size. Scoped to the sheet, so
 * the shared markdown look elsewhere is untouched.
 */
const CHAT_SHEET_CSS = `
.vault-chat-sheet {
  display: flex; flex-direction: column; gap: 28px;
  width: 100%; max-width: 64rem; min-height: 100%; margin: 0 auto;
  padding: 28px 40px 36px; box-sizing: border-box;
  border-radius: 20px; background: var(--bai-deep);
  border: 1px solid color-mix(in srgb, var(--bai-border) 70%, transparent);
}
@media (max-width: 640px) { .vault-chat-sheet { padding: 22px 20px 28px; } }
[data-bai-theme="light"] .vault-chat-sheet {
  border-color: color-mix(in srgb, var(--bai-border) 60%, transparent);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 32px -14px rgba(16, 24, 40, 0.16);
}
.vault-chat-sheet .md-preview { font-size: 15.5px; line-height: 1.72; color: var(--bai-text-secondary); }
.vault-chat-sheet .md-preview .md-p { margin: 0 0 12px; line-height: 1.72; }
.vault-chat-sheet .md-preview > :last-child { margin-bottom: 0; }
.vault-chat-sheet .md-preview b, .vault-chat-sheet .md-preview strong { color: var(--bai-text); }
/* Lists keep their bullets: the page's CSS reset strips them, and a list
   without markers reads as loose indented lines. */
.vault-chat-sheet .md-preview .md-list { margin: 0 0 12px; padding-left: 1.4rem; list-style: disc; }
.vault-chat-sheet .md-preview .md-list li { margin: 4px 0; line-height: 1.65; }
.vault-chat-sheet .md-preview .md-list li::marker { color: var(--bai-text-muted); }
/* Links and code had fixed dark-theme colours: about 2:1 and 1.5:1 on white. */
.vault-chat-sheet .md-preview .md-link { color: var(--v-note); }
.vault-chat-sheet .md-preview .md-code-block { background: color-mix(in srgb, var(--bai-hover) 70%, transparent); }
.vault-chat-sheet .md-preview .md-code-block code { color: var(--bai-ok); }
`;


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
  hostManaged,
  openModelSettings,
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
  /** Inside the desktop app: no connection to reset and no model menu, whatever the advice below says. */
  hostManaged: boolean;
  /** Opens the app's model settings; null when the app gave the chat no way to. */
  openModelSettings: (() => void) | null;
}) {
  if (hostManaged) {
    return (
      <HostFailureNotice
        failure={failure}
        openModelSettings={openModelSettings}
      />
    );
  }

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
    case "busy":
      next = (
        <>
          {providerLabel} is busy or slow right now, and asking again did not
          help. Send your message again in a minute.
        </>
      );
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
    <NoticeFrame>
      <p>{plainError(failure.message)}</p>
      {next && <p className="mt-1.5 opacity-80">{next}</p>}
    </NoticeFrame>
  );
}

/**
 * The notice for a failed turn inside the desktop app. The model is the app's,
 * so there is no key to reconnect, no model to pick and no server to allow:
 * whatever went wrong, the one place to fix it is the app's model settings.
 *
 * The gateway's own sentence says what happened and names the provider, so it
 * leads. When the request never got an answer there is no such sentence, and
 * the classifier's stand-in is advice about browser access to a server the
 * user named, which is not what happened here; the notice says it in the app's
 * terms instead.
 *
 * What happened stays in the notice's red; what to do is in the page's own text
 * colour, because it is the one instruction here and must read clearly (the
 * red, dimmed as the browser's second line is, would not).
 */
function HostFailureNotice({
  failure,
  openModelSettings,
}: {
  failure: ChatFailure;
  openModelSettings: (() => void) | null;
}) {
  return (
    <NoticeFrame>
      <p>
        {failure.kind === "unreachable"
          ? "The app's AI model service did not answer."
          : failure.message}
      </p>
      {failure.kind === "busy" ? (
        <p className="mt-1.5" style={{ color: "var(--bai-text-secondary)" }}>
          The AI service is busy or slow right now, and asking again did not
          help. Nothing is wrong with your settings: send your question again
          in a minute.
        </p>
      ) : (
      <p className="mt-1.5">
        <span style={{ color: "var(--bai-text-secondary)" }}>
          Check the AI model in the app&apos;s Settings › Models.
        </span>
        {openModelSettings && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => openModelSettings()}
              className="ml-1 inline-block rounded-md px-2 py-1 font-medium transition-colors hover:bg-[rgba(239,68,68,0.12)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--bai-accent)]"
              style={{
                color: "var(--bai-text)",
                border: "1px solid rgba(239,68,68,0.35)",
              }}
            >
              Open Settings
            </button>
          </>
        )}
      </p>
      )}
    </NoticeFrame>
  );
}

/** The red alert box every failure notice sits in. */
function NoticeFrame({ children }: { children: ReactNode }) {
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
      {children}
    </div>
  );
}
