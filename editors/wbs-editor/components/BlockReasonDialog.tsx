import { useEffect, useRef, useState } from "react";

type BlockReasonDialogProps = {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  required: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

/**
 * Generic single-textarea confirmation dialog. Used both for the BLOCKED
 * status prompt (required, non-empty reason) and the COMPLETED status
 * prompt (optional outcome notes) — the two StatusChipMenu call sites
 * differ only in the `required` flag and copy.
 */
export function BlockReasonDialog({
  open,
  title,
  label,
  placeholder,
  required,
  confirmLabel,
  onCancel,
  onConfirm,
}: BlockReasonDialogProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = value.trim();
  const canSubmit = !required || trimmed.length > 0;

  function handleConfirm() {
    if (!canSubmit) return;
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        className="relative z-10 w-[400px] rounded-2xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {title}
        </h3>
        <label
          className="mt-4 block text-xs font-medium"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          {label}
        </label>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="mt-1.5 w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-secondary)",
            border: "1px solid var(--bai-border)",
          }}
        />
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleConfirm}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:opacity-80 disabled:opacity-40"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
