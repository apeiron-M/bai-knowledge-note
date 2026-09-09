/**
 * Shared atoms for the Access view.
 *
 * `ConfirmButton` and the copy in `LEVEL_MEANING` / `NO_DENY_NOTE` are not
 * decoration — they are the Six Minds audit's non-negotiables in code:
 * destructive actions confirm rather than fire, and the two places this model
 * violates an IAM user's expectations (no deny; open by default) are stated
 * where the decision is made rather than in documentation nobody reads.
 */
import { useState } from "react";
import { LEVEL_RANK, type Level } from "./use-auth-api.js";

export const LEVEL_MEANING: Record<Level, string> = {
  READ: "View every note, source and project here — and everything beneath it.",
  WRITE: "Everything READ allows, plus creating, editing and deleting.",
  ADMIN: "Everything WRITE allows, plus granting and revoking access.",
};

export const NO_DENY_NOTE =
  "This model is allow-only: there is no deny rule. To remove someone's access you revoke their row.";

export const INHERIT_NOTE =
  "Protection and grants inherit downward: a document is protected if it or any ancestor is, and a grant counts if it sits on the document or any ancestor.";

/** Per-operation grants are the one thing that does NOT inherit, and the one
 *  thing whose first write silently changes the rule for everyone else. */
export const OPERATION_FOOTGUN =
  "Granting an operation for the first time restricts it: from then on only the addresses listed here may run it, and this applies to this document only — operation grants do not inherit.";

export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const LEVEL_TONE: Record<Level, string> = {
  READ: "var(--bai-status-review)",
  WRITE: "var(--bai-status-draft)",
  ADMIN: "var(--bai-accent)",
};

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{ backgroundColor: LEVEL_TONE[level], color: "var(--bai-bg)" }}
      title={LEVEL_MEANING[level]}
    >
      {level}
    </span>
  );
}

/** Click-to-copy address chip. An admin's job is to paste these around. */
export function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-xs underline decoration-dotted"
      style={{ color: "var(--bai-text-secondary)" }}
      title={`${address} — click to copy`}
    >
      {copied ? "copied ✓" : short(address)}
    </button>
  );
}

/**
 * Two-step destructive action. `auth-editor` fires Revoke, Unprotect and
 * Transfer ownership on first click with no confirmation; this exists so we
 * do not repeat that.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  disabledReason,
  danger = true,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (disabled) {
    return (
      <span
        className="cursor-not-allowed text-xs opacity-40"
        title={disabledReason}
      >
        {label}
      </span>
    );
  }
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="text-xs underline"
        style={{ color: danger ? "var(--bai-status-archived)" : undefined }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <button
        type="button"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="mr-2 text-xs font-semibold underline"
        style={{ color: "var(--bai-status-archived)" }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs underline opacity-60"
      >
        cancel
      </button>
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
    <div className="flex flex-col gap-1">
      <span
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--bai-text-tertiary)" }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "alarm" | "calm";
}) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor:
          tone === "alarm"
            ? "var(--bai-status-archived)"
            : "var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
      }}
    >
      {children}
    </section>
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
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full rounded-md border px-2 py-1 text-xs"
      style={{
        borderColor: "var(--bai-border)",
        backgroundColor: "var(--bai-bg)",
        color: "var(--bai-text)",
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className={`w-full rounded-md border px-2 py-1 text-xs ${mono ? "font-mono" : ""}`}
      style={{
        borderColor: "var(--bai-border)",
        backgroundColor: "var(--bai-bg)",
        color: "var(--bai-text)",
      }}
    />
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Level)}
      className="rounded-md border px-2 py-1 text-xs"
      style={{
        borderColor: "var(--bai-border)",
        backgroundColor: "var(--bai-bg)",
        color: "var(--bai-text)",
      }}
    >
      {(Object.keys(LEVEL_RANK) as Level[]).map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
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
      className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-40"
      style={{
        backgroundColor: "var(--bai-accent)",
        color: "var(--bai-accent-text)",
      }}
    >
      {children}
    </button>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-md border px-3 py-2 text-sm"
      style={{
        borderColor: "var(--bai-border)",
        color: "var(--bai-text-secondary)",
      }}
    >
      {children}
    </p>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
      {children}
    </p>
  );
}
