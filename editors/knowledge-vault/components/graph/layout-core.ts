/**
 * The graph layout, driven by commands so the same code runs in a Web Worker
 * (layout-worker-entry.ts → layout-worker.generated.ts) or, where a worker
 * cannot start, on the main thread (layout-engine.ts).
 *
 * The view sends the graph, drags and heat as commands; the layout answers
 * with frames, each holding every node's position in the order of the last
 * graph command. A position buffer moves to the view and back (`recycle`), so
 * a frame allocates nothing once the pool is warm, and no more than two frames
 * are in flight: a busy view gets fewer frames while the layout keeps going.
 *
 * Dragging is the graph's long-standing behaviour (GraphViewPixi.tsx before
 * the rewrite): the grabbed node is held where the pointer is (fx/fy), the
 * layout warms toward alphaTarget 0.3 without a jump and keeps running, so
 * whatever is linked to the node swings after it on its springs; on release
 * the node is let go and the layout cools back down. When a full step is too
 * slow for that to look live (a very large graph, or a slow machine), the drag
 * runs on the grabbed node's neighbourhood only (ForceLayout.setActive): what
 * it links to, and the crowd around it, gathered afresh as it travels.
 *
 * Self-contained apart from ForceLayout: it is bundled into the worker.
 */
import { ForceLayout } from "./force-layout.js";

/** How the layout should move: d3's alpha, its decay and its target. */
export type Heat = {
  /** Raise alpha to at least this (0 leaves it as it is). */
  alpha: number;
  decay: number;
  /** Alpha the layout tends to; above alphaMin it never settles. */
  target: number;
  /** Step several times per frame when the steps are quick (a first layout). */
  fast?: boolean;
};

/** View → layout. */
export type LayoutCommand =
  | {
      type: "graph";
      version: number;
      ids: string[];
      radii: Float32Array;
      /** x, y per node; NaN where the view has no position (the layout then places it). */
      positions: Float32Array;
      /** Source and target index per link. */
      links: Uint32Array;
      /** 1 for a MoC edge (longer spring), 0 otherwise; one per link. */
      coreIdea: Uint8Array;
      center: [number, number];
      heat: Heat | null;
    }
  /** Hold node `index` at (x, y): the start of a drag, and every move of it. */
  | { type: "drag"; index: number; x: number; y: number }
  /** Let go of the dragged node. */
  | { type: "drop" }
  | { type: "heat"; heat: Heat }
  /** Forget every position and lay the graph out from scratch. */
  | { type: "relayout"; heat: Heat }
  /** A frame's buffer, handed back for reuse. */
  | { type: "recycle"; buffer: Float32Array };

/** Layout → view. */
export type LayoutFrame = {
  type: "frame";
  version: number;
  positions: Float32Array;
  /** The layout has come to rest; no frame follows until the next command. */
  settled: boolean;
};

export type StepResult = "idle" | "moved" | "settled";

/** Frames in flight before the layout waits for the view to hand one back. */
const MAX_IN_FLIGHT = 2;
/** Steps per frame at most when `fast`; each must still fit the budget. */
const FAST_TICKS = 8;
/** While dragging, the rest of the graph warms toward this, as it always has. */
export const DRAG_ALPHA_TARGET = 0.3;
const DRAG_DECAY = 0.02;
/**
 * A drag runs on a neighbourhood only when a full step takes longer than
 * this (~25 steps a second): below it the whole graph swings, as it always
 * has, smoothed between steps by the view.
 */
export const LOCAL_DRAG_STEP_MS = 40;
/** Without a timed step yet, a graph this large is assumed too slow to drag whole. */
const LOCAL_DRAG_UNTIMED_FROM = 30000;
/** What a local drag moves: the grabbed node's links, LOCAL_DRAG_HOPS out… */
const LOCAL_DRAG_HOPS = 3;
const LOCAL_DRAG_LINKED_MAX = 3000;
/** …and whatever is near it, so the crowd it passes through can make way. */
const LOCAL_DRAG_RADIUS = 400;
const LOCAL_DRAG_NEARBY_MAX = 3000;
/**
 * The nearby part is gathered again once the grabbed node has moved this far,
 * at most this often: gathering rebuilds the frozen part of the graph.
 */
const LOCAL_DRAG_REFRESH = 150;
const LOCAL_DRAG_REFRESH_MS = 300;

export class LayoutCore {
  version = 0;
  running = false;
  /** Smoothed time of a full (global) step, ms. */
  stepMs = 0;
  readonly layout = new ForceLayout();
  private index = new Map<string, number>();
  /** Undirected adjacency (CSR) for the neighbourhood of a local drag. */
  private adjStart = new Uint32Array(1);
  private adj = new Uint32Array(0);
  private dragged = -1;
  /** Where and when the nearby part of a local drag was last gathered. */
  private localAt: [number, number] | null = null;
  private localAtTime = 0;
  private fast = false;
  private pool: Float32Array[] = [];
  private inFlight = 0;

  /** The clock (replaceable in tests). */
  now: () => number = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  constructor() {
    // The graph's forces are ForceLayout's defaults. Cold until heated: a
    // first layout heats to 1, a remembered one is left as it is.
    this.layout.alphaDecay = 0.02;
    this.layout.alpha = 0;
  }

  get nodeCount(): number {
    return this.layout.n;
  }

  get dragging(): number {
    return this.dragged;
  }

  handle(cmd: LayoutCommand): void {
    const f = this.layout;
    switch (cmd.type) {
      case "graph":
        this.setGraph(cmd);
        break;
      case "drag": {
        const i = cmd.index;
        if (i < 0 || i >= f.n) break;
        if (this.dragged !== i) this.startDrag(i, cmd.x, cmd.y);
        f.fx[i] = cmd.x;
        f.fy[i] = cmd.y;
        // A local drag gathers the crowd around wherever the node has got to.
        const at = this.localAt;
        if (
          at &&
          f.isLocal &&
          Math.hypot(cmd.x - at[0], cmd.y - at[1]) > LOCAL_DRAG_REFRESH &&
          this.now() - this.localAtTime > LOCAL_DRAG_REFRESH_MS
        ) {
          this.activateAround(i, cmd.x, cmd.y);
        }
        break;
      }
      case "drop":
        this.localAt = null;
        if (this.dragged >= 0) {
          f.fx[this.dragged] = Number.NaN;
          f.fy[this.dragged] = Number.NaN;
          this.dragged = -1;
          // Cool down as it always has; a local drag stays local until at rest.
          this.applyHeat({ alpha: 0, decay: DRAG_DECAY, target: 0 });
        }
        break;
      case "heat":
        this.applyHeat(cmd.heat);
        break;
      case "relayout":
        f.setActive(null);
        this.localAt = null;
        f.x.fill(Number.NaN);
        f.y.fill(Number.NaN);
        f.vx.fill(Number.NaN);
        f.vy.fill(Number.NaN);
        f.fx.fill(Number.NaN);
        f.fy.fill(Number.NaN);
        this.dragged = -1;
        f.initialize(); // places every node afresh on d3's spiral
        this.applyHeat(cmd.heat);
        break;
      case "recycle":
        this.inFlight = Math.max(0, this.inFlight - 1);
        if (
          cmd.buffer.length === f.n * 2 &&
          this.pool.length < MAX_IN_FLIGHT + 1
        ) {
          this.pool.push(cmd.buffer);
        }
        break;
    }
  }

  /**
   * Advance: at least one step, more while `fast` and inside the budget.
   * "settled" when the layout has come to rest (the frame after it is final).
   */
  step(budgetMs: number, now: () => number): StepResult {
    if (!this.running) return "idle";
    const f = this.layout;
    const maxTicks = this.fast ? FAST_TICKS : 1;
    const t0 = now();
    let ticks = 0;
    do {
      const local = f.isLocal;
      const s0 = local ? 0 : now();
      f.tick();
      ticks++;
      if (!local) {
        const ms = now() - s0;
        this.stepMs = this.stepMs === 0 ? ms : this.stepMs * 0.8 + ms * 0.2;
      }
      if (f.alpha < f.alphaMin) {
        this.running = false;
        f.setActive(null);
        this.localAt = null;
        return "settled";
      }
    } while (ticks < maxTicks && now() - t0 < budgetMs);
    return "moved";
  }

  /**
   * Every node's position, in a pooled buffer. Null while the view still holds
   * MAX_IN_FLIGHT frames, unless `settled` (the final frame always goes out).
   */
  frame(settled: boolean): LayoutFrame | null {
    if (!settled && this.inFlight >= MAX_IN_FLIGHT) return null;
    const f = this.layout;
    const size = f.n * 2;
    let positions = this.pool.pop();
    while (positions && positions.length !== size) positions = this.pool.pop();
    positions ??= new Float32Array(size);
    for (let i = 0; i < f.n; i++) {
      positions[i * 2] = f.x[i];
      positions[i * 2 + 1] = f.y[i];
    }
    this.inFlight++;
    return { type: "frame", version: this.version, positions, settled };
  }

  /**
   * The nodes a local drag of `start` moves: its links, breadth-first and
   * LOCAL_DRAG_HOPS out (at most LOCAL_DRAG_LINKED_MAX), plus every node
   * within LOCAL_DRAG_RADIUS of (x, y) (at most LOCAL_DRAG_NEARBY_MAX).
   */
  neighbourhood(start: number, x = Number.NaN, y = Number.NaN): number[] {
    const seen = new Set<number>([start]);
    let frontier = [start];
    for (let hop = 0; hop < LOCAL_DRAG_HOPS && frontier.length > 0; hop++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (let k = this.adjStart[i]; k < this.adjStart[i + 1]; k++) {
          const j = this.adj[k];
          if (seen.has(j) || seen.size >= LOCAL_DRAG_LINKED_MAX) continue;
          seen.add(j);
          next.push(j);
        }
      }
      frontier = next;
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const f = this.layout;
      const r2 = LOCAL_DRAG_RADIUS * LOCAL_DRAG_RADIUS;
      let nearby = 0;
      for (let i = 0; i < f.n && nearby < LOCAL_DRAG_NEARBY_MAX; i++) {
        const dx = f.x[i] - x;
        const dy = f.y[i] - y;
        if (dx * dx + dy * dy > r2 || seen.has(i)) continue;
        seen.add(i);
        nearby++;
      }
    }
    return [...seen];
  }

  private activateAround(i: number, x: number, y: number): void {
    this.layout.setActive(this.neighbourhood(i, x, y));
    this.localAt = [x, y];
    this.localAtTime = this.now();
  }

  private startDrag(i: number, x: number, y: number): void {
    const f = this.layout;
    if (this.dragged >= 0) {
      f.fx[this.dragged] = Number.NaN;
      f.fy[this.dragged] = Number.NaN;
    }
    this.dragged = i;
    // Too slow to swing the whole graph live: swing the neighbourhood. Before
    // any step was timed, judge by size.
    const slow =
      this.stepMs > 0
        ? this.stepMs > LOCAL_DRAG_STEP_MS
        : f.n > LOCAL_DRAG_UNTIMED_FROM;
    if (slow) this.activateAround(i, x, y);
    else if (f.isLocal) {
      f.setActive(null);
      this.localAt = null;
    }
    // alphaTarget(0.3) without touching alpha: the graph warms up gradually.
    this.applyHeat({ alpha: 0, decay: DRAG_DECAY, target: DRAG_ALPHA_TARGET });
  }

  private setGraph(cmd: Extract<LayoutCommand, { type: "graph" }>): void {
    const f = this.layout;
    const n = cmd.ids.length;
    const prev = {
      index: this.index,
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy,
    };
    f.resize(n);
    const index = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const id = cmd.ids[i];
      index.set(id, i);
      f.radius[i] = cmd.radii[i];
      // A node the layout already has keeps its own position and velocity:
      // the layout's copy is the current one, the view's may be a frame old.
      const j = prev.index.get(id);
      if (j !== undefined) {
        f.x[i] = prev.x[j];
        f.y[i] = prev.y[j];
        f.vx[i] = prev.vx[j];
        f.vy[i] = prev.vy[j];
      } else {
        const x = cmd.positions[i * 2];
        const y = cmd.positions[i * 2 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          f.x[i] = x;
          f.y[i] = y;
        }
      }
    }
    const m = cmd.coreIdea.length;
    const src = new Uint32Array(m);
    const dst = new Uint32Array(m);
    const distance = new Float64Array(m);
    let kept = 0;
    for (let k = 0; k < m; k++) {
      const s = cmd.links[k * 2];
      const t = cmd.links[k * 2 + 1];
      if (s >= n || t >= n) continue;
      src[kept] = s;
      dst[kept] = t;
      distance[kept] = cmd.coreIdea[k] === 1 ? 95 : 75;
      kept++;
    }
    f.setLinks(
      src.subarray(0, kept),
      dst.subarray(0, kept),
      distance.subarray(0, kept),
    );
    f.centerX = cmd.center[0];
    f.centerY = cmd.center[1];
    f.initialize();

    // Undirected adjacency, for a local drag's neighbourhood.
    const degree = new Uint32Array(n + 1);
    for (let k = 0; k < kept; k++) {
      degree[src[k] + 1]++;
      degree[dst[k] + 1]++;
    }
    for (let i = 0; i < n; i++) degree[i + 1] += degree[i];
    const adj = new Uint32Array(kept * 2);
    const fill = degree.slice(0, n);
    for (let k = 0; k < kept; k++) {
      adj[fill[src[k]]++] = dst[k];
      adj[fill[dst[k]]++] = src[k];
    }
    this.adjStart = degree;
    this.adj = adj;

    this.index = index;
    this.dragged = -1; // the view re-sends a drag in progress
    this.localAt = null;
    this.pool = []; // sized for the old node count
    this.version = cmd.version;
    if (cmd.heat) this.applyHeat(cmd.heat);
  }

  private applyHeat(heat: Heat): void {
    const f = this.layout;
    this.fast = heat.fast ?? false;
    f.alphaDecay = heat.decay;
    f.alphaTarget = heat.target;
    f.alpha = Math.max(f.alpha, heat.alpha);
    this.running = f.alpha >= f.alphaMin || heat.target >= f.alphaMin;
  }
}
