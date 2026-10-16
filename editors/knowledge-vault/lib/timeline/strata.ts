/**
 * The strata: the vault's notes over time, in layers by the addition they
 * came from — oldest addition at the bottom, each layer thickening as its
 * notes arrive. Runs of consecutive small additions are drawn as one layer,
 * so a year of daily feeds reads as a few bands, not hundreds of hairlines.
 */
import type { TimelineAddition, TimelineArrival } from "../../../../processors/graph-indexer/source-timeline.js";
import { ROUTE_LABEL, ROUTE_WORDS, routeOf, type Route } from "./additions.js";
import { formatter, type FoldedAxis, type TimeWords } from "./axis.js";

export interface StrataLayer {
  /** The addition's id, or `run:<first addition id>` for a merged run. */
  key: string;
  additionIds: string[];
  title: string;
  /** Its notes' arrival times, ascending (ms). */
  times: number[];
  run: boolean;
}

/** An addition under this share of all notes is "small"; two or more in a row merge. */
export const RUN_SHARE = 0.025;

export function strataLayers(
  additions: readonly TimelineAddition[],
  notes: readonly TimelineArrival[],
  o: TimeWords & { mergeBelow?: number } = {},
): StrataLayer[] {
  const timesBy = new Map<string, number[]>();
  for (const n of notes) {
    if (!n.additionId || !n.addedAt) continue;
    const t = Date.parse(n.addedAt);
    if (!Number.isFinite(t)) continue;
    const list = timesBy.get(n.additionId) ?? [];
    list.push(t);
    timesBy.set(n.additionId, list);
  }
  for (const list of timesBy.values()) list.sort((a, b) => a - b);
  const ordered = additions
    .filter((a) => (timesBy.get(a.id)?.length ?? 0) > 0)
    .sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt));
  const total = ordered.reduce((s, a) => s + (timesBy.get(a.id)?.length ?? 0), 0);
  const small = (a: TimelineAddition) => (timesBy.get(a.id)?.length ?? 0) / total < (o.mergeBelow ?? RUN_SHARE);

  const layers: StrataLayer[] = [];
  let run: TimelineAddition[] = [];
  const single = (a: TimelineAddition): StrataLayer => ({ key: a.id, additionIds: [a.id], title: a.title, times: timesBy.get(a.id) ?? [], run: false });
  const flush = () => {
    if (run.length >= 2) {
      layers.push({
        key: `run:${run[0].id}`,
        additionIds: run.map((a) => a.id),
        title: runTitle(run, timesBy, o),
        times: run.flatMap((a) => timesBy.get(a.id) ?? []).sort((a, b) => a - b),
        run: true,
      });
    } else layers.push(...run.map(single));
    run = [];
  };
  for (const a of ordered) {
    if (small(a)) run.push(a);
    else {
      flush();
      layers.push(single(a));
    }
  }
  flush();
  return layers;
}

/** "Mostly feeds, Oct 11 to Oct 14", or "Files and text, …" when no route holds 60 %. */
function runTitle(run: readonly TimelineAddition[], timesBy: Map<string, number[]>, o: TimeWords): string {
  const by = new Map<Route, number>();
  let total = 0;
  for (const a of run) {
    const n = timesBy.get(a.id)?.length ?? 0;
    by.set(routeOf(a), (by.get(routeOf(a)) ?? 0) + n);
    total += n;
  }
  const top = [...by].sort((a, b) => b[1] - a[1]);
  const lead =
    top[0][1] / total > 0.6 || top.length === 1
      ? `Mostly ${ROUTE_WORDS[top[0][0]]}`
      : `${ROUTE_LABEL[top[0][0]]} and ${ROUTE_WORDS[top[1][0]]}`;
  const day = formatter(o, { month: "short", day: "numeric" });
  return `${lead}, ${day.format(Date.parse(run[0].addedAt))} to ${day.format(Date.parse(run[run.length - 1].addedAt))}`;
}

export interface StrataBand {
  layer: StrataLayer;
  /** Cumulative notes below and at the top of the band, per sample. */
  lo: number[];
  hi: number[];
}

export interface StrataStack {
  /** Sample positions (px), every `step` px, ending at the axis width. */
  xs: number[];
  step: number;
  bands: StrataBand[];
  /** Notes in the vault at the last sample. */
  max: number;
}

function countUpTo(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function stackStrata(layers: readonly StrataLayer[], ax: FoldedAxis, step = 3): StrataStack {
  const xs: number[] = [];
  for (let x = 0; x < ax.width; x += step) xs.push(x);
  xs.push(ax.width);
  const ts = xs.map((x) => ax.t(x));
  let base = xs.map(() => 0);
  const bands = layers.map((layer) => {
    const hi = ts.map((t, k) => base[k] + countUpTo(layer.times, t));
    const band = { layer, lo: base, hi };
    base = hi;
    return band;
  });
  return { xs, step, bands, max: base[base.length - 1] ?? 0 };
}

/** The band (index) holding `value` notes at pixel `px`, or -1. */
export function bandAt(stack: StrataStack, px: number, value: number): number {
  if (stack.xs.length === 0) return -1;
  const k = Math.max(0, Math.min(stack.xs.length - 1, Math.round(px / stack.step)));
  return stack.bands.findIndex((b) => value >= b.lo[k] && value < b.hi[k]);
}

/** Room above the tallest point, so the top layer's edge never touches the frame. */
export const HEADROOM = 1.04;

/** y for a cumulative count: `top` is the highest a band may reach, `height` the baseline. */
export function scaleY(stack: Pick<StrataStack, "max">, height: number, top: number): (v: number) => number {
  const m = Math.max(1, stack.max * HEADROOM);
  return (v) => top + (height - top) * (1 - v / m);
}

export interface StrataLabel {
  band: number;
  key: string;
  title: string;
  count: number;
  /** Baseline of the label, centred in the band at now. */
  y: number;
}

/** Labels for the bands at least `minPx` tall at now, where every band has its full height. */
export function strataLabels(stack: StrataStack, o: { height: number; top: number; minPx: number }): StrataLabel[] {
  const y = scaleY(stack, o.height, o.top);
  const k = stack.xs.length - 1;
  const out: StrataLabel[] = [];
  stack.bands.forEach((b, i) => {
    const px = y(b.lo[k]) - y(b.hi[k]);
    if (px < o.minPx) return;
    out.push({ band: i, key: b.layer.key, title: b.layer.title, count: b.hi[k] - b.lo[k], y: (y(b.lo[k]) + y(b.hi[k])) / 2 + 4 });
  });
  return out;
}

/** Each band as an SVG area (along its top, back along its bottom) and its top edge alone. */
export function bandPaths(stack: StrataStack, y: (v: number) => number): { area: string; edge: string }[] {
  return stack.bands.map((b) => {
    let edge = `M${stack.xs[0]},${y(b.hi[0]).toFixed(1)}`;
    for (let k = 1; k < stack.xs.length; k++) edge += `L${stack.xs[k]},${y(b.hi[k]).toFixed(1)}`;
    let area = edge;
    for (let k = stack.xs.length - 1; k >= 0; k--) area += `L${stack.xs[k]},${y(b.lo[k]).toFixed(1)}`;
    return { area: `${area}Z`, edge };
  });
}
