import { useState } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { prefetchOnHover } from "../../lib/prefetch.js";
import type { TrailEntry } from "../../hooks/use-chat.js";

// Same buckets SearchView uses, so a hit looks the same in chat as in search.
function similarityColor(score: number): string {
  if (score >= 0.7) return "#10b981";
  if (score >= 0.45) return "#f59e0b";
  return "#6b7280";
}

interface Hit {
  documentId: string;
  title?: string | null;
  similarity?: number;
  noteType?: string | null;
  linkType?: string | null;
}

/** Pull the openable rows out of whatever shape a tool returned. */
function hitsOf(entry: TrailEntry): Hit[] {
  const d = entry.data;
  if (Array.isArray(d)) {
    return d.filter(
      (x): x is Hit =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Hit).documentId === "string",
    );
  }
  if (d && typeof d === "object") {
    const obj = d as {
      outgoing?: Hit[];
      incoming?: Hit[];
      documentId?: string;
      title?: string;
      items?: { id: string; name: string | null }[];
    };
    if (obj.outgoing || obj.incoming)
      return [...(obj.outgoing ?? []), ...(obj.incoming ?? [])];
    if (typeof obj.documentId === "string") return [obj as Hit];
    if (Array.isArray(obj.items))
      return obj.items.map((i) => ({ documentId: i.id, title: i.name }));
  }
  return [];
}

/**
 * The reading trail: one row per tool call, expandable to what it found.
 * This is the one deliberately prominent element in the chat — the vault is
 * a graph, and watching the model walk it is the point.
 */
export function ChatToolTrail({
  trail,
  live,
}: {
  trail: TrailEntry[];
  live: boolean;
}) {
  if (trail.length === 0) return null;
  return (
    <ol className="my-2 space-y-0.5" aria-label="Reading trail">
      {trail.map((entry, i) => (
        <TrailRow
          key={i}
          entry={entry}
          pulse={live && i === trail.length - 1}
        />
      ))}
    </ol>
  );
}

function TrailRow({ entry, pulse }: { entry: TrailEntry; pulse: boolean }) {
  const [open, setOpen] = useState(false);
  const hits = entry.ok ? hitsOf(entry) : [];
  const expandable = hits.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] leading-4 transition-colors enabled:hover:bg-[var(--bai-hover)] disabled:cursor-default"
        style={{ color: entry.ok ? "var(--bai-text-faint)" : "#ef4444" }}
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""} ${pulse ? "animate-pulse" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ opacity: expandable ? 1 : 0.35 }}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="truncate">{entry.summary}</span>
        {expandable && (
          <span className="ml-auto shrink-0 opacity-60">{hits.length}</span>
        )}
      </button>

      {open && (
        <ul
          className="mb-1 ml-5 space-y-px border-l pl-3"
          style={{ borderColor: "var(--bai-border)" }}
        >
          {hits.slice(0, 20).map((h) => (
            <li key={h.documentId}>
              <button
                type="button"
                onClick={() => setSelectedNode(h.documentId)}
                {...prefetchOnHover(h.documentId)}
                className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-[var(--bai-hover)]"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {typeof h.similarity === "number" && (
                  <span
                    className="shrink-0 rounded px-1 font-mono text-[10px] font-semibold"
                    style={{
                      color: similarityColor(h.similarity),
                      backgroundColor: `${similarityColor(h.similarity)}15`,
                    }}
                  >
                    {Math.round(h.similarity * 100)}%
                  </span>
                )}
                {h.linkType && (
                  <span
                    className="shrink-0 rounded px-1 font-mono text-[9px]"
                    style={{
                      backgroundColor: "var(--bai-hover)",
                      color: "var(--bai-text-muted)",
                    }}
                  >
                    {h.linkType}
                  </span>
                )}
                <span className="truncate group-hover:text-[var(--bai-accent)]">
                  {h.title ?? h.documentId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
