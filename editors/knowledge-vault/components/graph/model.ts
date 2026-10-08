/**
 * The knowledge graph's data, independent of the renderer and React: which
 * nodes and edges exist and how each looks, how a refresh merges into a layout
 * already on screen, which node is under the pointer, what is highlighted, and
 * the per-node and per-edge attributes the renderer draws.
 *
 * Positions live in flat Float32Arrays (x, y per node index; NaN where a node
 * has no position yet), never in per-node objects, so a frame over 100,000
 * nodes is a few array passes. Kept pure, so the rules that decide what the
 * user sees are unit-tested; GraphView.tsx only wires them together.
 */
import type { KnowledgeNoteInfo } from "../../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../../hooks/use-knowledge-mocs.js";
import type { Heat, LayoutCommand } from "./layout-core.js";

export type GraphNoteInput = Pick<
  KnowledgeNoteInfo,
  "id" | "name" | "title" | "status" | "links"
>;
export type GraphMocInput = Pick<
  MocInfo,
  "id" | "title" | "tier" | "coreIdeas" | "childRefs"
>;

/** A node's identity and look. */
export type NodeSpec = {
  id: string;
  label: string;
  isMoc: boolean;
  tier: "HUB" | "DOMAIN" | "TOPIC" | null;
  status: string | null;
  radius: number;
  color: number;
  linkCount: number;
};

export type LinkSpec = {
  id: string;
  source: string;
  target: string;
  linkType: string | null;
  /**
   * A note in several MoCs keeps one visible parent edge (its first MoC); the
   * rest are drawn only while either end is highlighted.
   */
  isPrimaryParent: boolean;
};

export type GraphModel = { nodes: NodeSpec[]; links: LinkSpec[] };

export type Point = { x: number; y: number };

/* ------------------------------------------------------------------ */
/*  Colour tokens                                                       */
/* ------------------------------------------------------------------ */

export const STATUS_COLOR_HEX: Record<string, string> = {
  DRAFT: "#f59e0b",
  IN_REVIEW: "#3b82f6",
  CANONICAL: "#10b981",
  ARCHIVED: "#6b7280",
};

export const STATUS_COLOR_NUM: Record<string, number> = {
  DRAFT: 0xf59e0b,
  IN_REVIEW: 0x3b82f6,
  CANONICAL: 0x10b981,
  ARCHIVED: 0x6b7280,
  // Sentinel statuses of the indexed execution documents.
  SCOPE: 0xf472b6,
  WBS: 0x14b8a6,
};

export const LINK_TYPE_COLOR_HEX: Record<string, string> = {
  RELATES_TO: "#64748b",
  BUILDS_ON: "#0ea5e9",
  CONTRADICTS: "#ef4444",
  SUPERSEDES: "#a855f7",
  DERIVED_FROM: "#f59e0b",
  CITES: "#f472b6",
  DELIVERED_BY: "#14b8a6",
};

export const LINK_TYPE_COLOR_NUM: Record<string, number> = {
  RELATES_TO: 0x64748b,
  BUILDS_ON: 0x0ea5e9,
  CONTRADICTS: 0xef4444,
  SUPERSEDES: 0xa855f7,
  DERIVED_FROM: 0xf59e0b,
  CITES: 0xf472b6,
  DELIVERED_BY: 0x14b8a6,
};

export const MOC_COLOR_HEX = "#cba6f7";
export const MOC_COLOR = 0xcba6f7;
export const DEFAULT_NODE_COLOR = 0x6b7280;
export const DEFAULT_EDGE_COLOR = 0x64748b;
export const MOC_EDGE_COLOR = 0xcba6f7;
export const BG_COLOR = 0x11111b; // catppuccin mocha base
/** The canvas background as RGB in 0–1, for the renderers. */
export const BACKGROUND: [number, number, number] = [
  ((BG_COLOR >> 16) & 0xff) / 255,
  ((BG_COLOR >> 8) & 0xff) / 255,
  (BG_COLOR & 0xff) / 255,
];

/* ------------------------------------------------------------------ */
/*  Model                                                               */
/* ------------------------------------------------------------------ */

export function buildGraphModel(
  notes: readonly GraphNoteInput[],
  mocs: readonly GraphMocInput[],
): GraphModel {
  const nodes: NodeSpec[] = [];
  const ids = new Set<string>();

  for (const n of notes) {
    const linkCount = n.links.length;
    const status = n.status ?? "DRAFT";
    nodes.push({
      id: n.id,
      label: n.title ?? n.name,
      isMoc: false,
      tier: null,
      status,
      radius: 9 + Math.min(22, Math.sqrt(linkCount) * 3.2),
      color: STATUS_COLOR_NUM[status] ?? DEFAULT_NODE_COLOR,
      linkCount,
    });
    ids.add(n.id);
  }

  for (const m of mocs) {
    const linkCount = m.coreIdeas.length + m.childRefs.length;
    nodes.push({
      id: m.id,
      label: m.title,
      isMoc: true,
      tier: m.tier,
      status: null,
      // The HUB gets a radius no other node can reach (MoCs cap at 58, notes
      // at 31), so the root of the hierarchy is unmistakable.
      radius:
        m.tier === "HUB" ? 68 : 22 + Math.min(36, Math.sqrt(linkCount) * 3.6),
      color: MOC_COLOR,
      linkCount,
    });
    ids.add(m.id);
  }

  const firstParent = new Map<string, string>();
  for (const m of mocs) {
    for (const idea of m.coreIdeas) {
      if (!firstParent.has(idea.noteRef)) firstParent.set(idea.noteRef, m.id);
    }
  }

  const links: LinkSpec[] = [];
  for (const m of mocs) {
    for (const idea of m.coreIdeas) {
      if (!ids.has(idea.noteRef)) continue;
      links.push({
        id: `moc-${m.id}-${idea.noteRef}`,
        source: m.id,
        target: idea.noteRef,
        linkType: "CORE_IDEA",
        isPrimaryParent: firstParent.get(idea.noteRef) === m.id,
      });
    }
    // Child MoCs render exactly like note connections (CORE_IDEA).
    for (const child of m.childRefs) {
      if (!ids.has(child)) continue;
      links.push({
        id: `moc-child-${m.id}-${child}`,
        source: m.id,
        target: child,
        linkType: "CORE_IDEA",
        isPrimaryParent: true,
      });
    }
  }

  for (const n of notes) {
    for (const l of n.links) {
      if (!l.targetDocumentId || !ids.has(l.targetDocumentId)) continue;
      links.push({
        id: l.id,
        source: n.id,
        target: l.targetDocumentId,
        linkType: l.linkType,
        isPrimaryParent: true,
      });
    }
  }

  return { nodes, links };
}

/** True when a refresh changed nothing a layout depends on (only labels or colours, if anything). */
export function sameStructure(
  prevNodeIds: ReadonlySet<string>,
  prevLinkIds: ReadonlySet<string>,
  model: GraphModel,
): boolean {
  if (
    prevNodeIds.size !== model.nodes.length ||
    prevLinkIds.size !== model.links.length
  )
    return false;
  for (const n of model.nodes) if (!prevNodeIds.has(n.id)) return false;
  for (const l of model.links) if (!prevLinkIds.has(l.id)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Indexed graph                                                       */
/* ------------------------------------------------------------------ */

/** The model by node index: what the layout, the renderer and hit testing share. */
export type IndexedGraph = {
  nodes: NodeSpec[];
  index: Map<string, number>;
  links: LinkSpec[];
  src: Uint32Array;
  dst: Uint32Array;
  /** Undirected adjacency (CSR): the neighbours of i are adj[adjStart[i] .. adjStart[i + 1]). */
  adjStart: Uint32Array;
  adj: Uint32Array;
  radius: Float32Array;
  isMoc: Uint8Array;
};

export function indexGraph(model: GraphModel): IndexedGraph {
  const nodes = model.nodes;
  const n = nodes.length;
  const index = new Map<string, number>();
  const radius = new Float32Array(n);
  const isMoc = new Uint8Array(n);
  nodes.forEach((node, i) => {
    index.set(node.id, i);
    radius[i] = node.radius;
    isMoc[i] = node.isMoc ? 1 : 0;
  });
  const links: LinkSpec[] = [];
  const src: number[] = [];
  const dst: number[] = [];
  for (const l of model.links) {
    const s = index.get(l.source);
    const t = index.get(l.target);
    if (s === undefined || t === undefined) continue;
    links.push(l);
    src.push(s);
    dst.push(t);
  }
  const adjStart = new Uint32Array(n + 1);
  for (let k = 0; k < src.length; k++) {
    adjStart[src[k] + 1]++;
    adjStart[dst[k] + 1]++;
  }
  for (let i = 0; i < n; i++) adjStart[i + 1] += adjStart[i];
  const adj = new Uint32Array(src.length * 2);
  const fill = adjStart.slice(0, n);
  for (let k = 0; k < src.length; k++) {
    adj[fill[src[k]]++] = dst[k];
    adj[fill[dst[k]]++] = src[k];
  }
  return {
    nodes,
    index,
    links,
    src: Uint32Array.from(src),
    dst: Uint32Array.from(dst),
    adjStart,
    adj,
    radius,
    isMoc,
  };
}

/** A node and its direct neighbours: what hovering or selecting it highlights. */
export function neighbourhood(g: IndexedGraph, i: number): number[] {
  const out = new Set<number>([i]);
  for (let k = g.adjStart[i]; k < g.adjStart[i + 1]; k++) out.add(g.adj[k]);
  return [...out];
}

/* ------------------------------------------------------------------ */
/*  Positions                                                           */
/* ------------------------------------------------------------------ */

/**
 * Positions for a refreshed graph. A node already on screen keeps its
 * position; a new one starts at its saved position, else next to a neighbour
 * that has one (its MoC, usually), else nowhere — the layout places it.
 */
export function mergePositions(
  prev: { index: ReadonlyMap<string, number>; pos: Float32Array } | null,
  g: IndexedGraph,
  saved: ReadonlyMap<string, Point> | null,
): { pos: Float32Array; added: number; removed: number; restored: number } {
  const n = g.nodes.length;
  const pos = new Float32Array(n * 2).fill(Number.NaN);
  let added = 0;
  let restored = 0;
  const pending: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = g.nodes[i].id;
    const j = prev?.index.get(id);
    if (j !== undefined && prev) {
      pos[i * 2] = prev.pos[j * 2];
      pos[i * 2 + 1] = prev.pos[j * 2 + 1];
      continue;
    }
    added++;
    const s = saved?.get(id);
    if (s) {
      pos[i * 2] = s.x;
      pos[i * 2 + 1] = s.y;
      restored++;
    } else {
      pending.push(i);
    }
  }
  for (const i of pending) {
    for (let k = g.adjStart[i]; k < g.adjStart[i + 1]; k++) {
      const j = g.adj[k];
      const ax = pos[j * 2];
      const ay = pos[j * 2 + 1];
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
      const off = jitter(g.nodes[i].id);
      pos[i * 2] = ax + off.x;
      pos[i * 2 + 1] = ay + off.y;
      break;
    }
  }
  let removed = 0;
  if (prev) {
    const ids = new Set(g.nodes.map((node) => node.id));
    for (const id of prev.index.keys()) if (!ids.has(id)) removed++;
  }
  return { pos, added, removed, restored };
}

/** A small, deterministic offset per id, so new nodes next to one anchor do not stack. */
export function jitter(id: string, spread = 40): Point {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = (((h >>> 0) % 3600) / 3600) * Math.PI * 2;
  const dist = spread * (0.5 + (((h >>> 12) % 1000) / 1000) * 0.5);
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

/**
 * The node under a world-space point, or -1 — judged against the shapes as they
 * are drawn: a note is a disc of its radius, a MoC a diamond whose corners are
 * at its radius (`|x| + |y| ≤ r`, the renderers' own test). Measuring a MoC as
 * a circle made its hit area reach ~40 % past its edges along the diagonals —
 * up to 20 world units of empty canvas around the HUB — and because a MoC wins
 * over a note, the notes in that area could not be hovered at all.
 *
 * A node the point is inside wins, a MoC over a note (MoCs are drawn on top),
 * else the nearest centre. Failing that, the node whose outline is nearest,
 * within `pad` — which the view sets to a few screen pixels, so a dot in a
 * zoomed-out vault can still be grabbed without a MoC nearby stealing it. A
 * linear scan: well under a millisecond at 100,000 nodes, and exact for
 * varying radii.
 */
export function hitTest(
  g: IndexedGraph,
  pos: Float32Array,
  x: number,
  y: number,
  pad = 4,
): number {
  let inside = -1;
  let insideDist = Infinity;
  let near = -1;
  let nearGap = Infinity;
  const { radius, isMoc } = g;
  for (let i = 0; i < radius.length; i++) {
    const dx = pos[i * 2] - x;
    const dy = pos[i * 2 + 1] - y;
    const r = radius[i];
    // Distance from the point to the drawn outline; negative inside. For the
    // diamond this is the distance to the nearest edge, as the shader has it.
    const gap = isMoc[i]
      ? (Math.abs(dx) + Math.abs(dy) - r) * Math.SQRT1_2
      : Math.sqrt(dx * dx + dy * dy) - r;
    if (!(gap <= pad)) continue; // also skips unplaced (NaN) nodes
    if (gap <= 0) {
      const d = dx * dx + dy * dy;
      if (inside >= 0 && isMoc[inside] && !isMoc[i]) continue;
      if (inside < 0 || (!isMoc[inside] && isMoc[i]) || d < insideDist) {
        inside = i;
        insideDist = d;
      }
    } else if (gap < nearGap) {
      near = i;
      nearGap = gap;
    }
  }
  return inside >= 0 ? inside : near;
}

/**
 * The view that fits every placed node with at least `padding` px around it,
 * centred, at most `maxScale`: screen = world × scale + (x, y). Null when
 * nothing is placed.
 */
export function fitView(
  g: IndexedGraph,
  pos: Float32Array,
  width: number,
  height: number,
  padding = 40,
  maxScale = 2,
): { scale: number; x: number; y: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < g.radius.length; i++) {
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const r = g.radius[i];
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
  }
  if (!Number.isFinite(minX)) return null;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1e-6, maxX - minX),
    (height - padding * 2) / Math.max(1e-6, maxY - minY),
    maxScale,
  );
  // Centred both ways (the narrower side gets the slack).
  return {
    scale,
    x: (width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (height - (maxY - minY) * scale) / 2 - minY * scale,
  };
}

/** The graph as a layout command: ids and radii in node order, positions where known (NaN where not), links as index pairs. */
export function packGraph(
  g: IndexedGraph,
  pos: Float32Array,
  version: number,
  center: [number, number],
  heat: Heat | null,
): Extract<LayoutCommand, { type: "graph" }> {
  const m = g.links.length;
  const links = new Uint32Array(m * 2);
  const coreIdea = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    links[k * 2] = g.src[k];
    links[k * 2 + 1] = g.dst[k];
    coreIdea[k] = g.links[k].linkType === "CORE_IDEA" ? 1 : 0;
  }
  return {
    type: "graph",
    version,
    ids: g.nodes.map((node) => node.id),
    radii: g.radius.slice(),
    positions: pos.slice(),
    links,
    coreIdea,
    center,
    heat,
  };
}

/* ------------------------------------------------------------------ */
/*  Between layout frames                                               */
/* ------------------------------------------------------------------ */

/**
 * How far a node moves toward its latest layout position in one rendered
 * frame. While the layout sends a frame per rendered frame, all the way. When
 * its steps are slower (a large vault), the nodes glide over the gap instead
 * of jumping a few times a second.
 */
export function easeFactor(dtMs: number, frameIntervalMs: number): number {
  if (frameIntervalMs <= 34) return 1;
  return Math.min(1, 1 - Math.exp((-3 * dtMs) / frameIntervalMs));
}

/**
 * Move every node but `held` (the dragged one, or -1) toward its target by
 * `k`. Returns true while any node is still on its way.
 */
export function easeTowards(
  pos: Float32Array,
  target: Float32Array,
  held: number,
  k: number,
): boolean {
  let moving = false;
  const n = pos.length / 2;
  for (let i = 0; i < n; i++) {
    if (i === held) continue;
    const tx = target[i * 2];
    const ty = target[i * 2 + 1];
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    const x = pos[i * 2];
    const y = pos[i * 2 + 1];
    if (k >= 1 || !Number.isFinite(x) || !Number.isFinite(y)) {
      pos[i * 2] = tx;
      pos[i * 2 + 1] = ty;
      continue;
    }
    const dx = tx - x;
    const dy = ty - y;
    if (dx * dx + dy * dy < 0.0025) {
      pos[i * 2] = tx;
      pos[i * 2 + 1] = ty;
      continue;
    }
    pos[i * 2] = x + dx * k;
    pos[i * 2 + 1] = y + dy * k;
    moving = true;
  }
  return moving;
}

/* ------------------------------------------------------------------ */
/*  What the renderer draws                                             */
/* ------------------------------------------------------------------ */

/** Per-node attributes: radius and kind (0 note, 1 MoC); colour as RGBA bytes (A = highlight alpha). */
export function nodeAttributes(g: IndexedGraph): {
  meta: Float32Array;
  color: Uint8Array;
} {
  const n = g.nodes.length;
  const meta = new Float32Array(n * 2);
  const color = new Uint8Array(n * 4);
  g.nodes.forEach((node, i) => {
    meta[i * 2] = node.radius;
    meta[i * 2 + 1] = node.isMoc ? 1 : 0;
    color[i * 4] = (node.color >> 16) & 0xff;
    color[i * 4 + 1] = (node.color >> 8) & 0xff;
    color[i * 4 + 2] = node.color & 0xff;
    color[i * 4 + 3] = 255;
  });
  return { meta, color };
}

/** Per-edge attributes: colour as RGBA bytes (A = highlight alpha), width, and whether it is a primary edge. */
export function edgeAttributes(g: IndexedGraph): {
  color: Uint8Array;
  width: Float32Array;
  primary: Uint8Array;
} {
  const m = g.links.length;
  const color = new Uint8Array(m * 4);
  const width = new Float32Array(m);
  const primary = new Uint8Array(m);
  g.links.forEach((l, k) => {
    const c =
      l.linkType === "CORE_IDEA"
        ? MOC_EDGE_COLOR
        : (LINK_TYPE_COLOR_NUM[l.linkType ?? ""] ?? DEFAULT_EDGE_COLOR);
    color[k * 4] = (c >> 16) & 0xff;
    color[k * 4 + 1] = (c >> 8) & 0xff;
    color[k * 4 + 2] = c & 0xff;
    width[k] = l.isPrimaryParent
      ? l.linkType === "CORE_IDEA"
        ? 1.4
        : 1.0
      : 0.8;
    primary[k] = l.isPrimaryParent ? 1 : 0;
  });
  return { color, width, primary };
}

/** A node's opacity: dimmed outside the highlighted neighbourhood. */
export function nodeAlpha(highlighted: boolean | null): number {
  if (highlighted === null) return 1;
  return highlighted ? 1 : 0.15;
}

/**
 * An edge's opacity. No highlight: primary edges at 0.55, secondary ones
 * hidden. With one: inside the neighbourhood 0.9; a secondary edge touching
 * nothing highlighted stays hidden; everything else 0.04.
 */
export function edgeAlpha(
  primary: boolean,
  sourceIn: boolean | null,
  targetIn: boolean | null,
): number {
  if (sourceIn === null || targetIn === null) return primary ? 0.55 : 0;
  if (sourceIn && targetIn) return 0.9;
  if (!primary && !sourceIn && !targetIn) return 0;
  return 0.04;
}

/**
 * Write the highlight into the alpha bytes of the node and edge colours.
 * `highlight` flags the highlighted nodes (1), or is null for none.
 */
export function applyHighlight(
  g: IndexedGraph,
  highlight: Uint8Array | null,
  nodeColor: Uint8Array,
  edgeColor: Uint8Array,
  edgePrimary: Uint8Array,
): void {
  const n = g.nodes.length;
  const dim = Math.round(nodeAlpha(false) * 255);
  for (let i = 0; i < n; i++)
    nodeColor[i * 4 + 3] = highlight ? (highlight[i] ? 255 : dim) : 255;
  // Six possible values; computed once.
  const table = new Uint8Array(8);
  for (let p = 0; p < 2; p++)
    for (let s = 0; s < 2; s++)
      for (let t = 0; t < 2; t++)
        table[(p << 2) | (s << 1) | t] = Math.round(
          edgeAlpha(p === 1, s === 1, t === 1) * 255,
        );
  const none = [
    Math.round(edgeAlpha(false, null, null) * 255),
    Math.round(edgeAlpha(true, null, null) * 255),
  ];
  for (let k = 0; k < g.links.length; k++) {
    const p = edgePrimary[k];
    edgeColor[k * 4 + 3] = highlight
      ? table[(p << 2) | (highlight[g.src[k]] << 1) | highlight[g.dst[k]]]
      : none[p];
  }
}
