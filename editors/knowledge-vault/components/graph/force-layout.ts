/**
 * d3-force, re-implemented over typed arrays for large graphs.
 *
 * The same simulation the graph has always used — many-body repulsion
 * (Barnes–Hut), link springs, centring, x/y pull and collision, with the same
 * velocity Verlet step — and the same arithmetic: the quadtree is built the way
 * d3-quadtree builds it, walked in the same order, and coincident points are
 * jiggled from d3's own random stream. force-layout.test.ts holds it to d3's
 * results. What changes is the cost: no object per node or per quad and no
 * allocation per step, so a step at 100,000 nodes takes a fraction of a second
 * where d3 takes seconds.
 *
 * Two additions for large graphs:
 * - spatialOrder: from SPATIAL_ORDER_FROM nodes, nodes are walked in space
 *   order, which keeps the walk in cache.
 * - setActive: while a node is dragged in a large graph, only its
 *   neighbourhood moves; the rest is a frozen backdrop it collides with and is
 *   repelled by. A step then costs the neighbourhood, not the graph, so what
 *   follows the pointer moves in real time at any size.
 *
 * Self-contained (no imports): it is bundled into the layout worker.
 */

/** d3's initial phyllotaxis placement. */
const INITIAL_RADIUS = 10;
const INITIAL_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Below this, nodes are walked in d3's (index) order: exactly d3's results. */
export const SPATIAL_ORDER_FROM = 5000;

/** d3's linear congruential generator (lcg.js), seeded as d3 seeds it. */
function lcg(): () => number {
  let s = 1;
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;
}

/**
 * A point quadtree laid out flat: d3-quadtree's addAll, cover and add, over a
 * subset of the nodes. One slot per quad; a leaf holds the head of a chain of
 * coincident points. Each quad knows its cell (corner and side), so walks
 * carry no extents.
 */
class QuadTree {
  cap = 0;
  count = 0;
  root = -1;
  child: Int32Array = new Int32Array(0); // 4 per quad, -1 when empty
  point: Int32Array = new Int32Array(0); // head point of a leaf, -1 for an internal quad
  cx: Float64Array = new Float64Array(0); // centre of charge
  cy: Float64Array = new Float64Array(0);
  charge: Float64Array = new Float64Array(0); // total charge
  reach: Float64Array = new Float64Array(0); // largest collision radius inside
  x0: Float64Array = new Float64Array(0);
  y0: Float64Array = new Float64Array(0);
  size: Float64Array = new Float64Array(0);
  /** Next coincident point of a leaf chain, per node. */
  next: Int32Array;
  /** The coordinates the tree was built on, per node. */
  px: Float64Array;
  py: Float64Array;
  /** Quads in d3's visitAfter push order: read from the end for a post-order. */
  order: Int32Array = new Int32Array(0);
  orderCount = 0;
  maxDepth = 0;
  private ex0 = 0;
  private ey0 = 0;
  private ex1 = 0;
  private ey1 = 0;

  constructor(n: number) {
    this.next = new Int32Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
  }

  /**
   * Build over the given nodes (all of them when `members` is null), at
   * (x + vx, y + vy) when velocities are given, else at (x, y).
   */
  build(
    members: Int32Array | null,
    memberCount: number,
    x: Float64Array,
    y: Float64Array,
    vx: Float64Array | null,
    vy: Float64Array | null,
  ): void {
    const { px, py } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < memberCount; k++) {
      const i = members ? members[k] : k;
      const xi = vx ? x[i] + vx[i] : x[i];
      const yi = vy ? y[i] + vy[i] : y[i];
      px[i] = xi;
      py[i] = yi;
      if (Number.isNaN(xi) || Number.isNaN(yi)) continue;
      if (xi < x0) x0 = xi;
      if (xi > x1) x1 = xi;
      if (yi < y0) y0 = yi;
      if (yi > y1) y1 = yi;
    }
    this.count = 0;
    this.root = -1;
    this.maxDepth = 0;
    this.orderCount = 0;
    if (x0 > x1 || y0 > y1) return;
    if (this.cap < memberCount * 2 + 16) this.grow(memberCount * 2 + 16);

    // cover(x0, y0), then cover(x1, y1): a square from the floor of the
    // minimum, doubled until it holds the maximum.
    this.ex0 = Math.floor(x0);
    this.ey0 = Math.floor(y0);
    let z = 1;
    this.ex1 = this.ex0 + 1;
    this.ey1 = this.ey0 + 1;
    while (this.ex0 > x1 || x1 >= this.ex1 || this.ey0 > y1 || y1 >= this.ey1) {
      z *= 2;
      this.ex1 = this.ex0 + z;
      this.ey1 = this.ey0 + z;
    }
    for (let k = 0; k < memberCount; k++) {
      const i = members ? members[k] : k;
      this.add(i, px[i], py[i]);
    }
    this.postOrder();
  }

  /** visitAfter(accumulate) for many-body: centre and total of the charge. */
  accumulateCharge(charge: number): void {
    const { child, point, cx, cy, next, px, py, order } = this;
    const q4 = this.charge;
    for (let k = this.orderCount - 1; k >= 0; k--) {
      const q = order[k];
      const head = point[q];
      if (head < 0) {
        let strength = 0;
        let weight = 0;
        let sx = 0;
        let sy = 0;
        for (let c = 0; c < 4; c++) {
          const ch = child[q * 4 + c];
          if (ch < 0) continue;
          const v = q4[ch];
          const w = Math.abs(v);
          if (!w) continue;
          strength += v;
          weight += w;
          sx += w * cx[ch];
          sy += w * cy[ch];
        }
        cx[q] = sx / weight;
        cy[q] = sy / weight;
        q4[q] = strength;
      } else {
        cx[q] = px[head];
        cy[q] = py[head];
        let strength = 0;
        for (let p = head; p >= 0; p = next[p]) strength += charge;
        q4[q] = strength;
      }
    }
  }

  /** visitAfter(prepare) for collide: the largest radius per quad (a leaf counts its head only, as d3 does). */
  accumulateReach(radius: Float64Array, pad: number): void {
    const { child, point, reach, order } = this;
    for (let k = this.orderCount - 1; k >= 0; k--) {
      const q = order[k];
      const head = point[q];
      if (head >= 0) {
        reach[q] = radius[head] + pad;
        continue;
      }
      let r = 0;
      for (let c = 0; c < 4; c++) {
        const ch = child[q * 4 + c];
        if (ch >= 0 && reach[ch] > r) r = reach[ch];
      }
      reach[q] = r;
    }
  }

  /** A stack deep enough for any walk of this tree. */
  stackFor(stack: Int32Array): Int32Array {
    // A walk holds at most three siblings per level, plus the quad itself.
    return stack.length >= this.maxDepth * 3 + 8
      ? stack
      : new Int32Array(this.maxDepth * 6 + 16);
  }

  private add(i: number, X: number, Y: number): void {
    if (Number.isNaN(X) || Number.isNaN(Y)) return;
    const { px, py, next } = this;
    let x0 = this.ex0;
    let y0 = this.ey0;
    let x1 = this.ex1;
    let y1 = this.ey1;
    if (this.root < 0) {
      this.root = this.newQuad(i, x0, y0, x1 - x0);
      next[i] = -1;
      return;
    }
    let parent = -1;
    let node = this.root;
    let slot = 0;
    let depth = 0;
    while (this.point[node] < 0) {
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      const right = X >= xm;
      const bottom = Y >= ym;
      if (right) x0 = xm;
      else x1 = xm;
      if (bottom) y0 = ym;
      else y1 = ym;
      parent = node;
      depth++;
      slot = ((bottom ? 1 : 0) << 1) | (right ? 1 : 0);
      node = this.child[parent * 4 + slot];
      if (node < 0) {
        this.child[parent * 4 + slot] = this.newQuad(i, x0, y0, x1 - x0);
        next[i] = -1;
        if (depth > this.maxDepth) this.maxDepth = depth;
        return;
      }
    }
    const head = this.point[node];
    const xp = px[head];
    const yp = py[head];
    if (X === xp && Y === yp) {
      // Coincident: the new point becomes the leaf's head, as in d3.
      next[i] = head;
      this.point[node] = i;
      return;
    }
    let j: number;
    do {
      const q = this.newQuad(-1, x0, y0, x1 - x0);
      if (parent < 0) this.root = q;
      else this.child[parent * 4 + slot] = q;
      parent = q;
      depth++;
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      const right = X >= xm;
      const bottom = Y >= ym;
      if (right) x0 = xm;
      else x1 = xm;
      if (bottom) y0 = ym;
      else y1 = ym;
      slot = ((bottom ? 1 : 0) << 1) | (right ? 1 : 0);
      j = ((yp >= ym ? 1 : 0) << 1) | (xp >= xm ? 1 : 0);
    } while (slot === j);
    // The old leaf moves down into the sibling of the new point's cell.
    const size = x1 - x0;
    this.x0[node] =
      j & 1 ? (slot & 1 ? x0 : x0 + size) : slot & 1 ? x0 - size : x0;
    this.y0[node] =
      j & 2 ? (slot & 2 ? y0 : y0 + size) : slot & 2 ? y0 - size : y0;
    this.size[node] = size;
    this.child[parent * 4 + j] = node;
    this.child[parent * 4 + slot] = this.newQuad(i, x0, y0, size);
    next[i] = -1;
    if (depth > this.maxDepth) this.maxDepth = depth;
  }

  private newQuad(point: number, x0: number, y0: number, size: number): number {
    if (this.count === this.cap) this.grow(this.cap * 2);
    const q = this.count++;
    this.point[q] = point;
    this.x0[q] = x0;
    this.y0[q] = y0;
    this.size[q] = size;
    const c = q * 4;
    this.child[c] = -1;
    this.child[c + 1] = -1;
    this.child[c + 2] = -1;
    this.child[c + 3] = -1;
    return q;
  }

  private grow(cap: number): void {
    const ints = (a: Int32Array, size: number) => {
      const b = new Int32Array(size);
      b.set(a.subarray(0, Math.min(a.length, size)));
      return b;
    };
    const floats = (a: Float64Array, size: number) => {
      const b = new Float64Array(size);
      b.set(a.subarray(0, Math.min(a.length, size)));
      return b;
    };
    this.child = ints(this.child, cap * 4);
    this.point = ints(this.point, cap);
    this.cx = floats(this.cx, cap);
    this.cy = floats(this.cy, cap);
    this.charge = floats(this.charge, cap);
    this.reach = floats(this.reach, cap);
    this.x0 = floats(this.x0, cap);
    this.y0 = floats(this.y0, cap);
    this.size = floats(this.size, cap);
    this.cap = cap;
  }

  private postOrder(): void {
    if (this.order.length < this.count) this.order = new Int32Array(this.cap);
    const { order, child, point } = this;
    const stack = new Int32Array(this.count + 4);
    let n = 0;
    let top = 0;
    stack[top++] = this.root;
    while (top > 0) {
      const q = stack[--top];
      if (point[q] < 0) {
        const c = q * 4;
        for (let k = 0; k < 4; k++)
          if (child[c + k] >= 0) stack[top++] = child[c + k];
      }
      order[n++] = q;
    }
    this.orderCount = n;
  }
}

export class ForceLayout {
  /* ---- nodes (structure of arrays) ---- */
  n = 0;
  x: Float64Array = new Float64Array(0);
  y: Float64Array = new Float64Array(0);
  vx: Float64Array = new Float64Array(0);
  vy: Float64Array = new Float64Array(0);
  /** Fixed position, or NaN when the node is free (d3's fx/fy == null). */
  fx: Float64Array = new Float64Array(0);
  fy: Float64Array = new Float64Array(0);
  radius: Float64Array = new Float64Array(0);

  /* ---- links ---- */
  m = 0;
  src: Uint32Array = new Uint32Array(0);
  dst: Uint32Array = new Uint32Array(0);
  distance: Float64Array = new Float64Array(0);
  private bias: Float64Array = new Float64Array(0);

  /* ---- simulation, as d3 configures it ---- */
  alpha = 1;
  alphaMin = 0.001;
  alphaDecay = 0.02;
  alphaTarget = 0;
  /** 1 − d3's velocityDecay(0.4). */
  velocityFactor = 0.6;

  /* ---- forces, as the graph configures them ---- */
  charge = -220;
  theta2 = 0.81;
  distanceMin2 = 1;
  linkStrength = 0.25;
  centerX = 0;
  centerY = 0;
  pullStrength = 0.06;
  collidePadding = 6;
  collideStrength = 0.9;
  collideIterations = 2;
  /**
   * Walk the nodes in space (tree) order instead of index order. Nodes close
   * in space then take nearly the same path through the tree, which keeps the
   * walk in cache: ~1.5× faster from tens of thousands of nodes. It changes
   * the order collisions are resolved in (and which random number jiggles a
   * coincident point), so results stop being d3's to the last digit, while
   * the layout stays the same. "auto": from SPATIAL_ORDER_FROM nodes.
   */
  spatialOrder: boolean | "auto" = "auto";

  private readonly random = lcg();
  private tree = new QuadTree(0);
  private stack: Int32Array = new Int32Array(256);
  /** The order nodes are walked in this step. */
  private walk: Int32Array = new Int32Array(0);

  /* ---- local mode (setActive) ---- */
  private active: Uint8Array | null = null;
  private activeList: Int32Array = new Int32Array(0);
  private activeCount = 0;
  /** The frozen rest of the graph, built once when the local mode starts. */
  private frozen = new QuadTree(0);
  /** Links with at least one active end. */
  private localLinks: Int32Array = new Int32Array(0);

  /** Size the node arrays for `n` nodes; every value starts unset (NaN). */
  resize(n: number): void {
    this.n = n;
    this.x = new Float64Array(n).fill(Number.NaN);
    this.y = new Float64Array(n).fill(Number.NaN);
    this.vx = new Float64Array(n).fill(Number.NaN);
    this.vy = new Float64Array(n).fill(Number.NaN);
    this.fx = new Float64Array(n).fill(Number.NaN);
    this.fy = new Float64Array(n).fill(Number.NaN);
    this.radius = new Float64Array(n);
    this.walk = new Int32Array(n);
    this.tree = new QuadTree(n);
    this.frozen = new QuadTree(n);
    this.active = null;
  }

  setLinks(src: Uint32Array, dst: Uint32Array, distance: Float64Array): void {
    this.m = src.length;
    this.src = src;
    this.dst = dst;
    this.distance = distance;
  }

  /**
   * d3's initializeNodes and the forces' initialize: place unplaced nodes on
   * the phyllotaxis spiral, zero unknown velocities, and weigh each link by
   * the degrees at its ends.
   */
  initialize(): void {
    const { n, x, y, vx, vy, fx, fy } = this;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(fx[i])) x[i] = fx[i];
      if (!Number.isNaN(fy[i])) y[i] = fy[i];
      if (Number.isNaN(x[i]) || Number.isNaN(y[i])) {
        const r = INITIAL_RADIUS * Math.sqrt(0.5 + i);
        const angle = i * INITIAL_ANGLE;
        x[i] = r * Math.cos(angle);
        y[i] = r * Math.sin(angle);
      }
      if (Number.isNaN(vx[i]) || Number.isNaN(vy[i])) {
        vx[i] = 0;
        vy[i] = 0;
      }
    }
    const count = new Float64Array(n);
    for (let e = 0; e < this.m; e++) {
      count[this.src[e]]++;
      count[this.dst[e]]++;
    }
    this.bias = new Float64Array(this.m);
    for (let e = 0; e < this.m; e++) {
      const s = count[this.src[e]];
      this.bias[e] = s / (s + count[this.dst[e]]);
    }
    this.active = null;
  }

  /**
   * Let only these nodes move (null: all of them, as d3 does). The rest is
   * frozen where it is: it still repels and blocks the moving nodes, and the
   * links to it still pull them, but nothing moves it and it is not centred.
   */
  setActive(indices: ArrayLike<number> | null): void {
    if (!indices) {
      this.active = null;
      return;
    }
    const active = new Uint8Array(this.n);
    const list = new Int32Array(indices.length);
    let count = 0;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (i < 0 || i >= this.n || active[i]) continue;
      active[i] = 1;
      list[count++] = i;
    }
    const rest = new Int32Array(this.n - count);
    let r = 0;
    for (let i = 0; i < this.n; i++) {
      if (active[i]) continue;
      rest[r++] = i;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.frozen.build(rest, r, this.x, this.y, null, null);
    this.frozen.accumulateCharge(this.charge);
    this.frozen.accumulateReach(this.radius, this.collidePadding);
    const links: number[] = [];
    for (let e = 0; e < this.m; e++)
      if (active[this.src[e]] || active[this.dst[e]]) links.push(e);
    this.localLinks = Int32Array.from(links);
    this.active = active;
    this.activeList = list;
    this.activeCount = count;
  }

  get isLocal(): boolean {
    return this.active !== null;
  }

  /** One step: cool, apply every force in d3's order, then integrate. */
  tick(): void {
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    if (this.active) {
      this.localTick(this.alpha);
      return;
    }
    const alpha = this.alpha;
    if (this.n > 0) {
      this.manyBody(alpha);
      this.link(alpha);
      this.center();
      this.pull(alpha);
      this.collide();
    }
    const { n } = this;
    for (let i = 0; i < n; i++) this.integrate(i);
  }

  private integrate(i: number): void {
    const { x, y, vx, vy, fx, fy } = this;
    const k = this.velocityFactor;
    if (Number.isNaN(fx[i])) {
      vx[i] *= k;
      x[i] += vx[i];
    } else {
      x[i] = fx[i];
      vx[i] = 0;
    }
    if (Number.isNaN(fy[i])) {
      vy[i] *= k;
      y[i] += vy[i];
    } else {
      y[i] = fy[i];
      vy[i] = 0;
    }
  }

  private jiggle(): number {
    return (this.random() - 0.5) * 1e-6;
  }

  /* ------------------------------------------------------------------ */
  /*  Forces                                                              */
  /* ------------------------------------------------------------------ */

  private manyBody(alpha: number): void {
    const tree = this.tree;
    tree.build(null, this.n, this.x, this.y, null, null);
    if (tree.root < 0) return;
    tree.accumulateCharge(this.charge);
    this.stack = tree.stackFor(this.stack);
    const walk = this.walkOrder(tree);
    for (let k = 0; k < this.n; k++) {
      const i = walk[k];
      this.repel(tree, i, tree.px[i], tree.py[i], alpha);
    }
  }

  /** Barnes–Hut: the charge of `tree` on node i at (xi, yi) (d3's apply). */
  private repel(
    tree: QuadTree,
    i: number,
    xi: number,
    yi: number,
    alpha: number,
  ): void {
    const { child, point, cx, cy, charge: qCharge, size, next } = tree;
    const { vx, vy } = this;
    const stack = this.stack;
    const theta2 = this.theta2;
    const dmin2 = this.distanceMin2;
    const charge = this.charge;
    let top = 0;
    stack[top++] = tree.root;
    while (top > 0) {
      const q = stack[--top];
      const value = qCharge[q];
      if (!value) continue;
      let dx = cx[q] - xi;
      let dy = cy[q] - yi;
      const w = size[q];
      let l = dx * dx + dy * dy;
      if ((w * w) / theta2 < l) {
        // Far enough: the whole quad acts as one charge.
        if (dx === 0) {
          dx = this.jiggle();
          l += dx * dx;
        }
        if (dy === 0) {
          dy = this.jiggle();
          l += dy * dy;
        }
        if (l < dmin2) l = Math.sqrt(dmin2 * l);
        vx[i] += (dx * value * alpha) / l;
        vy[i] += (dy * value * alpha) / l;
        continue;
      }
      const head = point[q];
      if (head < 0) {
        // d3's visit order: push 3, 2, 1, 0 so that 0 is walked first.
        const c = q * 4;
        let ch = child[c + 3];
        if (ch >= 0) stack[top++] = ch;
        ch = child[c + 2];
        if (ch >= 0) stack[top++] = ch;
        ch = child[c + 1];
        if (ch >= 0) stack[top++] = ch;
        ch = child[c];
        if (ch >= 0) stack[top++] = ch;
        continue;
      }
      if (head !== i || next[head] >= 0) {
        if (dx === 0) {
          dx = this.jiggle();
          l += dx * dx;
        }
        if (dy === 0) {
          dy = this.jiggle();
          l += dy * dy;
        }
        if (l < dmin2) l = Math.sqrt(dmin2 * l);
      }
      for (let p = head; p >= 0; p = next[p]) {
        if (p === i) continue;
        const f = (charge * alpha) / l;
        vx[i] += dx * f;
        vy[i] += dy * f;
      }
    }
  }

  private link(alpha: number): void {
    for (let e = 0; e < this.m; e++) this.spring(e, alpha);
  }

  /** d3's link force on one link; a frozen end (local mode) does not move. */
  private spring(e: number, alpha: number): void {
    const { x, y, vx, vy, src, dst, distance, bias, active } = this;
    const s = src[e];
    const t = dst[e];
    let dx = x[t] + vx[t] - x[s] - vx[s] || this.jiggle();
    let dy = y[t] + vy[t] - y[s] - vy[s] || this.jiggle();
    let l = Math.sqrt(dx * dx + dy * dy);
    l = ((l - distance[e]) / l) * alpha * this.linkStrength;
    dx *= l;
    dy *= l;
    let b = bias[e];
    if (!active || active[t]) {
      vx[t] -= dx * b;
      vy[t] -= dy * b;
    }
    b = 1 - b;
    if (!active || active[s]) {
      vx[s] += dx * b;
      vy[s] += dy * b;
    }
  }

  private center(): void {
    const { n, x, y } = this;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i];
      sy += y[i];
    }
    sx = sx / n - this.centerX;
    sy = sy / n - this.centerY;
    for (let i = 0; i < n; i++) {
      x[i] -= sx;
      y[i] -= sy;
    }
  }

  private pull(alpha: number): void {
    const { n, x, y, vx, vy } = this;
    const s = this.pullStrength;
    // forceX, then forceY, multiplied in d3's order.
    for (let i = 0; i < n; i++) vx[i] += (this.centerX - x[i]) * s * alpha;
    for (let i = 0; i < n; i++) vy[i] += (this.centerY - y[i]) * s * alpha;
  }

  private collide(): void {
    const tree = this.tree;
    // The walk order many-body chose this step (its tree is on unpredicted
    // positions, close enough for locality).
    const walk = this.walk;
    for (let it = 0; it < this.collideIterations; it++) {
      // d3 rebuilds the tree each pass: the first pass changed the velocities.
      tree.build(null, this.n, this.x, this.y, this.vx, this.vy);
      if (tree.root < 0) return;
      tree.accumulateReach(this.radius, this.collidePadding);
      this.stack = tree.stackFor(this.stack);
      for (let k = 0; k < this.n; k++) this.push(tree, walk[k], false);
    }
  }

  /**
   * d3's collide for node i against `tree`. A pair is resolved from its lower
   * index, as d3 does; against the frozen tree (`obstacles`), every overlap is
   * resolved and only node i moves.
   */
  private push(tree: QuadTree, i: number, obstacles: boolean): void {
    const { child, point, reach, x0: qx0, y0: qy0, size } = tree;
    const { x, y, vx, vy, radius } = this;
    const stack = this.stack;
    const strength = this.collideStrength;
    const ri = radius[i] + this.collidePadding;
    const ri2 = ri * ri;
    const xi = x[i] + vx[i];
    const yi = y[i] + vy[i];
    let top = 0;
    stack[top++] = tree.root;
    while (top > 0) {
      const q = stack[--top];
      let rj = reach[q];
      let r = ri + rj;
      const data = point[q];
      if (data >= 0) {
        if (obstacles || data > i) {
          let dx = xi - x[data] - vx[data];
          let dy = yi - y[data] - vy[data];
          let l = dx * dx + dy * dy;
          if (l < r * r) {
            if (dx === 0) {
              dx = this.jiggle();
              l += dx * dx;
            }
            if (dy === 0) {
              dy = this.jiggle();
              l += dy * dy;
            }
            l = Math.sqrt(l);
            l = ((r - l) / l) * strength;
            dx *= l;
            dy *= l;
            if (obstacles) {
              vx[i] += dx;
              vy[i] += dy;
            } else {
              rj *= rj;
              r = rj / (ri2 + rj);
              vx[i] += dx * r;
              vy[i] += dy * r;
              r = 1 - r;
              vx[data] -= dx * r;
              vy[data] -= dy * r;
            }
          }
        }
        continue;
      }
      const x0 = qx0[q];
      const y0 = qy0[q];
      const s = size[q];
      if (x0 > xi + r || x0 + s < xi - r || y0 > yi + r || y0 + s < yi - r)
        continue;
      const c = q * 4;
      let ch = child[c + 3];
      if (ch >= 0) stack[top++] = ch;
      ch = child[c + 2];
      if (ch >= 0) stack[top++] = ch;
      ch = child[c + 1];
      if (ch >= 0) stack[top++] = ch;
      ch = child[c];
      if (ch >= 0) stack[top++] = ch;
    }
  }

  /** A step of the local mode: only the active nodes feel forces and move. */
  private localTick(alpha: number): void {
    const { activeList: list, activeCount: count, x, y, vx, vy, frozen } = this;
    const tree = this.tree;
    tree.build(list, count, x, y, null, null);
    tree.accumulateCharge(this.charge);
    this.stack = frozen.stackFor(tree.stackFor(this.stack));
    for (let k = 0; k < count; k++) {
      const i = list[k];
      if (frozen.root >= 0) this.repel(frozen, i, x[i], y[i], alpha);
      if (tree.root >= 0) this.repel(tree, i, tree.px[i], tree.py[i], alpha);
    }
    for (let k = 0; k < this.localLinks.length; k++)
      this.spring(this.localLinks[k], alpha);
    const s = this.pullStrength;
    for (let k = 0; k < count; k++) {
      const i = list[k];
      vx[i] += (this.centerX - x[i]) * s * alpha;
      vy[i] += (this.centerY - y[i]) * s * alpha;
    }
    for (let it = 0; it < this.collideIterations; it++) {
      tree.build(list, count, x, y, vx, vy);
      tree.accumulateReach(this.radius, this.collidePadding);
      this.stack = tree.stackFor(this.stack);
      for (let k = 0; k < count; k++) {
        const i = list[k];
        if (tree.root >= 0) this.push(tree, i, false);
        if (frozen.root >= 0) this.push(frozen, i, true);
      }
    }
    for (let k = 0; k < count; k++) this.integrate(list[k]);
  }

  /**
   * The order to walk the nodes in: index order, or leaf by leaf in tree order
   * (see spatialOrder). Unplaced nodes, which are in no leaf, come last.
   */
  private walkOrder(tree: QuadTree): Int32Array {
    const walk = this.walk;
    const n = this.n;
    const spatial =
      this.spatialOrder === "auto"
        ? n >= SPATIAL_ORDER_FROM
        : this.spatialOrder;
    if (!spatial) {
      for (let i = 0; i < n; i++) walk[i] = i;
      return walk;
    }
    let k = 0;
    const { point, next, order } = tree;
    for (let o = 0; o < tree.orderCount; o++) {
      for (let p = point[order[o]]; p >= 0; p = next[p]) walk[k++] = p;
    }
    if (k < n) {
      for (let i = 0; i < n; i++)
        if (Number.isNaN(tree.px[i]) || Number.isNaN(tree.py[i])) walk[k++] = i;
    }
    return walk;
  }
}
