import type {
  Agent,
  Deliverable,
  ScopeOfWorkState,
} from "document-models/scope-of-work";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABEL, badgesFor, initials } from "../lib/model.js";

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`chip ${status}`}>{STATUS_LABEL[status] ?? status}</span>
  );
}

export function Badges({
  state,
  deliverable,
}: {
  state: ScopeOfWorkState;
  deliverable: Deliverable;
}) {
  const badges = badgesFor(state, deliverable);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <span
          key={b.kind}
          className={`tag ${b.kind === "unfunded" ? "" : "warn"}`}
        >
          {b.label}
        </span>
      ))}
    </>
  );
}

export function Avatar({
  agent,
  title,
}: {
  agent: Agent | undefined;
  title?: string;
}) {
  if (!agent)
    return (
      <span className="av none" title={title ?? "No owner"}>
        ·
      </span>
    );
  return (
    <span className="av" title={agent.name}>
      {initials(agent.name)}
    </span>
  );
}

export function Bar({ pct, tone }: { pct: number; tone?: "signal" }) {
  return (
    <div className={`bar ${tone ?? ""}`} title={`${Math.round(pct)}%`}>
      <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function Ring({ pct }: { pct: number }) {
  return (
    <span
      className="ring"
      style={{ ["--p" as string]: String(Math.min(100, Math.max(0, pct))) }}
      title={`${Math.round(pct)}%`}
    />
  );
}

export function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub !== undefined && <div className="s">{sub}</div>}
    </div>
  );
}

/** Text that edits in place: commits on blur or Enter, reverts on Escape. */
export function InlineText({
  value,
  onCommit,
  placeholder,
  className,
  multiline,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (multiline && ref.current) {
      ref.current.style.height = "0px";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [draft, multiline]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  if (multiline) {
    return (
      <textarea
        ref={ref}
        className={`inline ${className ?? ""}`}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <input
      className={`inline ${className ?? ""}`}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Accepts only a non-negative number with at most `decimals` decimal places (default 2). */
export const decimalPattern = (decimals: number): RegExp =>
  decimals > 0 ? new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`) : /^\d*$/;

/**
 * Numeric input that commits a parsed number on blur / Enter.
 *
 * An unchanged value commits nothing. An emptied field commits nothing too —
 * and snaps back — UNLESS the caller passes `onClear`, in which case clearing
 * is how a person removes the value (a quote's unit cost, a quantity). Without
 * that hook there was no way to take a number away once entered: the field
 * silently restored the old value on every blur and Enter.
 *
 * `emptyAs` names the stored value that means "nothing here" (0 for a quote),
 * so a cleared field stays visibly empty instead of re-rendering as "0".
 */
export function NumberInput({
  value,
  onCommit,
  onClear,
  emptyAs,
  placeholder,
  className,
  ariaLabel,
  decimals = 2,
}: {
  value: number | null | undefined;
  onCommit: (n: number) => void;
  /** Called when the field is emptied and confirmed; omit to keep "empty = no change". */
  onClear?: () => void;
  /** A stored value to display as an empty field. */
  emptyAs?: number;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  decimals?: number;
}) {
  const isEmptyValue = value == null || (emptyAs !== undefined && value === emptyAs);
  const shown = isEmptyValue ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const pattern = decimalPattern(decimals);
  const commit = () => {
    if (draft.trim() === "" || draft === ".") {
      if (onClear && !isEmptyValue) onClear();
      else setDraft(shown);
      return;
    }
    const n = Number(draft);
    if (Number.isNaN(n)) {
      setDraft(shown);
      return;
    }
    if (n !== value) onCommit(n);
    else setDraft(shown);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`in mono ${className ?? ""}`}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        if (pattern.test(e.target.value)) setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

export function Toast({
  message,
  error,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, error ? 8000 : 2500);
    return () => clearTimeout(t);
  }, [message, error, onClose]);
  return (
    <div
      className={`toast ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

/** Small destructive-action confirm. Esc and scrim cancel; focus starts on Cancel. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Remove",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const buttons = [
        ...boxRef.current.querySelectorAll<HTMLButtonElement>("button"),
      ];
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && globalThis.document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && globalThis.document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div
      className="sow-confirm"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sow-confirm-title"
        aria-describedby="sow-confirm-body"
        className="sow-confirm-box"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sow-confirm-title">{title}</h2>
        <p id="sow-confirm-body">{body}</p>
        <div className="sow-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn confirm-go"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
