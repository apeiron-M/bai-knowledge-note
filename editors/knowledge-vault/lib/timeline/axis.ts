/**
 * The timeline's time axis. Quiet stretches longer than 1/40 of what is shown
 * (and at least 90 minutes) fold to a fixed-width break — at most the three
 * longest — so a vault filled in two evenings reads as two evenings, not as
 * two slivers at the ends of an empty week. Inside a stretch, time is linear.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A stretch of the axis: time [t0, t1] drawn over pixels [x0, x1]. */
export interface AxisPart {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}

export interface FoldedAxis {
  /** The stretches that are drawn to scale. */
  segs: AxisPart[];
  /** The folded quiet stretches between them, each `gapPx` wide. */
  gaps: AxisPart[];
  width: number;
  now: number;
  /** Pixel for a time; before the first stretch is 0, after now is the width. */
  x(t: number): number;
  /** Time for a pixel. */
  t(px: number): number;
}

export interface AxisOptions {
  gapPx?: number;
  maxFolds?: number;
  quietMs?: number;
  padMs?: number;
}

export function foldedAxis(times: readonly number[], width: number, now: number, opt: AxisOptions = {}): FoldedAxis {
  const ts = [...times.filter(Number.isFinite), now].sort((a, b) => a - b);
  const total = Math.max(ts[ts.length - 1] - ts[0], HOUR);
  const quietMs = opt.quietMs ?? Math.max(90 * MIN, total / 40);
  const pad = opt.padMs ?? Math.min(12 * MIN + total / 400, 6 * HOUR);
  const gapPx = opt.gapPx ?? 40;

  const quiet: [number, number][] = [];
  for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > quietMs) quiet.push([ts[k] - ts[k - 1], k]);
  const cut = new Set(
    quiet
      .sort((a, b) => b[0] - a[0])
      .slice(0, opt.maxFolds ?? 3)
      .map(([, k]) => k),
  );
  const raw: [number, number][] = [];
  let start = ts[0];
  for (let k = 1; k < ts.length; k++) {
    if (cut.has(k)) {
      raw.push([start, ts[k - 1]]);
      start = ts[k];
    }
  }
  raw.push([start, ts[ts.length - 1]]);
  raw.forEach((s, i) => {
    s[0] -= pad;
    s[1] = i === raw.length - 1 ? now : s[1] + pad;
  });

  const weight = raw.map(([a, b]) => Math.pow(Math.max(b - a, 40 * MIN), 0.62));
  const sum = weight.reduce((p, q) => p + q, 0);
  const avail = Math.max(0, width - gapPx * (raw.length - 1));
  let x = 0;
  const segs: AxisPart[] = raw.map(([t0, t1], i) => {
    const w = i === raw.length - 1 ? width - x : (avail * weight[i]) / sum;
    const part = { t0, t1, x0: x, x1: x + w };
    x += w + gapPx;
    return part;
  });
  const gaps: AxisPart[] = segs.slice(0, -1).map((s, i) => ({ t0: s.t1, t1: segs[i + 1].t0, x0: s.x1, x1: segs[i + 1].x0 }));
  const parts = [...segs, ...gaps].sort((a, b) => a.t0 - b.t0);

  const toX = (t: number): number => {
    if (t <= parts[0].t0) return 0;
    for (const p of parts) if (t <= p.t1) return p.x0 + ((t - p.t0) / (p.t1 - p.t0 || 1)) * (p.x1 - p.x0);
    return width;
  };
  const toT = (px: number): number => {
    if (px <= 0) return parts[0].t0;
    for (const p of parts) if (px <= p.x1) return p.t0 + ((px - p.x0) / (p.x1 - p.x0 || 1)) * (p.t1 - p.t0);
    return now;
  };
  return { segs, gaps, width, now, x: toX, t: toT };
}

/**
 * How dates read. The copy around them is English, so dates default to
 * en-US too — a German weekday inside an English sentence reads wrong — in
 * the viewer's own time zone. Tests pin both.
 */
export interface TimeWords {
  locale?: string;
  timeZone?: string;
}

export const DEFAULT_LOCALE = "en-US";

const formatters = new Map<string, Intl.DateTimeFormat>();
/** A cached formatter for these options in this locale and zone. */
export function formatter(o: TimeWords, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = o.locale ?? DEFAULT_LOCALE;
  const key = JSON.stringify([locale, o.timeZone, opts]);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: o.timeZone });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Keys and numbers are read, never shown: they come from one fixed locale
 * with Latin digits, so "13 Uhr", "13 h" or Arabic-Indic digits elsewhere
 * cannot break them. Only the time zone matters to them.
 */
const reading = (o: TimeWords): TimeWords => ({ locale: DEFAULT_LOCALE, timeZone: o.timeZone });

/** "2026-10-15", the calendar day of a moment in the zone. */
export function dayKey(ms: number, o: TimeWords = {}): string {
  const parts = formatter(reading(o), { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour of a moment in the zone, 0–23. */
function hourOf(ms: number, o: TimeWords): number {
  const parts = formatter(reading(o), { hour: "numeric", hourCycle: "h23" }).formatToParts(ms);
  return Number(parts.find((p) => p.type === "hour")?.value);
}
const monthKey = (ms: number, o: TimeWords) => dayKey(ms, o).slice(0, 7);

export interface AxisMark {
  x: number;
  label: string;
}

export interface AxisMarks {
  /** The day (or month) a stretch starts, under the ticks. */
  days: AxisMark[];
  /** Hours, days or months along the axis. */
  ticks: AxisMark[];
  /** The folded stretches: "5 days", "13 h". */
  folds: AxisMark[];
  now: AxisMark;
}

const DAY_LABEL_ROOM = 90;
const TICK_ROOM = 54;
const EDGE_ROOM = 30;

/** "5 days", "13 h": how long a fold is. */
export function foldLength(ms: number): string {
  return ms >= 2 * DAY ? `${Math.round(ms / DAY)} days` : `${Math.round(ms / HOUR)} h`;
}

/** The first moment after `from` whose key differs from `from`'s, scanning in `step`s. */
function nextBoundary(from: number, until: number, step: number, key: (ms: number) => string): number | null {
  const k = key(from);
  for (let t = from + step; t < until; t += step) if (key(t) !== k) return t;
  return null;
}

export function axisMarks(ax: FoldedAxis, now: number, o: TimeWords = {}): AxisMarks {
  const days: AxisMark[] = [];
  const ticks: AxisMark[] = [];
  let lastDay = "";
  let lastLabelX = -Infinity;
  const last = ax.segs.length - 1;
  ax.segs.forEach((g, gi) => {
    const w = g.x1 - g.x0;
    const dur = g.t1 - g.t0;
    const long = dur > 60 * DAY;
    const startKey = dayKey(g.t0 + 1, o);
    const label = long
      ? formatter(o, { month: "long", year: "numeric" }).format(g.t0 + 1)
      : startKey === dayKey(now, o)
        ? "Today"
        : formatter(o, { weekday: "short", month: "short", day: "numeric" }).format(g.t0 + 1);
    if (startKey !== lastDay && g.x0 - lastLabelX >= DAY_LABEL_ROOM) {
      days.push({ x: g.x0, label });
      lastLabelX = g.x0;
    }
    lastDay = dayKey(g.t1 - 1, o);
    const room = (x: number) => !((x - g.x0 < EDGE_ROOM && gi > 0) || (g.x1 - x < EDGE_ROOM && gi < last));

    if (dur <= 72 * HOUR) {
      const perHour = w / (dur / HOUR);
      const step = [1, 2, 3, 6, 12].find((h) => perHour * h >= TICK_ROOM);
      if (!step) return;
      for (let t = Math.ceil(g.t0 / HOUR) * HOUR; t < g.t1; t += HOUR) {
        if (hourOf(t, o) % step !== 0) continue;
        const x = ax.x(t);
        if (room(x)) ticks.push({ x, label: formatter(o, { hour: "numeric" }).format(t) });
      }
    } else if (long) {
      for (let t = nextBoundary(g.t0, g.t1, DAY, (ms) => monthKey(ms, o)); t !== null; t = nextBoundary(t, g.t1, DAY, (ms) => monthKey(ms, o))) {
        const x = ax.x(t);
        if (x < EDGE_ROOM + 10 || !room(x)) continue;
        const isJanuary = monthKey(t, o).endsWith("-01");
        ticks.push({ x, label: isJanuary ? formatter(o, { year: "numeric" }).format(t) : formatter(o, { month: "short" }).format(t) });
      }
    } else {
      const everyDays = Math.max(1, Math.round(dur / DAY / Math.max(1, w / 70)));
      let n = 0;
      for (let t = nextBoundary(g.t0, g.t1, HOUR, (ms) => dayKey(ms, o)); t !== null; t = nextBoundary(t, g.t1, HOUR, (ms) => dayKey(ms, o))) {
        if (n++ % everyDays !== 0) continue;
        const x = ax.x(t);
        if (!room(x)) continue;
        const firstOfMonth = dayKey(t, o).endsWith("-01");
        ticks.push({ x, label: firstOfMonth ? formatter(o, { month: "short" }).format(t) : formatter(o, { day: "numeric" }).format(t) });
      }
    }
  });
  const folds = ax.gaps.map((g) => ({ x: (g.x0 + g.x1) / 2, label: foldLength(g.t1 - g.t0) }));
  return { days, ticks, folds, now: { x: ax.width, label: "Now" } };
}
