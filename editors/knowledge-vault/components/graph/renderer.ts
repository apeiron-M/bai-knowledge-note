/**
 * Draws the graph. Three backends, tried in order, so it runs on any machine:
 *
 * - WebGL2, then WebGL1 (with ANGLE_instanced_arrays, which nearly every WebGL1
 *   device has): two instanced draws — every edge, then every node — whose
 *   shaders shape circles, diamonds, halos and outlines. A frame uploads the
 *   positions and nothing else; this is what keeps 100,000 nodes at 60 fps.
 *   The shaders are GLSL ES 1.00, which both versions accept.
 * - Canvas 2D, where there is no WebGL at all (a GPU the browser blocklists,
 *   some remote desktops and VMs). Same picture, slower at very large sizes.
 */
import { CanvasRenderer } from "./canvas-renderer.js";
import { GlRenderer } from "./gl-renderer.js";

/** screen (CSS px) = world × scale + (x, y) */
export type RenderView = { scale: number; x: number; y: number };

/** What there is to draw. The renderer reads these arrays; the view owns and mutates them. */
export type RenderGraph = {
  /** x, y per node; NaN where a node has no position yet (not drawn). */
  pos: Float32Array;
  /** True once every node has a position: the renderer can then upload pos as it is. */
  placed: boolean;
  /** radius, kind (0 note, 1 MoC) per node. */
  meta: Float32Array;
  /** RGBA bytes per node; A is the highlight opacity. */
  nodeColor: Uint8Array;
  src: Uint32Array;
  dst: Uint32Array;
  /** RGBA bytes per edge; A is the opacity (0: not drawn). */
  edgeColor: Uint8Array;
  /** World-space width per edge. */
  edgeWidth: Float32Array;
};

export type RendererKind = "webgl2" | "webgl" | "canvas";

export interface GraphRenderer {
  readonly kind: RendererKind;
  readonly canvas: HTMLCanvasElement;
  /** A new graph (structure changed). */
  setGraph(graph: RenderGraph): void;
  /** The colours (or highlight) changed. */
  markStyles(): void;
  /** The positions changed. */
  markPositions(): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(view: RenderView): void;
  destroy(): void;
}

export const BACKGROUND: [number, number, number] = [
  0x11 / 255,
  0x11 / 255,
  0x1b / 255,
];

/**
 * The best renderer this browser can run, on a fresh canvas. `prefer` skips
 * the better ones (for testing a fallback, or a user setting).
 */
export function createRenderer(prefer: RendererKind = "webgl2"): GraphRenderer {
  const order: RendererKind[] = ["webgl2", "webgl", "canvas"];
  for (const kind of order.slice(order.indexOf(prefer))) {
    const canvas = document.createElement("canvas");
    try {
      if (kind === "canvas") return new CanvasRenderer(canvas);
      const renderer = GlRenderer.create(canvas, kind);
      if (renderer) return renderer;
    } catch (err) {
      console.warn(`[graph] ${kind} renderer unavailable:`, err);
    }
  }
  // CanvasRenderer only throws without a 2D context, which every browser has.
  return new CanvasRenderer(document.createElement("canvas"));
}
