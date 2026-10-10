import type { ProgressBar } from "../../lib/intake-model.js";

/**
 * A file's sections as one bar: a tile per section, as wide as the section is
 * long. Kept sections are filled and left-out ones hollow; once added they
 * turn green. In the review the same bar is a map of the file, with the
 * section being read lit, and a click on a tile opens that section.
 *
 * While the file is read, the same place holds `ReadingTrack`. When it is
 * ready the bar splits into these tiles (`split`) — the intake's one animation,
 * so the person sees the file become sections before reading about it.
 */
export function SectionStrip({
  weights,
  kept,
  tone = "ready",
  size = "row",
  here,
  split = false,
  onPick,
}: {
  /** One per section: its length. */
  weights: readonly number[];
  /** One per section: whether it becomes a source. */
  kept: readonly boolean[];
  tone?: "ready" | "added";
  size?: "row" | "map";
  /** The section being read, in the review. */
  here?: number;
  /** The file has just become ready: the bar splits into its sections. */
  split?: boolean;
  onPick?: (index: number) => void;
}) {
  return (
    <div
      className="ik-strip"
      data-tone={tone}
      data-size={size}
      data-split={split ? "" : undefined}
      aria-hidden="true"
    >
      {weights.map((weight, i) => {
        const className =
          [kept[i] === true ? "" : "ik-off", i === here ? "ik-here" : ""]
            .filter(Boolean)
            .join(" ") || undefined;
        const style = { flexGrow: Math.max(weight, 1) };
        return onPick ? (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className={className}
            style={style}
            onClick={() => onPick(i)}
          />
        ) : (
          <i key={i} className={className} style={style} />
        );
      })}
    </div>
  );
}

/**
 * The bar of a file being read. Measured when the service counts pages as it
 * finishes them; otherwise a glow that travels along the track — it shows that
 * work is happening and claims no share of it, so it is never an estimate.
 */
export function ReadingTrack({
  bar,
  label,
}: {
  bar: ProgressBar;
  label: string;
}) {
  const measured = bar.kind === "measured";
  return (
    <div
      className="ik-track"
      role="progressbar"
      aria-label={label}
      {...(measured
        ? {
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(bar.fraction * 100),
          }
        : {})}
    >
      {measured ? (
        <span
          className="ik-track-fill"
          style={{ width: `${bar.fraction * 100}%` }}
        />
      ) : (
        <span className="ik-track-glow" />
      )}
    </div>
  );
}
