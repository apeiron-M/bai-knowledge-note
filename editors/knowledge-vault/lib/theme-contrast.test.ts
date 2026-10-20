import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLE } from "./theme.js";

type Rgba = { r: number; g: number; b: number; a: number };
type TokenMap = Record<string, string>;

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../style.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

// A block belongs to a theme when one of its selectors is that theme's anchor.
// Every `{ … }` in the file is scanned and merged, because each theme is
// declared in more than one block (palette, then layering roles).
const ANCHOR = {
  light: ['[data-bai-theme="light"]'],
  dark: ['[data-bai-theme="dark"]', ".bai-theme"],
} as const;

function readTheme(theme: keyof typeof ANCHOR): TokenMap {
  const tokens: TokenMap = {};
  for (const [, selectors, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors.split(",").map((s) => s.trim());
    if (!list.some((s) => (ANCHOR[theme] as readonly string[]).includes(s)))
      continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      tokens[name] = value.trim();
  }
  return tokens;
}

const light = readTheme("light");
const dark = readTheme("dark");

function hex(value: string): Rgba | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

function resolveColor(value: string, map: TokenMap, depth = 0): Rgba {
  if (depth > 8) throw new Error(`token cycle at ${value}`);
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const next = map[ref[1]];
    if (!next) throw new Error(`undefined token ${ref[1]}`);
    return resolveColor(next, map, depth + 1);
  }
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const h = hex(v);
  if (h) return h;
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    v,
  );
  if (rgba)
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] ? Number(rgba[4]) : 1,
    };
  // color-mix(in srgb, <a> X%, <b>) — the remainder goes to <b>.
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/.exec(
    v,
  );
  if (mix) {
    const a = resolveColor(mix[1], map, depth + 1);
    const b = resolveColor(mix[3], map, depth + 1);
    const t = Number(mix[2]) / 100;
    const alpha = a.a * t + b.a * (1 - t);
    const ch = (x: number, y: number) =>
      alpha === 0 ? 0 : (x * a.a * t + y * b.a * (1 - t)) / alpha;
    return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha };
  }
  throw new Error(`cannot resolve colour "${value}"`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  const ch = (x: number, y: number) =>
    (x * top.a + y * bottom.a * (1 - top.a)) / a;
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function lstar(c: Rgba): number {
  const y = luminance(c);
  const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116;
  return 116 * f - 16;
}

function contrast(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// A translucent background (the *-soft tints) is judged where it sits: on the
// card surface.
function paint(name: string, map: TokenMap): Rgba {
  const raw = map[name];
  if (!raw) throw new Error(`${name} is not defined`);
  const c = resolveColor(raw, map);
  return c.a < 1 ? over(c, resolveColor("var(--bai-surface)", map)) : c;
}

// Text on the surface it sits on. Floors: 4.5 for body, 3 for icons/outlines.
const TEXT_PAIRS: Array<[string, string, number]> = [
  ["--bai-text", "--v-rail", 4.5],
  ["--bai-text-secondary", "--v-rail", 4.5],
  ["--bai-text-tertiary", "--v-rail", 4.5],
  ["--bai-text-muted", "--v-rail", 4.5],
  ["--bai-text-secondary", "--bai-surface", 4.5],
  ["--bai-text-tertiary", "--bai-surface", 4.5],
  ["--bai-text-muted", "--bai-surface", 4.5],
  ["--bai-text-tertiary", "--bai-bg", 4.5],
  ["--bai-text-muted", "--bai-bg", 4.5],
  ["--bai-accent", "--v-rail", 3],
  ["--v-field", "--v-rail", 3],
  ["--bai-warn", "--bai-warn-soft", 4.5],
  ["--bai-ok", "--bai-ok-soft", 4.5],
  ["--bai-danger", "--bai-danger-soft", 4.5],
];

function failures(map: TokenMap): string[] {
  const out: string[] = [];
  for (const [fg, bg, floor] of TEXT_PAIRS) {
    try {
      const ratio = contrast(paint(fg, map), paint(bg, map));
      if (ratio < floor)
        out.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1 < ${floor}:1`);
    } catch (e) {
      out.push(`${fg} on ${bg}: ${(e as Error).message}`);
    }
  }
  return out;
}

describe("theme contrast", () => {
  it("light: every text pair clears its floor", () => {
    expect(failures(light)).toEqual([]);
  });

  it("dark: every text pair clears its floor", () => {
    expect(failures(dark)).toEqual([]);
  });

  it("light: the three layers separate by 5 L* or more", () => {
    const L = (name: string) => lstar(paint(name, light));
    expect(Math.abs(L("--bai-bg") - L("--bai-surface"))).toBeGreaterThanOrEqual(5);
    expect(L("--v-rail")).toBeLessThanOrEqual(L("--bai-bg") - 5);
    expect(L("--v-read")).toBeLessThanOrEqual(L("--bai-surface") - 5);
  });

  it("light carries the AA-corrected values", () => {
    expect(light["--bai-text-tertiary"]).toBe("#565c69");
    expect(light["--bai-text-muted"]).toBe("#5b6270");
    expect(light["--bai-accent"]).toBe("#732dec");
    expect(light["--bai-warn"]).toBe("#945104");
    expect(light["--bai-ok"]).toBe("#04704e");
    expect(light["--bai-danger"]).toBe("#c01d1d");
    expect(light["--v-note"]).toBe("#275cc5");
    expect(light["--v-review"]).toBe("#1555e2");
    expect(light["--v-field"]).toBe("#747d95");
  });

  it("dark changes one text token and nothing else", () => {
    expect(dark["--bai-text-muted"]).toBe("#979da8");
    expect(dark["--bai-text-tertiary"]).toBe("#9ca3af");
    expect(dark["--bai-accent"]).toBe("#cba6f7");
  });

  it("every role is defined in both themes", () => {
    for (const name of Object.values(ROLE)) {
      expect(light[name], `light ${name}`).toBeTruthy();
      expect(dark[name], `dark ${name}`).toBeTruthy();
    }
  });
});
