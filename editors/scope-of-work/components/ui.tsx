import type {
  Agent,
  Deliverable,
  ScopeOfWorkState,
} from "document-models/scope-of-work";
import {
  useEffect,
  useRef,
  useState,
  // Aliased: ConfirmDialog below binds a real `keydown` listener and needs
  // the DOM KeyboardEvent, which a bare `type KeyboardEvent` import shadows.
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { STATUS_LABEL, badgesFor, initials, money, moneyAmount } from "../lib/model.js";

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

const COPIED_FEEDBACK_MS = 1_200;

/**
 * A document id, small and monospaced, that copies itself on click.
 *
 * The id is the handle for everything outside this editor — an envelope's
 * `wbsRef`, a `switchboard docs get`, a GraphQL query — so it is shown in
 * full rather than truncated: a half-shown uuid cannot be checked against
 * the one someone is holding, and copy is the whole point of showing it.
 *
 * Two details are load-bearing. It renders inside `.eyebrow`, whose
 * `text-transform:uppercase` would mangle a uuid, so `.doc-id` resets it.
 * And `navigator.clipboard` is typed non-nullable but is absent over plain
 * http, so the guard is real rather than defensive — without it the click
 * throws instead of doing nothing.
 */
export function CopyableId({
  id,
  label = "Document id",
}: {
  id: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (e: ReactMouseEvent | ReactKeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (!clipboard) return;
    void clipboard.writeText(id).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  };

  if (!id) return null;

  return (
    <span
      role="button"
      tabIndex={0}
      className="doc-id"
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") copy(e);
      }}
      title={`${label}\n${id}\n\nClick to copy`}
      aria-label={`${label} ${id} \u2014 click to copy`}
      data-copied={copied ? "" : undefined}
    >
      <span className="doc-id-text">{id}</span>
      <svg
        className="doc-id-icon"
        viewBox="0 0 14 14"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {copied ? (
          <polyline points="2.5,7.5 5.5,10.5 11.5,4" />
        ) : (
          <>
            <rect x="4.75" y="4.75" width="7.5" height="7.5" rx="1.5" />
            <path d="M9.25 2.25H3.25a1.5 1.5 0 0 0-1.5 1.5v6" />
          </>
        )}
      </svg>
      <span className="doc-id-said" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}

/**
 * Money in one or several currencies.
 *
 * One currency is the common case and stays a single figure. Several stack as
 * a two-column grid — amount, then code — instead of one string joined with
 * middle dots: a joined string wraps wherever the box runs out, leaving the
 * separators dangling at line ends, and at KPI size four currencies became
 * four lines of 26px type. Amounts are right-aligned tabular numerals so the
 * decimals line up; the code sits small and faint beside each.
 */
export function MoneyStack({ byCur }: { byCur: Record<string, number> }) {
  const entries = Object.entries(byCur);
  if (entries.length === 0) return <span className="faint">—</span>;
  if (entries.length === 1) return <>{money(entries[0][1], entries[0][0])}</>;
  return (
    <span className="money-stack" role="list">
      {entries.map(([cur, v]) => (
        <span key={cur} role="listitem" className="money-row">
          <span className="amt">{moneyAmount(v)}</span>
          <span className="cur">{cur}</span>
        </span>
      ))}
    </span>
  );
}
