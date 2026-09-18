import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A yes/no question in the app's modal pattern (dimmed click-catcher, surface
 * panel), through a portal so the list's own positioned elements never paint
 * over it. Esc and a click outside answer "no".
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep going",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 100 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        className="relative z-10 rounded-2xl p-6 shadow-2xl"
        style={{
          width: 420,
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
        <p
          className="mt-2 text-xs"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
            style={
              danger
                ? {
                    backgroundColor: "var(--bai-danger-soft)",
                    color: "var(--bai-danger)",
                    border: "1px solid var(--bai-danger)",
                  }
                : {
                    backgroundColor: "var(--bai-accent)",
                    color: "var(--bai-accent-text)",
                  }
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
