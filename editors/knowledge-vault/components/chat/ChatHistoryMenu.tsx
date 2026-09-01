import { useState } from "react";
import type { Thread } from "../../lib/chat/chat-storage.js";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

/**
 * Recent threads for this drive. Same click-catcher idiom as CreateMenu and
 * SettingsMenu in DriveExplorer: a fixed sibling closes the menu, the panel
 * sits above it, no document listener to leak.
 */
export function ChatHistoryMenu({
  threads,
  currentId,
  onOpen,
  onDelete,
}: {
  threads: Thread[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (threads.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
        style={{ color: "var(--bai-text-tertiary)" }}
        title="Recent chats"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        Recent
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute left-0 z-20 mt-1 max-h-80 w-72 overflow-auto rounded-lg py-1 shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            {threads.map((t) => {
              const current = t.id === currentId;
              return (
                <div key={t.id} className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onOpen(t.id);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 flex-col rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bai-hover)]"
                    style={{
                      color: current
                        ? "var(--bai-accent)"
                        : "var(--bai-text-secondary)",
                    }}
                  >
                    <span className="truncate text-xs">{t.title}</span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {relativeTime(t.updatedAt)} · {t.messages.length} message
                      {t.messages.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-[var(--bai-hover)] group-hover:opacity-100 focus:opacity-100"
                    style={{ color: "var(--bai-text-muted)" }}
                    title="Delete chat"
                    aria-label={`Delete chat "${t.title}"`}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
