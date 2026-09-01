import { useEffect, useRef, useState } from "react";

/**
 * The pill. Enter sends, Shift+Enter breaks a line; the textarea grows with
 * its content up to a cap so a long question never becomes a scroll-in-a-box.
 * Mid-stream the send button becomes Stop.
 */
export function ChatComposer({
  initialDraft = "",
  placeholder,
  disabled = false,
  streaming = false,
  autoFocus = false,
  onSend,
  onStop,
  onDraftChange,
}: {
  initialDraft?: string;
  placeholder: string;
  disabled?: boolean;
  streaming?: boolean;
  autoFocus?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Lets the parent preserve the draft across the OAuth redirect. */
  onDraftChange?: (text: string) => void;
}) {
  const [value, setValue] = useState(initialDraft);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A draft restored after the redirect arrives after first render.
  useEffect(() => {
    if (initialDraft) setValue(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const canSend = !disabled && !streaming && value.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(value);
    setValue("");
    onDraftChange?.("");
  }

  return (
    <div
      className="flex items-end gap-2 rounded-[28px] py-3 pl-5 pr-3 transition-colors focus-within:border-[var(--bai-accent)]"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          onDraftChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:opacity-60 disabled:opacity-50"
        style={{ color: "var(--bai-text)" }}
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-80"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text)",
          }}
          title="Stop generating"
          aria-label="Stop generating"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-30"
          style={{
            backgroundColor: canSend ? "var(--bai-accent)" : "var(--bai-hover)",
            color: canSend ? "var(--bai-accent-text)" : "var(--bai-text-muted)",
          }}
          title="Send (Enter)"
          aria-label="Send"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
