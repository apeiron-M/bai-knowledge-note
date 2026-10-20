import { describe, expect, it } from "vitest";
import { axisMarks, dayKey, foldedAxis, formatter } from "./axis.js";

const H = 3_600_000;
const D = 24 * H;
const t0 = Date.UTC(2026, 9, 10, 19, 20);

describe("foldedAxis", () => {
  it("maps time onto the width, start to the left edge and now to the right", () => {
    const ax = foldedAxis([t0, t0 + H], 1000, t0 + 2 * H);
    expect(ax.x(ax.segs[0].t0)).toBe(0);
    expect(ax.x(t0 + 2 * H)).toBe(1000);
    expect(ax.gaps).toHaveLength(0);
    expect(ax.t(ax.x(t0 + H))).toBeCloseTo(t0 + H, -1);
  });

  it("folds a quiet stretch into a fixed-width break, so two bursts read as two bursts", () => {
    const now = t0 + 5 * D + 2 * H;
    const ax = foldedAxis([t0, t0 + H, t0 + 5 * D, t0 + 5 * D + H], 1000, now, { gapPx: 40 });
    expect(ax.gaps).toHaveLength(1);
    const [g] = ax.gaps;
    expect(g.x1 - g.x0).toBe(40);
    expect(g.t1 - g.t0).toBeGreaterThan(4 * D);
    // the two bursts take the rest of the width, not two slivers
    expect(ax.segs[0].x1 - ax.segs[0].x0).toBeGreaterThan(200);
    expect(ax.segs[1].x1 - ax.segs[1].x0).toBeGreaterThan(200);
  });

  it("only folds stretches longer than 1/40 of the span and at least 90 minutes", () => {
    const short = foldedAxis([t0, t0 + 80 * 60_000], 1000, t0 + 81 * 60_000);
    expect(short.gaps).toHaveLength(0);
    const year = [0, 3, 6, 9, 12].map((m) => t0 + m * 30 * D);
    const ax = foldedAxis(year, 1000, t0 + 365 * D);
    // a 90-day-wide spacing over a year: each stretch is longer than 365/40 days
    expect(ax.gaps.length).toBeGreaterThan(0);
  });

  it("folds at most the three longest stretches", () => {
    const bursts = [0, 2, 5, 9, 14, 20].map((d) => t0 + d * D);
    const ax = foldedAxis(bursts, 1200, t0 + 20 * D + H);
    expect(ax.gaps).toHaveLength(3);
    // the 6-, 5- and 4-day stretches fold; the 3- and 2-day ones stay on the axis
    const lengths = ax.gaps.map((g) => g.t1 - g.t0).sort((a, b) => b - a);
    expect(lengths[0]).toBeGreaterThan(5 * D);
    expect(Math.min(...lengths)).toBeGreaterThan(3.5 * D);
  });

  it("is monotonic and invertible across folds", () => {
    const ax = foldedAxis([t0, t0 + H, t0 + 3 * D], 900, t0 + 3 * D + H);
    let last = -1;
    for (let px = 0; px <= 900; px += 30) {
      const t = ax.t(px);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
      expect(ax.x(t)).toBeCloseTo(px, 3);
    }
  });

  it("handles a single moment", () => {
    const ax = foldedAxis([t0], 600, t0);
    expect(ax.x(t0)).toBe(600);
    expect(ax.segs).toHaveLength(1);
  });
});

describe("axisMarks", () => {
  const opts = { locale: "en-US", timeZone: "UTC" };

  it("labels hours inside a short burst, the day it starts, the folds and now", () => {
    const now = t0 + 5 * D + 2 * H;
    const ax = foldedAxis([t0, t0 + 3 * H, t0 + 5 * D, t0 + 5 * D + H], 1000, now);
    const m = axisMarks(ax, now, opts);
    expect(m.days.map((d) => d.label)).toEqual(["Sat, Oct 10", "Today"]);
    expect(m.ticks.some((x) => x.label === "8 PM")).toBe(true);
    expect(m.folds.map((f) => f.label)).toEqual(["5 days"]);
    expect(m.now).toEqual({ x: 1000, label: "Now" });
  });

  it("ticks months over a long span", () => {
    const start = Date.UTC(2025, 9, 16);
    const now = Date.UTC(2026, 9, 16);
    const days = Array.from({ length: 365 }, (_, i) => start + i * D);
    const ax = foldedAxis(days, 1100, now);
    const m = axisMarks(ax, now, opts);
    expect(m.ticks.map((x) => x.label)).toEqual(expect.arrayContaining(["Nov", "Dec", "2026", "Feb", "Sep"]));
    expect(m.days[0].label).toBe("October 2025");
  });

  it("never prints two day labels on top of each other", () => {
    const now = t0 + 30 * H;
    const ax = foldedAxis([t0, t0 + 2 * H, t0 + 26 * H, t0 + 29 * H], 300, now);
    const xs = axisMarks(ax, now, opts).days.map((d) => d.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(90);
  });
});

describe("any locale", () => {
  const ax = foldedAxis([Date.UTC(2026, 9, 15, 8), Date.UTC(2026, 9, 15, 20)], 900, Date.UTC(2026, 9, 15, 22), { maxFolds: 0 });
  it("keeps hour ticks where hours are written with words or other digits", () => {
    for (const locale of ["de-DE", "fr-FR", "ja-JP", "ar-EG"]) {
      const marks = axisMarks(ax, Date.UTC(2026, 9, 15, 22), { locale, timeZone: "UTC" });
      expect(marks.ticks.length, locale).toBeGreaterThan(3);
    }
  });

  it("finds the first of a month with any digits", () => {
    expect(dayKey(Date.UTC(2026, 10, 1, 12), { locale: "ar-EG", timeZone: "UTC" })).toBe("2026-11-01");
  });

  it("speaks the copy's language by default, in the viewer's own time zone", () => {
    expect(formatter({ timeZone: "UTC" }, { weekday: "long" }).format(Date.UTC(2026, 9, 15, 12))).toBe("Thursday");
  });
});
