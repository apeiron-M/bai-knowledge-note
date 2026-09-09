/**
 * The Access view's design primitives.
 *
 * These carry the Six Minds audit's non-negotiables in code rather than in
 * documentation: destructive actions confirm before they fire, and the two
 * places this model contradicts an IAM user's expectations — no deny rule, and
 * inheritance flowing downward — are stated where the decision is made.
 *
 * Everything is expressed in the app's own `--bai-*` tokens so both themes
 * follow automatically. Note that `--bai-status-*` describes a *note's
 * lifecycle*, not a consequence, so destructive UI uses `--bai-danger`
 * (added for this view) rather than `--bai-status-archived`, which is grey.
 */
import { useState } from "react";
import { LEVEL_RANK, type Level } from "./use-auth-api.js";

/* ── copy the audit requires ────────────────────────────────────── */

export const LEVEL_MEANING: Record<Level, string> = {
  READ: "View every note, source and project here — and everything beneath it.",
  WRITE: "Everything READ allows, plus creating, editing and deleting.",
  ADMIN: "Everything WRITE allows, plus granting and revoking access.",
};

export const NO_DENY_NOTE =
  "Allow-only — there is no deny rule. To remove access you revoke the row.";

export const INHERIT_NOTE =
  "Protection and grants inherit downward: a document counts as protected if it or any ancestor is, and a grant applies if it sits on the document or any ancestor.";

export const OPERATION_FOOTGUN =
  "Granting an operation for the first time restricts it: from then on only the addresses listed here may run it. This applies to this document alone — operation grants do not inherit.";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/* ── layout ─────────────────────────────────────────────────────── */

export function Card({
  children,
  tone,
  className = "",
}: {
  children: React.ReactNode;
  tone?: "alarm" | "warn" | "ok";
  className?: string;
}) {
  const accent =
    tone === "alarm"
      ? "var(--bai-danger)"
      : tone === "warn"
        ? "var(--bai-warn)"
        : tone === "ok"
          ? "var(--bai-ok)"
          : undefined;
  return (
    <section
      className={`rounded-xl border p-5 ${className}`}
      style={{
        borderColor: accent ?? "var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
        // A hairline of colour on the left reads as severity without tinting
        // the whole panel, which would fight the text contrast.
        boxShadow: accent ? `inset 3px 0 0 0 ${accent}` : undefined,
      }}
    >
      {children}
    </section>
  );
}

/** A nested block. Uses `--bai-deep` to sit *below* the card it lives in. */
export function Inset({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${className}`}
      style={{
        borderColor: "var(--bai-border)",
        backgroundColor: "var(--bai-deep)",
      }}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle ? (
          <p
            className="mt-0.5 text-xs leading-relaxed"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: "var(--bai-text-muted)" }}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs leading-relaxed"
      style={{ color: "var(--bai-text-muted)" }}
    >
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-8 text-center"
      style={{ borderColor: "var(--bai-border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--bai-text-secondary)" }}>
        {title}
      </p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}

/* ── data display ───────────────────────────────────────────────── */

const LEVEL_TONE: Record<Level, { fg: string; bg: string }> = {
  READ: { fg: "var(--bai-status-review)", bg: "rgba(59, 130, 246, 0.14)" },
  WRITE: { fg: "var(--bai-warn)", bg: "var(--bai-warn-soft)" },
  ADMIN: { fg: "var(--bai-accent)", bg: "var(--bai-accent-soft)" },
};

export function LevelBadge({ level }: { level: Level }) {
  const tone = LEVEL_TONE[level];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{ color: tone.fg, backgroundColor: tone.bg }}
      title={LEVEL_MEANING[level]}
    >
      {level}
    </span>
  );
}

export function SeverityPill({
  severity,
}: {
  severity: "critical" | "warning" | "ok";
}) {
  const map = {
    critical: { fg: "var(--bai-danger)", bg: "var(--bai-danger-soft)", label: "Critical" },
    warning: { fg: "var(--bai-warn)", bg: "var(--bai-warn-soft)", label: "Warning" },
    ok: { fg: "var(--bai-ok)", bg: "var(--bai-ok-soft)", label: "Healthy" },
  }[severity];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: map.fg, backgroundColor: map.bg }}
    >
      {map.label}
    </span>
  );
}

/** Click-to-copy address. An admin's job is largely pasting these around. */
export function AddressChip({
  address,
  you,
}: {
  address: string;
  you?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded-md px-1.5 py-0.5 font-mono text-xs transition-colors"
        style={{
          color: copied ? "var(--bai-ok)" : "var(--bai-text-secondary)",
          backgroundColor: "var(--bai-hover)",
        }}
        title={`${address} — click to copy`}
      >
        {copied ? "copied ✓" : short(address)}
      </button>
      {you ? (
        <span className="text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
          you
        </span>
      ) : null}
    </span>
  );
}

export function Row({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`group flex items-center gap-3 border-t px-1 py-2.5 transition-colors ${className}`}
      style={{ borderColor: "var(--bai-border)" }}
    >
      {children}
    </div>
  );
}

/* ── controls ───────────────────────────────────────────────────── */

const INPUT_STYLE: React.CSSProperties = {
  borderColor: "var(--bai-border)",
  backgroundColor: "var(--bai-bg)",
  color: "var(--bai-text)",
};

const INPUT_CLASS =
  "w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors focus:border-transparent focus:ring-2";

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mono?: boolean;
  list?: string;
}) {
  return (
    <input
      value={value}
      list={list}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className={`${INPUT_CLASS} ${mono ? "font-mono" : ""}`}
      style={{ ...INPUT_STYLE, ["--tw-ring-color" as string]: "var(--bai-accent)" }}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs"
        style={{ color: "var(--bai-text-muted)" }}
      >
        ⌕
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`${INPUT_CLASS} pl-8`}
        style={{ ...INPUT_STYLE, ["--tw-ring-color" as string]: "var(--bai-accent)" }}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border px-3 py-2 text-xs outline-none transition-colors focus:ring-2"
      style={{ ...INPUT_STYLE, ["--tw-ring-color" as string]: "var(--bai-accent)" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function LevelSelect({
  value,
  onChange,
}: {
  value: Level;
  onChange: (v: Level) => void;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      ariaLabel="Access level"
      options={(Object.keys(LEVEL_RANK) as Level[]).map((l) => ({
        value: l,
        label: l,
      }))}
    />
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: "var(--bai-accent)",
        color: "var(--bai-accent-text)",
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: tone === "danger" ? "var(--bai-danger)" : "var(--bai-border)",
        color: tone === "danger" ? "var(--bai-danger)" : "var(--bai-text-secondary)",
        backgroundColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Two-step destructive action. `auth-editor` fires Revoke, Unprotect and
 * Transfer ownership on the first click with no confirmation; this exists
 * precisely so we do not repeat that.
 *
 * When disabled it stays visible with its reason in the title, because a
 * control that vanishes teaches nothing — and the reason here is usually
 * "this would lock you out", which the admin needs to read.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  disabledReason,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [armed, setArmed] = useState(false);

  if (disabled) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1 text-xs opacity-50"
        style={{ color: "var(--bai-text-muted)" }}
        title={disabledReason}
      >
        {disabledReason ? <span aria-hidden>🔒</span> : null}
        {label}
      </span>
    );
  }
  if (!armed) {
    return <GhostButton tone="danger" onClick={() => setArmed(true)}>{label}</GhostButton>;
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <button
        type="button"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="rounded-md px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--bai-danger)", color: "var(--bai-bg)" }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs underline"
        style={{ color: "var(--bai-text-muted)" }}
      >
        cancel
      </button>
    </span>
  );
}

/** Inline preview / validation / result line. Tone carries the meaning. */
export function Callout({
  tone,
  children,
}: {
  tone: "info" | "danger" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const map = {
    info: { fg: "var(--bai-accent)", bg: "var(--bai-accent-soft)" },
    danger: { fg: "var(--bai-danger)", bg: "var(--bai-danger-soft)" },
    warn: { fg: "var(--bai-warn)", bg: "var(--bai-warn-soft)" },
    ok: { fg: "var(--bai-ok)", bg: "var(--bai-ok-soft)" },
  }[tone];
  return (
    <p
      className="mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed"
      style={{ color: map.fg, backgroundColor: map.bg }}
    >
      {children}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <Callout tone="info">{children}</Callout>;
}
