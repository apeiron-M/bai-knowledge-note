import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { prefetchOnHover } from "../../lib/prefetch.js";
import type { Citation } from "../../lib/chat/chat-storage.js";

/**
 * A citation is a door, not a footnote: clicking opens the actual note in the
 * vault. Numbered to match the `[n]` markers rendered inline in the answer.
 */
export function ChatCitation({
  index,
  citation,
}: {
  index: number;
  citation: Citation;
}) {
  return (
    <button
      type="button"
      onClick={() => setSelectedNode(citation.documentId)}
      {...prefetchOnHover(citation.documentId)}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-[11px] leading-5 transition-colors hover:bg-[var(--bai-accent-soft)]"
      style={{
        backgroundColor: "var(--bai-hover)",
        color: "var(--bai-text-secondary)",
        border: "1px solid var(--bai-border)",
      }}
      title={`Open "${citation.title}"`}
    >
      <span
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold"
        style={{
          backgroundColor: "var(--bai-accent)",
          color: "var(--bai-accent-text)",
        }}
      >
        {index}
      </span>
      <span className="truncate group-hover:text-[var(--bai-accent)]">
        {citation.title}
      </span>
    </button>
  );
}
