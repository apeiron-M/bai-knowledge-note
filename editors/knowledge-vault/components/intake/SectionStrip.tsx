import type { ProgressBar } from "../../lib/intake-model.js";

/** One tile of the bar: a section, or — in a long file — a run of neighbouring sections. */
export type StripTile = {
  /** The text it stands for, for its width. */
  weight: number;
  /** All its sections kept, none, some — or all already in the vault. */
  state: "on" | "off" | "mixed" | "in";
  /** The first and last section it stands for. */
  first: number;
  last: number;
};

/** The most tiles a bar draws: past this a file's sections are grouped, so the bar fits its width. */
export const MAX_TILES = { row: 36, map: 60 } as const;

/**
 * The bar's tiles: one per section while they fit, else runs of neighbouring
 * sections, as even in count as can be. A 922-section book drew 922 tiles of at
 * least 8 px each — a bar thousands of pixels wide that pushed the whole view
 * sideways; grouped, it keeps the file's shape at the width it has.
 */
export function stripTiles(
  weights: readonly number[],
  kept: readonly boolean[],
  maxTiles: number,
  present?: readonly boolean[],
): StripTile[] {
  const n = weights.length;
  const groups = Math.max(1, Math.min(n, maxTiles));
  const tiles: StripTile[] = [];
  for (let g = 0; g < groups; g++) {
    const first = Math.floor((g * n) / groups);
    const last = Math.floor(((g + 1) * n) / groups) - 1;
    let weight = 0;
    let on = 0;
    let there = 0;
    for (let i = first; i <= last; i++) {
      weight += Math.max(weights[i] ?? 0, 1);
      if (kept[i] === true) on += 1;
      else if (present?.[i] === true) there += 1;
    }
    const count = last - first + 1;
    const state =
      there === count ? "in" : on === count ? "on" : on === 0 && there === 0 ? "off" : "mixed";
    tiles.push({ weight, state, first, last });
  }
  return tiles;
}

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
  present,
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
  /** One per section: already in the vault, from an earlier add (drawn as added). */
  present?: readonly boolean[];
  tone?: "ready" | "added";
  size?: "row" | "map";
  /** The section being read, in the review. */
  here?: number;
  /** The file has just become ready: the bar splits into its sections. */
  split?: boolean;
  onPick?: (index: number) => void;
}) {
  const tiles = stripTiles(weights, kept, MAX_TILES[size], present);
  const grouped = tiles.length < weights.length;
  return (
    <div
      className="ik-strip"
      data-tone={tone}
      data-size={size}
      data-split={split ? "" : undefined}
      data-grouped={grouped ? "" : undefined}
      aria-hidden="true"
    >
      {tiles.map((tile) => {
        const lit = here !== undefined && here >= tile.first && here <= tile.last;
        const className =
          [
            tile.state === "off" ? "ik-off" : tile.state === "mixed" ? "ik-mixed" : tile.state === "in" ? "ik-in" : "",
            lit ? "ik-here" : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined;
        const style = { flexGrow: tile.weight };
        return onPick ? (
          <button
            key={tile.first}
            type="button"
            tabIndex={-1}
            className={className}
            style={style}
            onClick={() => onPick(tile.first)}
          />
        ) : (
          <i key={tile.first} className={className} style={style} />
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
