/**
 * The WebGL renderer (WebGL2, or WebGL1 with ANGLE_instanced_arrays). See
 * renderer.ts for why it is built this way.
 *
 * Every node is one instance of a quad and every edge another. Per-node and
 * per-edge attributes live in buffers that are only re-uploaded when they
 * change: colours when the highlight moves, the rest when the graph changes.
 * Positions are what changes every frame, and there the two versions differ:
 *
 * - WebGL2: positions are one float texture. Nodes find theirs by instance
 *   number and edges by the indices of their ends (texelFetch), so a frame
 *   uploads 8 bytes per node and nothing per edge.
 * - WebGL1 (or a WebGL2 driver that rejects those shaders): positions are a
 *   per-node attribute and both ends of every edge are gathered on the CPU
 *   into a per-edge attribute — 16 more bytes per edge each frame.
 *
 * Antialiasing is done in the shaders (no MSAA): cheaper on weak GPUs and the
 * same at every zoom.
 */
import { BACKGROUND } from "./model.js";
import type {
  GraphRenderer,
  RenderGraph,
  RendererKind,
  RenderView,
} from "./renderer.js";

/** Off-screen stand-in for a node with no position: the shaders skip it. */
const UNPLACED = 1e20;
/** Width of the position texture (WebGL2 guarantees 2048). */
const POS_TEXTURE_WIDTH = 2048;

/* ------------------------------------------------------------------ */
/*  Shaders, written once in GLSL ES 1.00 and translated to 3.00        */
/* ------------------------------------------------------------------ */

/** Where a vertex shader finds positions: attributes (WebGL1) or the texture (WebGL2). */
type PositionSource = "attribute" | "texture";

const FETCH = `
uniform highp sampler2D uPos;
uniform int uPosWidth;
vec2 fetchPos(int i) {
  return texelFetch(uPos, ivec2(i - (i / uPosWidth) * uPosWidth, i / uPosWidth), 0).xy;
}
`;

function nodeVertex(src: PositionSource): string {
  return `
precision highp float;
attribute vec2 aCorner;
${src === "attribute" ? "attribute vec2 aPos;" : FETCH}
attribute vec2 aMeta;
attribute vec4 aColor;
uniform vec4 uView;
uniform float uPx;
varying vec2 vLocal;
varying vec4 vColor;
varying float vRadius;
varying float vKind;
void main() {
  vec2 pos = ${src === "attribute" ? "aPos" : "fetchPos(gl_InstanceID)"};
  vColor = aColor;
  vKind = aMeta.y;
  if (abs(pos.x) > 1e19 || aColor.a <= 0.0) {
    vLocal = vec2(0.0);
    vRadius = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Never smaller than about a pixel and a half, so a zoomed-out vault stays visible.
  float r = max(aMeta.x, 1.5 * uPx);
  float extent = r + (aMeta.y > 0.5 ? 7.0 : 0.5) + 1.5 * uPx;
  vLocal = aCorner * extent;
  vRadius = r;
  gl_Position = vec4((pos + vLocal) * uView.xy + uView.zw, 0.0, 1.0);
}
`;
}

const NODE_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uPx;
varying vec2 vLocal;
varying vec4 vColor;
varying float vRadius;
varying float vKind;
const vec3 OUTLINE = vec3(0.980, 0.961, 1.0);
// Coverage of a shape at signed distance d (world units, negative inside), one device pixel soft.
float cover(float d) { return clamp(0.5 - d / uPx, 0.0, 1.0); }
void main() {
  vec4 c;
  if (vKind < 0.5) {
    // A note: a disc with a faint 0.6-wide outline at 40 %.
    float d = length(vLocal) - vRadius;
    float ring = cover(abs(d) - 0.3) * 0.4;
    c = vec4(vColor.rgb, 1.0) * cover(d);
    c = vec4(OUTLINE, 1.0) * ring + c * (1.0 - ring);
  } else {
    // A MoC: a diamond with a soft halo 6 out at 15 % and a 2-wide outline at 95 %.
    float l1 = abs(vLocal.x) + abs(vLocal.y);
    float d = (l1 - vRadius) * 0.70710678;
    float halo = cover((l1 - vRadius - 6.0) * 0.70710678) * 0.15;
    float fill = cover(d);
    float ring = cover(abs(d) - 1.0) * 0.95;
    c = vec4(vColor.rgb, 1.0) * halo;
    c = vec4(vColor.rgb, 1.0) * fill + c * (1.0 - fill);
    c = vec4(OUTLINE, 1.0) * ring + c * (1.0 - ring);
  }
  gl_FragColor = c * vColor.a;
}
`;

function edgeVertex(src: PositionSource): string {
  return `
precision highp float;
attribute vec2 aCorner;
${src === "attribute" ? "attribute vec4 aEnds;" : `attribute vec2 aIdx;\n${FETCH}`}
attribute vec4 aColor;
attribute float aWidth;
uniform vec4 uView;
uniform float uPx;
varying vec4 vColor;
varying float vAcross;
varying float vHalf;
void main() {
  ${
    src === "attribute"
      ? "vec2 a = aEnds.xy;\n  vec2 b = aEnds.zw;"
      : "vec2 a = fetchPos(int(aIdx.x));\n  vec2 b = fetchPos(int(aIdx.y));"
  }
  vec2 d = b - a;
  float len = length(d);
  if (aColor.a <= 0.0 || len < 1e-6 || abs(a.x) > 1e19 || abs(b.x) > 1e19) {
    vColor = vec4(0.0);
    vAcross = 0.0;
    vHalf = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 n = vec2(-d.y, d.x) / len;
  // Width in world units, as before; thinner than a device pixel, it is drawn
  // one pixel wide and correspondingly fainter instead of breaking up.
  float halfPx = 0.5 * aWidth / uPx;
  float drawn = max(halfPx, 0.5);
  float extent = drawn + 1.0;
  vAcross = aCorner.y * extent;
  vHalf = drawn;
  vColor = vec4(aColor.rgb, aColor.a * min(1.0, halfPx / 0.5));
  vec2 world = a + d * aCorner.x + n * (aCorner.y * extent * uPx);
  gl_Position = vec4(world * uView.xy + uView.zw, 0.0, 1.0);
}
`;
}

const EDGE_FRAGMENT = `
precision mediump float;
varying vec4 vColor;
varying float vAcross;
varying float vHalf;
void main() {
  float a = vColor.a * clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0);
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/** GLSL ES 1.00 → 3.00: the same shader in WebGL2's language (needed for texelFetch and gl_InstanceID). */
function toGlsl300(source: string, stage: "vertex" | "fragment"): string {
  let s = source
    .replace(/\battribute\b/g, "in")
    .replace(/\bvarying\b/g, stage === "vertex" ? "out" : "in");
  if (stage === "fragment")
    s = s
      .replace(/\bgl_FragColor\b/g, "fragColor")
      .replace(/void main\(\)/, "out vec4 fragColor;\nvoid main()");
  return `#version 300 es\n${s}`;
}

/* ------------------------------------------------------------------ */
/*  Renderer                                                            */
/* ------------------------------------------------------------------ */

type Instancing = {
  divisor(location: number, divisor: number): void;
  drawStrip(instances: number): void;
};

type Program = {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uView: WebGLUniformLocation | null;
  uPx: WebGLUniformLocation | null;
  uPos: WebGLUniformLocation | null;
  uPosWidth: WebGLUniformLocation | null;
};

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

type Resources = {
  /** Positions as attributes: works everywhere. */
  nodeAttr: Program;
  edgeAttr: Program;
  /** Positions from the texture: WebGL2 only, null if its shaders were rejected. */
  nodeTex: Program | null;
  edgeTex: Program | null;
  posTexture: WebGLTexture | null;
  nodeQuad: WebGLBuffer;
  edgeQuad: WebGLBuffer;
  pos: WebGLBuffer;
  meta: WebGLBuffer;
  nodeColor: WebGLBuffer;
  ends: WebGLBuffer;
  idx: WebGLBuffer;
  edgeColor: WebGLBuffer;
  edgeWidth: WebGLBuffer;
};

export class GlRenderer implements GraphRenderer {
  private gl: Gl;
  private gl2: WebGL2RenderingContext | null;
  private instancing: Instancing;
  private res: Resources;
  private graph: RenderGraph | null = null;
  private lost = false;
  private dirtyGraph = false;
  private dirtyStyles = false;
  private dirtyPositions = false;
  /** Positions with UNPLACED for NaN, as uploaded (padded to whole texture rows in texture mode). */
  private posUpload = new Float32Array(0);
  /** Both ends of every edge, gathered for the attribute path. */
  private endsUpload = new Float32Array(0);
  /** Whether this graph is drawn through the position texture. */
  private textured = false;
  private texRows = 0;
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;
  private readonly onLost: (e: Event) => void;
  private readonly onRestored: () => void;

  /** A WebGL renderer of this kind, or null when the browser cannot provide one. */
  static create(
    canvas: HTMLCanvasElement,
    kind: Exclude<RendererKind, "canvas">,
  ): GlRenderer | null {
    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      // Kept between frames. The graph draws only when something changes, and
      // WebKitGTK (the desktop app's webview, on its non-DMA-BUF path) does
      // not hold on to the last frame otherwise: captured on screen, the
      // graph showed for one frame, vanished, and came back only when the
      // next change redrew it — 4 s after opening, and on every hover.
      // Preserved, it is on screen ~150 ms after opening and stays there.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    };
    const gl = canvas.getContext(
      kind === "webgl2" ? "webgl2" : "webgl",
      attrs,
    ) as Gl | null;
    if (!gl) return null;
    const instancing = GlRenderer.instancing(gl);
    if (!instancing) return null;
    return new GlRenderer(canvas, gl, kind, instancing);
  }

  private static isGl2(gl: Gl): gl is WebGL2RenderingContext {
    return (
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
    );
  }

  private static instancing(gl: Gl): Instancing | null {
    if (GlRenderer.isGl2(gl)) {
      return {
        divisor: (l, d) => gl.vertexAttribDivisor(l, d),
        drawStrip: (count) =>
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count),
      };
    }
    const ext = gl.getExtension("ANGLE_instanced_arrays");
    if (!ext) return null;
    return {
      divisor: (l, d) => ext.vertexAttribDivisorANGLE(l, d),
      drawStrip: (count) =>
        ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count),
    };
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: Gl,
    readonly kind: RendererKind,
    instancing: Instancing,
  ) {
    this.gl = gl;
    this.gl2 = GlRenderer.isGl2(gl) ? gl : null;
    this.instancing = instancing;
    this.res = this.createResources();
    // A GPU reset or driver update takes the context away; get it back.
    this.onLost = (e) => {
      e.preventDefault();
      this.lost = true;
    };
    this.onRestored = () => {
      this.instancing = GlRenderer.instancing(this.gl) ?? this.instancing;
      this.res = this.createResources();
      this.lost = false;
      this.dirtyGraph = true;
    };
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  setGraph(graph: RenderGraph): void {
    this.graph = graph;
    this.dirtyGraph = true;
  }

  markStyles(): void {
    this.dirtyStyles = true;
  }

  markPositions(): void {
    this.dirtyPositions = true;
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
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) return;
    const g = this.graph;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!g) return;
    const n = g.meta.length / 2;
    const m = g.src.length;
    this.upload(g, n, m);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // world → clip: x' = x · 2s/W + (2X/W − 1), y' = −y · 2s/H + (1 − 2Y/H)
    const sx = (2 * view.scale) / this.cssWidth;
    const sy = (-2 * view.scale) / this.cssHeight;
    const ox = (2 * view.x) / this.cssWidth - 1;
    const oy = 1 - (2 * view.y) / this.cssHeight;
    const px = 1 / (view.scale * this.dpr); // world units per device pixel
    const r = this.res;
    const textured = this.textured;

    if (m > 0) {
      const p = textured && r.edgeTex ? r.edgeTex : r.edgeAttr;
      this.use(p, sx, sy, ox, oy, px);
      this.bindAttrib(p, "aCorner", r.edgeQuad, 2, gl.FLOAT, false, 0);
      if (textured) this.bindAttrib(p, "aIdx", r.idx, 2, gl.FLOAT, false, 1);
      else this.bindAttrib(p, "aEnds", r.ends, 4, gl.FLOAT, false, 1);
      this.bindAttrib(p, "aColor", r.edgeColor, 4, gl.UNSIGNED_BYTE, true, 1);
      this.bindAttrib(p, "aWidth", r.edgeWidth, 1, gl.FLOAT, false, 1);
      this.instancing.drawStrip(m);
      this.unbind(p);
    }
    if (n > 0) {
      const p = textured && r.nodeTex ? r.nodeTex : r.nodeAttr;
      this.use(p, sx, sy, ox, oy, px);
      this.bindAttrib(p, "aCorner", r.nodeQuad, 2, gl.FLOAT, false, 0);
      if (!textured) this.bindAttrib(p, "aPos", r.pos, 2, gl.FLOAT, false, 1);
      this.bindAttrib(p, "aMeta", r.meta, 2, gl.FLOAT, false, 1);
      this.bindAttrib(p, "aColor", r.nodeColor, 4, gl.UNSIGNED_BYTE, true, 1);
      this.instancing.drawStrip(n);
      this.unbind(p);
    }
  }

  destroy(): void {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    const gl = this.gl;
    if (!gl.isContextLost()) {
      const r = this.res;
      for (const b of [
        r.nodeQuad,
        r.edgeQuad,
        r.pos,
        r.meta,
        r.nodeColor,
        r.ends,
        r.idx,
        r.edgeColor,
        r.edgeWidth,
      ]) {
        gl.deleteBuffer(b);
      }
      for (const p of [r.nodeAttr, r.edgeAttr, r.nodeTex, r.edgeTex])
        if (p) gl.deleteProgram(p.program);
      if (r.posTexture) gl.deleteTexture(r.posTexture);
      // Hand the context back now rather than at garbage collection: browsers cap live contexts.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }

  private use(
    p: Program,
    sx: number,
    sy: number,
    ox: number,
    oy: number,
    px: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(p.program);
    gl.uniform4f(p.uView, sx, sy, ox, oy);
    gl.uniform1f(p.uPx, px);
    if (p.uPos && this.res.posTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.res.posTexture);
      gl.uniform1i(p.uPos, 0);
      gl.uniform1i(p.uPosWidth, POS_TEXTURE_WIDTH);
    }
  }

  private upload(g: RenderGraph, n: number, m: number): void {
    const gl = this.gl;
    const gl2 = this.gl2;
    const r = this.res;
    if (this.dirtyGraph) {
      const rows = Math.max(1, Math.ceil(n / POS_TEXTURE_WIDTH));
      const maxSize = gl2
        ? (gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number)
        : 0;
      this.textured = !!(
        gl2 &&
        r.posTexture &&
        r.nodeTex &&
        r.edgeTex &&
        rows <= maxSize
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, r.meta);
      gl.bufferData(gl.ARRAY_BUFFER, g.meta, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.edgeWidth);
      gl.bufferData(gl.ARRAY_BUFFER, g.edgeWidth, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.nodeColor);
      gl.bufferData(gl.ARRAY_BUFFER, g.nodeColor.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.edgeColor);
      gl.bufferData(gl.ARRAY_BUFFER, g.edgeColor.byteLength, gl.DYNAMIC_DRAW);
      if (this.textured && gl2) {
        this.texRows = rows;
        this.posUpload = new Float32Array(rows * POS_TEXTURE_WIDTH * 2).fill(
          UNPLACED,
        );
        gl2.bindTexture(gl2.TEXTURE_2D, r.posTexture);
        // Allocated with data: a partial upload into an uninitialised texture
        // makes some browsers (Firefox) clear it lazily, which is slow.
        gl2.texImage2D(
          gl2.TEXTURE_2D,
          0,
          gl2.RG32F,
          POS_TEXTURE_WIDTH,
          rows,
          0,
          gl2.RG,
          gl2.FLOAT,
          new Float32Array(rows * POS_TEXTURE_WIDTH * 2).fill(UNPLACED),
        );
        // Edges name their ends by index; static until the graph changes.
        const idx = new Float32Array(m * 2);
        for (let k = 0; k < m; k++) {
          idx[k * 2] = g.src[k];
          idx[k * 2 + 1] = g.dst[k];
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, r.idx);
        gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      } else {
        this.posUpload = new Float32Array(n * 2);
        this.endsUpload = new Float32Array(m * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, r.pos);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          this.posUpload.byteLength,
          gl.DYNAMIC_DRAW,
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, r.ends);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          this.endsUpload.byteLength,
          gl.DYNAMIC_DRAW,
        );
      }
      this.dirtyGraph = false;
      this.dirtyStyles = true;
      this.dirtyPositions = true;
    }
    if (this.dirtyStyles) {
      gl.bindBuffer(gl.ARRAY_BUFFER, r.nodeColor);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.nodeColor);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.edgeColor);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.edgeColor);
      this.dirtyStyles = false;
    }
    if (this.dirtyPositions) {
      // Positions as uploaded: pos itself once every node has one, else a
      // copy with the unplaced ones moved off-screen.
      let up = g.pos;
      if (!g.placed) {
        up = this.posUpload;
        const pos = g.pos;
        for (let i = 0; i < n * 2; i++) {
          const v = pos[i];
          up[i] = v === v ? v : UNPLACED; // NaN → off-screen
        }
      }
      if (this.textured && gl2) {
        gl2.bindTexture(gl2.TEXTURE_2D, r.posTexture);
        const full = Math.floor(n / POS_TEXTURE_WIDTH);
        if (full > 0) {
          gl2.texSubImage2D(
            gl2.TEXTURE_2D,
            0,
            0,
            0,
            POS_TEXTURE_WIDTH,
            full,
            gl2.RG,
            gl2.FLOAT,
            up.subarray(0, full * POS_TEXTURE_WIDTH * 2),
          );
        }
        const rest = n - full * POS_TEXTURE_WIDTH;
        if (rest > 0) {
          gl2.texSubImage2D(
            gl2.TEXTURE_2D,
            0,
            0,
            full,
            rest,
            1,
            gl2.RG,
            gl2.FLOAT,
            up.subarray(full * POS_TEXTURE_WIDTH * 2, n * 2),
          );
        }
      } else {
        const ends = this.endsUpload;
        const { src, dst } = g;
        for (let k = 0; k < m; k++) {
          const s = src[k] * 2;
          const t = dst[k] * 2;
          const o = k * 4;
          ends[o] = up[s];
          ends[o + 1] = up[s + 1];
          ends[o + 2] = up[t];
          ends[o + 3] = up[t + 1];
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, r.pos);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, up.subarray(0, n * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, r.ends);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, ends);
      }
      this.dirtyPositions = false;
    }
  }

  private bindAttrib(
    p: Program,
    name: string,
    buffer: WebGLBuffer,
    size: number,
    type: number,
    normalized: boolean,
    divisor: number,
  ): void {
    const gl = this.gl;
    const loc = p.attribs[name] ?? -1;
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    this.instancing.divisor(loc, divisor);
  }

  /** Leave every attribute as WebGL1 expects to find it: disabled, not instanced. */
  private unbind(p: Program): void {
    for (const loc of Object.values(p.attribs)) {
      if (loc < 0) continue;
      this.instancing.divisor(loc, 0);
      this.gl.disableVertexAttribArray(loc);
    }
  }

  private createResources(): Resources {
    const gl = this.gl;
    const buffer = (data?: Float32Array): WebGLBuffer => {
      // Null when the context is lost, whatever the typings say.
      const b = gl.createBuffer() as WebGLBuffer | null;
      if (!b) throw new Error("WebGL: could not create a buffer");
      if (data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      }
      return b;
    };
    const nodeAttribs = ["aCorner", "aPos", "aMeta", "aColor"];
    const edgeAttribs = ["aCorner", "aEnds", "aIdx", "aColor", "aWidth"];
    let nodeTex: Program | null = null;
    let edgeTex: Program | null = null;
    let posTexture: WebGLTexture | null = null;
    const gl2 = this.gl2;
    if (gl2) {
      try {
        nodeTex = this.program(
          toGlsl300(nodeVertex("texture"), "vertex"),
          toGlsl300(NODE_FRAGMENT, "fragment"),
          nodeAttribs,
        );
        edgeTex = this.program(
          toGlsl300(edgeVertex("texture"), "vertex"),
          toGlsl300(EDGE_FRAGMENT, "fragment"),
          edgeAttribs,
        );
        posTexture = gl2.createTexture() as WebGLTexture | null;
        if (posTexture) {
          gl2.bindTexture(gl2.TEXTURE_2D, posTexture);
          // Float textures are not filterable everywhere; texelFetch needs none.
          gl2.texParameteri(
            gl2.TEXTURE_2D,
            gl2.TEXTURE_MIN_FILTER,
            gl2.NEAREST,
          );
          gl2.texParameteri(
            gl2.TEXTURE_2D,
            gl2.TEXTURE_MAG_FILTER,
            gl2.NEAREST,
          );
          gl2.texParameteri(
            gl2.TEXTURE_2D,
            gl2.TEXTURE_WRAP_S,
            gl2.CLAMP_TO_EDGE,
          );
          gl2.texParameteri(
            gl2.TEXTURE_2D,
            gl2.TEXTURE_WRAP_T,
            gl2.CLAMP_TO_EDGE,
          );
        }
      } catch (err) {
        console.warn(
          "[graph] WebGL2 position-texture shaders unavailable, using attributes:",
          err,
        );
        nodeTex = null;
        edgeTex = null;
      }
    }
    return {
      nodeAttr: this.program(
        nodeVertex("attribute"),
        NODE_FRAGMENT,
        nodeAttribs,
      ),
      edgeAttr: this.program(
        edgeVertex("attribute"),
        EDGE_FRAGMENT,
        edgeAttribs,
      ),
      nodeTex,
      edgeTex,
      posTexture,
      nodeQuad: buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])),
      // along (0 at the source, 1 at the target), across (−1, +1)
      edgeQuad: buffer(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1])),
      pos: buffer(),
      meta: buffer(),
      nodeColor: buffer(),
      ends: buffer(),
      idx: buffer(),
      edgeColor: buffer(),
      edgeWidth: buffer(),
    };
  }

  private program(
    vertex: string,
    fragment: string,
    attribs: string[],
  ): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("WebGL: could not create a shader");
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(
          `WebGL shader: ${gl.getShaderInfoLog(s) ?? "compile failed"}`,
        );
      }
      return s;
    };
    const program = gl.createProgram() as WebGLProgram | null;
    if (!program) throw new Error("WebGL: could not create a program");
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // WebGL1 wants attribute 0 to be a per-vertex array: the quad corner.
    gl.bindAttribLocation(program, 0, "aCorner");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (
      !gl.getProgramParameter(program, gl.LINK_STATUS) &&
      !gl.isContextLost()
    ) {
      throw new Error(
        `WebGL program: ${gl.getProgramInfoLog(program) ?? "link failed"}`,
      );
    }
    const locs: Record<string, number> = {};
    for (const a of attribs) locs[a] = gl.getAttribLocation(program, a);
    return {
      program,
      attribs: locs,
      uView: gl.getUniformLocation(program, "uView"),
      uPx: gl.getUniformLocation(program, "uPx"),
      uPos: gl.getUniformLocation(program, "uPos"),
      uPosWidth: gl.getUniformLocation(program, "uPosWidth"),
    };
  }
}
