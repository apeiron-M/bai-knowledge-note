/**
 * One file's coordinates on the way to the goal: Chosen → Converted →
 * Reviewed → In the vault. Every row carries one, so the user never has to
 * infer the process from a status word. `reached` steps are done, `now` is
 * in progress (or where it halted, when `halted`).
 */
/** What each step is called while it is happening, and once it is done. */
export const JOURNEY_LABELS: readonly { now: string; done: string }[] = [
  { now: "Choosing", done: "Chosen" },
  { now: "Converting…", done: "Converted" },
  { now: "In review", done: "Reviewed" },
  { now: "Adding…", done: "In the vault" },
];

export const JOURNEY_STEPS = [
  "Chosen",
  "Converted",
  "Reviewed",
  "In the vault",
] as const;

export function JourneyStrip({
  reached,
  now,
  halted = false,
  size = "sm",
}: {
  /** How many steps are complete (0–4). */
  reached: number;
  /** The step in progress, or where the file halted. */
  now: number;
  halted?: boolean;
  size?: "sm" | "lg";
}) {
  const dotPx = size === "lg" ? 10 : 7;
  const text = size === "lg" ? "text-xs" : "text-[10px]";
  const gap = size === "lg" ? "w-7" : "w-3.5";
  return (
    <span
      className={`journey inline-flex items-center whitespace-nowrap ${text}`}
      aria-label="progress"
    >
      {JOURNEY_STEPS.map((label, i) => {
        const past = i < reached;
        const current = i === now && !past;
        const color = past
          ? "var(--bai-ok)"
          : current
            ? halted
              ? "var(--bai-danger)"
              : "var(--bai-accent)"
            : "transparent";
        const border = past
          ? "var(--bai-ok)"
          : current
            ? halted
              ? "var(--bai-danger)"
              : "var(--bai-accent)"
            : "var(--bai-text-faint)";
        const labelColor = current
          ? halted
            ? "var(--bai-danger)"
            : "var(--bai-accent)"
          : past
            ? "var(--bai-text-muted)"
            : "var(--bai-text-faint)";
        return (
          <span key={label} className="inline-flex items-center">
            <i
              className="mr-1 inline-block rounded-full"
              style={{
                width: dotPx,
                height: dotPx,
                backgroundColor: color,
                border: `1px solid ${border}`,
                boxShadow:
                  current && !halted
                    ? "0 0 0 3px var(--bai-accent-soft)"
                    : undefined,
              }}
            />
            <b className="font-medium" style={{ color: labelColor }}>
              {current && !halted ? JOURNEY_LABELS[i].now : label}
            </b>
            {i < JOURNEY_STEPS.length - 1 && (
              <s
                className={`${gap} mx-1 inline-block h-px no-underline`}
                style={{ backgroundColor: "var(--bai-border)" }}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
