/**
 * A confirmation for what cannot be undone: the person types the name of the
 * thing that goes — a scope of work's title — before the button that deletes
 * it wakes. In the app's modal pattern (dimmed click-catcher, surface panel,
 * through a portal so nothing in the list paints over it); Esc and a click
 * outside cancel, except while the deletion is under way.
 *
 * Reads in the order the decision is made: what goes, what stays, the name
 * to type, then the two buttons — the destructive one last and red.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A bin, drawn like the vault's own icons: 24px grid, 1.75 stroke, round caps. */
export function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
    </svg>
  );
}

/** Whether what was typed names it: spaces around and case aside, the same words. */
export function namesIt(typed: string, name: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) !== "" && norm(typed) === norm(name);
}

type DialogProps = {
  /** "Delete “Vault operations 2027”?" */
  title: string;
  /** What goes and what stays. */
  children: ReactNode;
  /** What the person types to confirm. */
  name: string;
  /** "the scope's title" — what `name` is, in the prompt above the field. */
  nameLabel: string;
  confirmLabel: string;
  busyLabel: string;
  /** Why the deletion was refused, in words for the person. */
  error?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The dialog, through a portal over everything else, with Esc to cancel. */
export function TypeToConfirmDialog(props: DialogProps) {
  const { busy = false, onCancel } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);
  return createPortal(<TypeToConfirmPanel {...props} />, document.body);
}

/** What the dialog shows — apart from the portal, so it renders anywhere, tests included. */
export function TypeToConfirmPanel({ title, children, name, nameLabel, confirmLabel, busyLabel, error, busy = false, onConfirm, onCancel, initialTyped = "" }: DialogProps & { initialTyped?: string }) {
  const [typed, setTyped] = useState(initialTyped);
  const headingId = useId();
  const bodyId = useId();
  const fieldId = useId();
  const ready = namesIt(typed, name) && !busy;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 100 }} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={bodyId}>
      <div className="absolute inset-0 bg-black/60" onClick={busy ? undefined : onCancel} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm();
        }}
        className="relative z-10 w-full rounded-2xl p-6 shadow-2xl"
        style={{ maxWidth: 440, backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
      >
        <h3 id={headingId} className="text-[15px] font-semibold leading-snug" style={{ color: "var(--bai-text)" }}>
          {title}
        </h3>
        <div id={bodyId} className="mt-2 space-y-2 text-[13px] leading-relaxed" style={{ color: "var(--bai-text-secondary)" }}>
          {children}
        </div>
        <label htmlFor={fieldId} className="mt-5 block text-[12.5px]" style={{ color: "var(--bai-text-secondary)" }}>
          To confirm, type {nameLabel}:{" "}
          <span className="font-semibold" style={{ color: "var(--bai-text)" }}>
            {name}
          </span>
        </label>
        <input
          id={fieldId}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={typed}
          disabled={busy}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-2 w-full rounded-lg px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-danger)]"
          style={{ backgroundColor: "var(--bai-deep)", border: "1px solid var(--bai-border)", color: "var(--bai-text)" }}
        />
        {error && (
          <p role="alert" className="mt-3 text-[12.5px] leading-snug" style={{ color: "var(--bai-danger)" }}>
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bai-hover)] disabled:opacity-50"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: "var(--bai-danger-soft)", color: "var(--bai-danger)", border: "1px solid var(--bai-danger)" }}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
