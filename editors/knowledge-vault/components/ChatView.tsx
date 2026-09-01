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
 * Everything runs in the browser: the model via OpenRouter, the data via the
 * same Switchboard endpoints the search field uses. Nothing here can write.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useVaultName } from "../hooks/use-vault-name.js";
import { useOpenRouter } from "../hooks/use-openrouter.js";
import { useChat } from "../hooks/use-chat.js";
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
import { ModelPicker } from "./chat/ModelPicker.js";

interface Orientation {
  stats: { nodeCount: number; edgeCount: number } | null;
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

export function ChatView({ initialDraft = "" }: { initialDraft?: string }) {
  const driveId = useSelectedDriveId();
  const vaultName = useVaultName();
  const or = useOpenRouter();
  const orientation = useOrientation(driveId, or.isConnected);
  const [draft, setDraft] = useState(initialDraft);

  const systemPrompt = useMemo(
    () =>
      buildSystemPrompt({
        vaultName,
        stats: orientation.stats,
        topics: orientation.topics,
      }),
    [vaultName, orientation.stats, orientation.topics],
  );

  const chat = useChat({ driveId, key: or.key, model: or.model, systemPrompt });
  const inConversation = chat.messages.length > 0 || chat.isStreaming;

  // Follow the stream, but only if the user is already near the bottom —
  // scrolling someone away from an earlier answer they are reading is rude.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streamingText, chat.trail]);

  if (!driveId) return null;

  if (!or.isConnected) {
    return (
      <div className="flex h-full flex-col overflow-auto p-4">
        <ChatConnectPanel
          vaultName={vaultName}
          busy={or.isCompletingOAuth}
          onConnect={() => void or.connect({ driveId, draft })}
          onConnectWithKey={or.connectWithKey}
        />
      </div>
    );
  }

  const composer = (
    <ChatComposer
      initialDraft={initialDraft}
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
          <ModelPicker
            model={or.model}
            models={or.models}
            loading={or.modelsLoading}
            fellBack={or.modelFellBack}
            onChange={or.setModel}
          />
          <button
            type="button"
            onClick={or.disconnect}
            className="rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
            style={{ color: "var(--bai-text-muted)" }}
            title="Remove the OpenRouter key from this browser"
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
                <ChatMessage key={i} message={m} />
              ))}
              {chat.isStreaming && (
                <ChatMessage
                  message={{ role: "assistant", content: chat.streamingText }}
                  trail={chat.trail}
                  streaming
                />
              )}
              {!chat.isStreaming &&
                chat.trail.length > 0 &&
                chat.messages.at(-1)?.role === "assistant" && (
                  <TrailFooter count={chat.trail.length} />
                )}
              {chat.error && (
                <div
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{
                    backgroundColor: "rgba(239,68,68,0.08)",
                    color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.25)",
                  }}
                  role="alert"
                >
                  {chat.error}
                </div>
              )}
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="mx-auto w-full max-w-3xl">{composer}</div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4 pb-16">
          <div className="motion-safe:animate-[fadeUp_.4s_ease-out] flex w-full max-w-3xl flex-col items-center">
            <h1
              className="text-center text-3xl font-semibold tracking-tight sm:text-4xl"
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
                ? `${orientation.stats.nodeCount.toLocaleString()} notes · ${orientation.stats.edgeCount.toLocaleString()} links · read-only`
                : "Answers come from the vault's own notes, with citations you can open."}
            </p>

            <div className="mt-8 w-full">{composer}</div>

            <div className="mt-6 flex min-h-8 flex-wrap justify-center gap-2">
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
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
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
