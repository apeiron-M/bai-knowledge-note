import { useMemo } from "react";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";
import type { StoredMessage } from "../../lib/chat/chat-storage.js";
import type { TrailEntry } from "../../hooks/use-chat.js";
import { ChatCitation } from "./ChatCitation.js";
import { ChatToolTrail } from "./ChatToolTrail.js";

/**
 * Replace `[[documentId]]` markers with numbered `[n]` markers matching the
 * citation chips below the answer. A raw UUID inline would be noise; a number
 * the reader can follow to a chip is what Gemini-style sources do.
 */
export function numberCitations(
  text: string,
  citations: { documentId: string }[],
): string {
  const index = new Map(citations.map((c, i) => [c.documentId, i + 1]));
  return text.replace(/\[\[([^\]]+?)\]\]/g, (_m, id: string) => {
    const n = index.get(id.trim());
    return n ? ` [${n}]` : "";
  });
}

export function ChatMessage({
  message,
  trail,
  streaming = false,
}: {
  message: StoredMessage;
  /** Only the latest assistant turn carries a live trail. */
  trail?: TrailEntry[];
  streaming?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <AssistantTurn message={message} trail={trail} streaming={streaming} />
  );
}

function AssistantTurn({
  message,
  trail,
  streaming,
}: {
  message: StoredMessage;
  trail?: TrailEntry[];
  streaming: boolean;
}) {
  // Depend on the stored array itself (stable across renders), not a
  // fresh `?? []` fallback that would defeat the memo.
  const citations = message.citations;
  const body = useMemo(
    () => numberCitations(message.content, citations ?? []),
    [message.content, citations],
  );

  return (
    <div className="min-w-0">
      {trail && trail.length > 0 && (
        <ChatToolTrail trail={trail} live={streaming} />
      )}
      {body ? (
        <MarkdownPreview content={body} />
      ) : streaming ? (
        <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
          {trail && trail.length > 0 ? "Reading…" : "Thinking…"}
        </p>
      ) : null}
      {streaming && body && (
        <span
          className="ml-0.5 inline-block h-4 w-[2px] animate-pulse align-text-bottom"
          style={{ backgroundColor: "var(--bai-accent)" }}
          aria-hidden
        />
      )}
      {/* Sources: every document the answer was generated from — the ones
          cited inline (numbered to match the [n] markers) followed by the
          ones the model read in full but did not cite. One row, no
          sub-headings: a reader wants the list, not the taxonomy. */}
      {((citations && citations.length > 0) ||
        (message.consulted && message.consulted.length > 0)) && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
          {(citations ?? []).map((c, i) => (
            <ChatCitation key={c.documentId} index={i + 1} citation={c} />
          ))}
          {(message.consulted ?? []).map((c) => (
            <ChatCitation key={c.documentId} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
}
