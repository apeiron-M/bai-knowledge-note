/**
 * The Canvas 2D renderer: the fallback for a browser with no WebGL (see
 * renderer.ts). Same picture as the WebGL one. Edges and notes are grouped by
 * look into one path per group, and anything outside the view is skipped, so
 * it stays usable into the tens of thousands of nodes; past that it slows down
 * but keeps working.
 */
import { BACKGROUND } from "./model.js";
import type { GraphRenderer, RenderGraph, RenderView } from "./renderer.js";

type Bucket = { color: string; alpha: number; width: number; items: number[] };

const OUTLINE = "rgb(250,245,255)";
const BG = `rgb(${BACKGROUND.map((c) => Math.round(c * 255)).join(",")})`;

export class CanvasRenderer implements GraphRenderer {
  readonly kind = "canvas";
  private readonly ctx: CanvasRenderingContext2D;
  private graph: RenderGraph | null = null;
  private edgeBuckets: Bucket[] = [];
  private noteBuckets: Bucket[] = [];
  private mocs: number[] = [];
  private stylesDirty = true;
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
  }

  setGraph(graph: RenderGraph): void {
    this.graph = graph;
    this.stylesDirty = true;
  }

  markStyles(): void {
    this.stylesDirty = true;
  }

  markPositions(): void {
    // Positions are read straight from the graph at draw time.
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(this.cssWidth * dpr));
    const h = Math.max(1, Math.round(this.cssHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(view: RenderView): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const g = this.graph;
    if (!g) return;
    if (this.stylesDirty) this.bucket(g);

    const s = view.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, view.x * this.dpr, view.y * this.dpr);
    const px = 1 / s; // world units per device pixel
    // The visible world rectangle, with a margin for the largest node.
    const margin = 80;
    const x0 = -view.x / view.scale - margin;
    const y0 = -view.y / view.scale - margin;
    const x1 = (this.cssWidth - view.x) / view.scale + margin;
    const y1 = (this.cssHeight - view.y) / view.scale + margin;
    const pos = g.pos;

    ctx.lineCap = "butt";
    for (const b of this.edgeBuckets) {
      const width = Math.max(b.width, px);
      ctx.globalAlpha = b.alpha * Math.min(1, b.width / px);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const k of b.items) {
        const sx = pos[g.src[k] * 2];
        const sy = pos[g.src[k] * 2 + 1];
        const tx = pos[g.dst[k] * 2];
        const ty = pos[g.dst[k] * 2 + 1];
        if (
          !(
            Number.isFinite(sx) &&
            Number.isFinite(sy) &&
            Number.isFinite(tx) &&
            Number.isFinite(ty)
          )
        )
          continue;
        if (
          (sx < x0 && tx < x0) ||
          (sx > x1 && tx > x1) ||
          (sy < y0 && ty < y0) ||
          (sy > y1 && ty > y1)
        )
          continue;
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();
    }

    const minR = 1.5 * px;
    for (const b of this.noteBuckets) {
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      let outlined = false;
      for (const i of b.items) {
        const x = pos[i * 2];
        const y = pos[i * 2 + 1];
        if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
        const r = Math.max(g.meta[i * 2], minR);
        if (r < 2 * px) {
          ctx.rect(x - r, y - r, r * 2, r * 2); // a dot: a square is indistinguishable and cheaper
          continue;
        }
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
        outlined = true;
      }
      ctx.fill();
      if (outlined && 0.6 > px * 0.25) {
        ctx.globalAlpha = b.alpha * 0.4;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    for (const i of this.mocs) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
      const alpha = g.nodeColor[i * 4 + 3] / 255;
      if (alpha <= 0) continue;
      const r = Math.max(g.meta[i * 2], minR);
      const color = `rgb(${g.nodeColor[i * 4]},${g.nodeColor[i * 4 + 1]},${g.nodeColor[i * 4 + 2]})`;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.15;
      diamond(ctx, x, y, r + 6);
      ctx.fill();
      ctx.globalAlpha = alpha;
      diamond(ctx, x, y, r);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.95;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.graph = null;
  }

  /** Group edges and notes by how they look, so each group is one path. */
  private bucket(g: RenderGraph): void {
    const edges = new Map<string, Bucket>();
    for (let k = 0; k < g.src.length; k++) {
      const a = g.edgeColor[k * 4 + 3];
      if (a === 0) continue;
      const key = `${g.edgeColor[k * 4]},${g.edgeColor[k * 4 + 1]},${g.edgeColor[k * 4 + 2]}|${a}|${g.edgeWidth[k]}`;
      let b = edges.get(key);
      if (!b) {
        b = {
          color: `rgb(${g.edgeColor[k * 4]},${g.edgeColor[k * 4 + 1]},${g.edgeColor[k * 4 + 2]})`,
          alpha: a / 255,
          width: g.edgeWidth[k],
          items: [],
        };
        edges.set(key, b);
      }
      b.items.push(k);
    }
    const notes = new Map<string, Bucket>();
    const mocs: number[] = [];
    const n = g.meta.length / 2;
    for (let i = 0; i < n; i++) {
      if (g.meta[i * 2 + 1] > 0.5) {
        mocs.push(i);
        continue;
      }
      const a = g.nodeColor[i * 4 + 3];
      if (a === 0) continue;
      const key = `${g.nodeColor[i * 4]},${g.nodeColor[i * 4 + 1]},${g.nodeColor[i * 4 + 2]}|${a}`;
      let b = notes.get(key);
      if (!b) {
        b = {
          color: `rgb(${g.nodeColor[i * 4]},${g.nodeColor[i * 4 + 1]},${g.nodeColor[i * 4 + 2]})`,
          alpha: a / 255,
          width: 0,
          items: [],
        };
        notes.set(key, b);
      }
      b.items.push(i);
    }
    this.edgeBuckets = [...edges.values()];
    this.noteBuckets = [...notes.values()];
    this.mocs = mocs;
    this.stylesDirty = false;
  }
}

function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}
