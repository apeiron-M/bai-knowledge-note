import { useState } from "react";
import type { SavedConnection } from "../../hooks/use-chat-provider.js";
import type { ProviderKind } from "../../lib/chat/provider.js";

/**
 * Which connection answers: a small menu in the chat header listing every
 * connection this browser remembers, so switching from a local model to
 * OpenRouter (or back) is one click, never a disconnect. "Add another…"
 * returns to the connect screen without forgetting anything.
 */
export function EndpointPicker({
  active,
  label,
  saved,
  onSwitch,
  onAdd,
}: {
  active: ProviderKind | null;
  label: string;
  saved: SavedConnection[];
  onSwitch: (kind: ProviderKind) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[240px] items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
        style={{ color: "var(--bai-text-tertiary)" }}
        title="Which model endpoint answers"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--bai-accent)" }}
          aria-hidden
        />
        <span className="truncate">{label}</span>
        <svg
          className="h-3 w-3 shrink-0 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 flex w-72 flex-col rounded-lg py-1 shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            <p
              className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--bai-text-faint)" }}
            >
              Answering with
            </p>
            {saved.map((c) => {
              const selected = c.kind === active;
              return (
                <button
                  key={c.kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSwitch(c.kind);
                    setOpen(false);
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bai-hover)]"
                  style={{
                    color: selected ? "var(--bai-accent)" : "var(--bai-text-secondary)",
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.model && (
                    <span
                      className="max-w-[120px] shrink-0 truncate font-mono text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {c.model}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAdd();
                setOpen(false);
              }}
              className="mt-1 flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bai-hover)]"
              style={{ borderColor: "var(--bai-border)", color: "var(--bai-text-muted)" }}
            >
              + Add another endpoint…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
