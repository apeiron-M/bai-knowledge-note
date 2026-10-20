/**
 * Shared primitives for the vault-config sections.
 *
 * Every section is a titled card over `--bai-surface`, and every field is a
 * small labelled control writing on blur/change. Factoring those two shapes
 * out keeps each section file about its own operation rather than about
 * repeating chrome. Visual language is deliberately the one the other twelve
 * editors already use — this panel should read as part of the vault, not as a
 * separate app.
 */
import type { ReactNode } from "react";

/** ISO timestamp for the `updatedAt` every config action carries. */
export function ts(): string {
  return new Date().toISOString();
}

/**
 * Fallback label for a state key with no human name registered.
 *
 * Prefer an explicit label: a key like `mocOversize` prettifies to "Moc
 * oversize", which names the field the way the schema does rather than the way
 * a reader thinks about it. This exists so a threshold added to the model still
 * renders something legible before someone writes it a proper name.
 */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function Card({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  /** One line under the title saying what these controls govern. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        {title}
      </h3>
      {hint && (
        <p
          className="mt-1 text-[10px] leading-relaxed"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {hint}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Shared input/select styling — a `--bai-deep` well inside a surface card. */
export const controlStyle = {
  backgroundColor: "var(--bai-deep)",
  color: "var(--bai-text-secondary)",
  border: "1px solid var(--bai-border)",
} as const;

export const controlClass =
  "rounded px-2 py-1 text-xs outline-none focus:border-[#cba6f7]/50";

/**
 * Label, right-aligned control, and an optional unit.
 *
 * The unit sits outside the input so a bare number always carries what it
 * counts — "30" beside "days" rather than a field the reader has to guess at.
 */
export function Row({
  label,
  unit,
  why,
  children,
}: {
  label: string;
  unit?: string;
  /**
   * What this setting is for. Shown on hover rather than always: seven of
   * these expanded inline would bury the numbers they explain, and the label
   * already carries the everyday meaning.
   */
  why?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span
        style={{ color: "var(--bai-text-tertiary)" }}
        title={why}
        className={
          why
            ? "cursor-help underline decoration-dotted underline-offset-4"
            : undefined
        }
      >
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {children}
        {unit && (
          <span
            className="w-12 text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/** Empty state: says what is missing and what adding one will do. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[11px] leading-relaxed"
      style={{ color: "var(--bai-text-faint)" }}
    >
      {children}
    </p>
  );
}
