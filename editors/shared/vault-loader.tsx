/**
 * The vault's loading state: a small vault graph whose hub reaches out to its
 * notes one at a time — a light running along each link, the note glowing as
 * it arrives — while the whole constellation drifts. It says what is opening
 * and, once a wait runs long, why it is still waiting.
 *
 * The desktop app shows a copy of this before the package has loaded
 * (knowledge-vault-app `host/src/components/VaultLoader.tsx`). The two share
 * one clock on `globalThis`, so a wait that passes from the app to the vault
 * (the app opening the drive, then this package checking access) carries on
 * where it was instead of starting again and fading in twice. Keep the
 * geometry and timing of the two in step.
 */

import { useEffect, useRef, useState } from "react";

type Node = {
  x: number;
  y: number;
  r: number;
  kind: "hub" | "note" | "leaf";
  parent?: number;
};

// Hand-placed in a 160×120 box: a MoC hub, seven notes around it, three leaves further out.
const NODES: readonly Node[] = [
  { x: 80, y: 60, r: 6.5, kind: "hub" },
  { x: 82, y: 19, r: 3.0, kind: "note" },
  { x: 121, y: 33, r: 4.0, kind: "note" },
  { x: 133, y: 71, r: 3.1, kind: "note" },
  { x: 105, y: 98, r: 3.6, kind: "note" },
  { x: 59, y: 96, r: 3.0, kind: "note" },
  { x: 27, y: 73, r: 3.2, kind: "note" },
  { x: 44, y: 36, r: 3.6, kind: "note" },
  { x: 146, y: 21, r: 2.4, kind: "leaf", parent: 2 },
  { x: 17, y: 27, r: 2.4, kind: "leaf", parent: 7 },
  { x: 127, y: 110, r: 2.2, kind: "leaf", parent: 4 },
];
/** The notes in the order the hub reaches them: clockwise from the top. */
const ORDER = [1, 2, 3, 4, 5, 6, 7] as const;
const SPOKES = ORDER.map((n) => [0, n] as const);
const CROSS = [
  [1, 2],
  [3, 4],
  [4, 5],
  [6, 7],
] as const;
const LEAVES = NODES.flatMap((n, i) =>
  n.parent === undefined ? [] : [[n.parent, i] as const],
);
const EDGES = [...SPOKES, ...CROSS, ...LEAVES];
/** For each note, its leaf and the leaf's edge index, if it has one. */
const LEAF_OF = new Map(
  LEAVES.map(([note, leaf], i) => [
    note,
    { leaf, edge: SPOKES.length + CROSS.length + i },
  ]),
);

const STEP = 0.6; // s between reaches
const TRAVEL = 0.42; // s for the light to run hub → note
const LEAF_TRAVEL = 0.3; // s note → leaf
const RISE = 0.1;
const DECAY = 0.55;
const STEP_STILL = 1.0; // reduced motion: a slower glow, nothing moves

const mod = (a: number, n: number) => ((a % n) + n) % n;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
/** A light's brightness `s` seconds after it arrived: a quick rise, a slow fade. */
const glow = (s: number) =>
  s < RISE ? s / RISE : Math.exp(-(s - RISE) / DECAY);

/** `onScreen` is optional: an older copy of the other side may have made the clock without it. */
type Clock = { epoch: number | null; lastShownAt: number; onScreen?: number };
/** Shared with the desktop app's copy, so the two read as one load. */
function clock(): Clock {
  const g = globalThis as unknown as { __vaultLoaderClock?: Clock };
  g.__vaultLoaderClock ??= { epoch: null, lastShownAt: -Infinity, onScreen: 0 };
  return g.__vaultLoaderClock;
}
const now = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();
const STILL_QUERY = "(prefers-reduced-motion: reduce)";

const CSS = `
.vault-loader { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; animation: vault-loader-in 280ms ease-out 180ms both; }
.vault-loader[data-size="pane"] { flex: 1 1 auto; width: 100%; height: 100%; min-height: 0; padding: 24px 24px 14vh; box-sizing: border-box; }
.vault-loader[data-continues] { animation: none; }
@keyframes vault-loader-in { from { opacity: 0; } to { opacity: 1; } }
.vault-loader-label { margin: 18px 0 0; font-size: 15px; font-weight: 500; color: var(--bai-text-secondary); }
.vault-loader[data-size="panel"] .vault-loader-label { margin-top: 10px; font-size: 14px; }
.vault-loader-detail { margin: 4px 0 0; max-width: 46ch; font-size: 13px; color: var(--bai-text-tertiary); }
.vault-loader-graph { display: block; width: 208px; height: auto; overflow: visible; }
.vault-loader[data-size="panel"] .vault-loader-graph { width: 148px; }
.vault-l-edge { stroke: var(--bai-text-faint); stroke-width: 1; stroke-linecap: round; }
.vault-l-edge-lit { stroke: var(--bai-accent); stroke-width: 1.5; stroke-linecap: round; }
.vault-l-node { fill: var(--bai-text-muted); fill-opacity: 0.55; }
.vault-l-hub { fill: var(--bai-accent); fill-opacity: 1; }
.vault-l-lit, .vault-l-head, .vault-l-halo, .vault-l-hub-halo { fill: var(--bai-accent); }
.vault-l-head-halo { fill: var(--bai-accent); fill-opacity: 0.28; }
.vault-loader-mark { flex: 0 0 auto; display: inline-block; overflow: visible; }
.vault-loader-mark line { stroke: var(--bai-text-faint); stroke-width: 1.2; stroke-linecap: round; }
.vault-lm-hub { fill: var(--bai-accent); }
.vault-lm-node { fill: var(--bai-accent); fill-opacity: 0.3; animation: vault-lm-light 1.2s ease-in-out infinite; }
.vault-lm-node:nth-of-type(3) { animation-delay: 0.4s; }
.vault-lm-node:nth-of-type(4) { animation-delay: 0.8s; }
@keyframes vault-lm-light { 0%, 100% { fill-opacity: 0.3; } 30% { fill-opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .vault-lm-node { animation: none; fill-opacity: 0.7; } }
`;

/** The graph alone, animated by one requestAnimationFrame loop writing attributes (no React renders per frame). */
export function VaultLoaderGraph() {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const root = svg.current;
    if (!root || typeof requestAnimationFrame !== "function") return;
    const q = (sel: string) =>
      Array.from(root.querySelectorAll<SVGElement>(sel));
    const base = q(".vault-l-node");
    const lit = q(".vault-l-lit");
    const halos = q(".vault-l-halo");
    const edges = q(".vault-l-edge");
    const glows = q(".vault-l-edge-lit");
    const heads = q(".vault-l-head");
    const headHalos = q(".vault-l-head-halo");
    const hubHalo =
      root.querySelector<SVGElement>(".vault-l-hub-halo") ?? undefined;
    const c = clock();
    c.epoch ??= now();
    const epoch = c.epoch;
    const media =
      typeof matchMedia === "function" ? matchMedia(STILL_QUERY) : null;
    let still = media?.matches ?? false;
    const onMedia = () => {
      still = media?.matches ?? false;
    };
    media?.addEventListener("change", onMedia);
    const x = new Float64Array(NODES.length);
    const y = new Float64Array(NODES.length);
    const light = new Float64Array(NODES.length);
    const set = (el: SVGElement | undefined, attrs: Record<string, number>) => {
      if (!el) return;
      for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, v.toFixed(2));
    };
    /** A light running from node a toward node b, `f` of the way. */
    const run = (
      edge: number,
      head: number,
      a: number,
      b: number,
      f: number,
    ) => {
      const hx = x[a] + (x[b] - x[a]) * f;
      const hy = y[a] + (y[b] - y[a]) * f;
      set(glows[edge], {
        x1: x[a],
        y1: y[a],
        x2: hx,
        y2: hy,
        "stroke-opacity": 1,
      });
      set(heads[head], { cx: hx, cy: hy, opacity: 1 });
      set(headHalos[head], { cx: hx, cy: hy, opacity: 1 });
    };
    let frame = 0;
    const tick = () => {
      const t = (now() - epoch) / 1000;
      const step = still ? STEP_STILL : STEP;
      const cycle = ORDER.length * step;
      const travel = still ? 0 : TRAVEL;
      const leafTravel = still ? 0 : LEAF_TRAVEL;
      // Where each node is: a slow drift, each on its own period.
      NODES.forEach((n, i) => {
        const amp = still
          ? 0
          : n.kind === "hub"
            ? 1.6
            : n.kind === "leaf"
              ? 5
              : 4.2;
        const px = 5.5 + ((i * 1.37) % 3.5);
        const py = 6.2 + ((i * 2.11) % 3.1);
        x[i] = n.x + amp * Math.sin((2 * Math.PI * t) / px + i * 1.9);
        y[i] = n.y + amp * Math.sin((2 * Math.PI * t) / py + i * 2.5);
        light[i] = 0;
      });
      const running = [false, false];
      // Spokes: the light runs out from the hub, the note glows, then its leaf.
      ORDER.forEach((n, k) => {
        const u = mod(t - k * step, cycle);
        if (u < travel) {
          run(k, 0, 0, n, ease(u / travel));
          running[0] = true;
        } else {
          set(glows[k], {
            x1: x[0],
            y1: y[0],
            x2: x[n],
            y2: y[n],
            "stroke-opacity": glow(u - travel) * 0.9,
          });
        }
        const since = mod(t - k * step - travel, cycle);
        light[n] = glow(since);
        const leaf = LEAF_OF.get(n);
        if (!leaf) return;
        if (since < leafTravel) {
          run(leaf.edge, 1, n, leaf.leaf, ease(since / leafTravel));
          running[1] = true;
        } else {
          set(glows[leaf.edge], {
            x1: x[n],
            y1: y[n],
            x2: x[leaf.leaf],
            y2: y[leaf.leaf],
            "stroke-opacity": glow(since - leafTravel) * 0.85,
          });
        }
        light[leaf.leaf] = glow(mod(since - leafTravel, cycle));
      });
      running.forEach((on, i) => {
        if (on) return;
        heads[i]?.setAttribute("opacity", "0");
        headHalos[i]?.setAttribute("opacity", "0");
      });
      // Links between neighbours glow while both ends are lit: the light passes round the ring.
      CROSS.forEach(([a, b], i) => {
        set(glows[SPOKES.length + i], {
          x1: x[a],
          y1: y[a],
          x2: x[b],
          y2: y[b],
          "stroke-opacity": 0.8 * Math.sqrt(light[a] * light[b]),
        });
      });
      EDGES.forEach(([a, b], i) =>
        set(edges[i], { x1: x[a], y1: y[a], x2: x[b], y2: y[b] }),
      );
      // The hub swells a little each time it reaches out.
      const since = mod(t, step);
      const swell = still
        ? 0
        : since < 0.08
          ? since / 0.08
          : Math.exp(-(since - 0.08) / 0.18);
      NODES.forEach((n, i) => {
        set(base[i], {
          cx: x[i],
          cy: y[i],
          r: n.kind === "hub" ? n.r * (1 + 0.14 * swell) : n.r,
        });
        if (i === 0) return;
        set(lit[i - 1], {
          cx: x[i],
          cy: y[i],
          r: n.r * (1 + 0.3 * light[i]),
          "fill-opacity": light[i],
        });
        set(halos[i - 1], {
          cx: x[i],
          cy: y[i],
          r: n.r * (2 + 0.8 * light[i]),
          "fill-opacity": 0.22 * light[i],
        });
      });
      set(hubHalo, {
        cx: x[0],
        cy: y[0],
        r: NODES[0].r * (1.9 + 0.35 * swell),
        "fill-opacity": 0.14 + 0.1 * swell,
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      media?.removeEventListener("change", onMedia);
    };
  }, []);

  const hub = NODES[0];
  return (
    <svg
      ref={svg}
      className="vault-loader-graph"
      viewBox="0 0 160 120"
      aria-hidden="true"
      focusable="false"
    >
      <g>
        {EDGES.map(([a, b], i) => (
          <line
            key={`e${i}`}
            className="vault-l-edge"
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
          />
        ))}
      </g>
      <g>
        {EDGES.map(([a, b], i) => (
          <line
            key={`g${i}`}
            className="vault-l-edge-lit"
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            strokeOpacity={0}
          />
        ))}
      </g>
      <g>
        <circle
          className="vault-l-hub-halo"
          cx={hub.x}
          cy={hub.y}
          r={hub.r * 1.9}
          fillOpacity={0.14}
        />
        {NODES.slice(1).map((n, i) => (
          <circle
            key={`h${i}`}
            className="vault-l-halo"
            cx={n.x}
            cy={n.y}
            r={n.r * 2}
            fillOpacity={0}
          />
        ))}
        {NODES.map((n, i) => (
          <circle
            key={`n${i}`}
            className={
              n.kind === "hub" ? "vault-l-node vault-l-hub" : "vault-l-node"
            }
            cx={n.x}
            cy={n.y}
            r={n.r}
          />
        ))}
        {NODES.slice(1).map((n, i) => (
          <circle
            key={`l${i}`}
            className="vault-l-lit"
            cx={n.x}
            cy={n.y}
            r={n.r}
            fillOpacity={0}
          />
        ))}
      </g>
      <circle
        className="vault-l-head-halo"
        r={5.5}
        cx={hub.x}
        cy={hub.y}
        opacity={0}
      />
      <circle
        className="vault-l-head-halo"
        r={4.5}
        cx={hub.x}
        cy={hub.y}
        opacity={0}
      />
      <circle
        className="vault-l-head"
        r={2.1}
        cx={hub.x}
        cy={hub.y}
        opacity={0}
      />
      <circle
        className="vault-l-head"
        r={1.7}
        cx={hub.x}
        cy={hub.y}
        opacity={0}
      />
    </svg>
  );
}

type Props = {
  /** What is opening, in the person's words: "Opening Powerhouse Knowledge…". */
  label: string;
  /** A second, quieter line: where it is coming from. */
  detail?: string;
  /** Shown instead of the detail once the wait has gone on for `slowAfterMs`: why it is still waiting. */
  slow?: string;
  slowAfterMs?: number;
  /**
   * `pane` fills the space a view will take (and continues a loader that was
   * just on screen there); `panel` sits inside a card while a list loads.
   */
  size?: "pane" | "panel";
};

export function VaultLoader({
  label,
  detail,
  slow,
  slowAfterMs = 8000,
  size = "pane",
}: Props) {
  // A pane replacing one that is still on screen (React renders the new one
  // before the old one unmounts), or was a moment ago, continues it rather
  // than fading in again.
  const [continues] = useState(() => {
    const c = clock();
    return size === "pane" && ((c.onScreen ?? 0) > 0 || now() - c.lastShownAt < 700);
  });
  const [isSlow, setSlow] = useState(false);
  useEffect(() => {
    if (!slow) return;
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [slow, slowAfterMs]);
  useEffect(() => {
    if (size !== "pane") return;
    const c = clock();
    c.onScreen = (c.onScreen ?? 0) + 1;
    return () => {
      c.onScreen = (c.onScreen ?? 1) - 1;
      c.lastShownAt = now();
    };
  }, [size]);
  const second = isSlow && slow ? slow : detail;
  return (
    <div
      className="vault-loader"
      data-size={size}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-continues={continues || undefined}
    >
      <style>{CSS}</style>
      <VaultLoaderGraph />
      <p className="vault-loader-label">{label}</p>
      {second && <p className="vault-loader-detail">{second}</p>}
    </div>
  );
}

/** The inline mark, for a line of text: a hub and three notes lighting in turn. */
export function VaultLoaderMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="vault-loader-mark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <style>{CSS}</style>
      <line x1="8" y1="8.6" x2="8" y2="2.4" />
      <line x1="8" y1="8.6" x2="13.4" y2="12" />
      <line x1="8" y1="8.6" x2="2.6" y2="12" />
      <circle className="vault-lm-hub" cx="8" cy="8.6" r="2.4" />
      <circle className="vault-lm-node" cx="8" cy="2.4" r="1.7" />
      <circle className="vault-lm-node" cx="13.4" cy="12" r="1.7" />
      <circle className="vault-lm-node" cx="2.6" cy="12" r="1.7" />
    </svg>
  );
}
