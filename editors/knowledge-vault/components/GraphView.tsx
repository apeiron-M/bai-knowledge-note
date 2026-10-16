import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { useTheme } from "../../shared/theme-context.js";
import type { Heat, LayoutFrame } from "./graph/layout-core.js";
import {
  createLayoutEngine,
  type LayoutEngine,
} from "./graph/layout-engine.js";
import { layoutStore, type LayoutStore } from "./graph/layout-store.js";
import {
  applyHighlight,
  buildGraphModel,
  centerOn,
  easeFactor,
  easeTowards,
  edgeAttributes,
  findNodes,
  fitView,
  hitTest,
  indexGraph,
  mergePositions,
  neighbourhood,
  nodeAttributes,
  packGraph,
  refreshKinds,
  sameStructure,
  showNodeKind,
  updateVisibility,
  type GraphFilter,
  type IndexedGraph,
  type Point,
  type Visibility,
} from "./graph/model.js";
import { GraphFind } from "./graph/GraphFind.js";
import { useSourceTimeline, type TimelineGraphData } from "../hooks/use-source-timeline.js";
import { additionMembers, arrivalArray, arrivalsOf, arrivedWithin, maskByTime } from "./graph/over-time.js";
import { TimeDock } from "./graph/TimeDock.js";
import { GraphLegend } from "./graph/GraphLegend.js";
import {
  createRenderer,
  type GraphRenderer,
  type RenderGraph,
  type RendererKind,
  type RenderView,
} from "./graph/renderer.js";

/*
 * The knowledge graph.
 *
 * Built to stay smooth from a few hundred nodes to 100,000 and more, on any
 * machine and in any browser:
 * - The layout (graph/force-layout.ts, d3-force's simulation over typed
 *   arrays) runs in a Web Worker, so a slow step never holds up a frame;
 *   where a worker cannot start it runs on the main thread instead.
 * - Drawing is WebGL2, else WebGL1, else Canvas 2D (graph/renderer.ts): two
 *   instanced draws a frame on a GPU, whatever the size.
 * - Positions are typed arrays; a frame is a few array passes.
 *
 * It behaves as the graph always has: grab a node and it follows the pointer
 * while everything linked to it swings after it on its springs, then the
 * layout cools down when you let go; hover or click a node to highlight its
 * neighbourhood; the click card opens the document. A data refresh is merged
 * into the layout on screen, and the layout is remembered per drive.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type PersistedGraphState = {
  nodes: {
    documentId: string;
    [k: string]: unknown;
  }[];
  edges: {
    sourceDocumentId: string;
    targetDocumentId: string;
    linkType?: string | null;
  }[];
} | null;

/** Selected node + its direct neighbors — same set the graph highlights. */
export type GraphFocus = {
  selectedId: string;
  focusedIds: string[];
};

type GraphViewProps = {
  notes: KnowledgeNoteInfo[];
  graphState?: PersistedGraphState;
  mocs?: MocInfo[];
  tensions?: Array<{
    id: string;
    title: string;
    status: string | null;
    involvedRefs: string[];
  }>;
  /** Fires when a node is selected/deselected so the sidebar can mirror the highlight set. */
  onGraphFocusChange?: (focus: GraphFocus | null) => void;
  /** Incremented by the parent to force-clear selection (e.g. sidebar ✕). */
  clearFocusNonce?: number;
  /** Remembers the layout per key (the drive id) so a reload starts settled. */
  layoutKey?: string;
  /** Start from this renderer instead of the best available (to try a fallback). */
  renderer?: RendererKind;
  /** Lay out on the main thread instead of a worker (to try the fallback). */
  inlineLayout?: boolean;
  /** What the legend hides. Held by the vault (DriveExplorer) while it is open; never saved. */
  filter: GraphFilter;
  onFilterChange: (filter: GraphFilter) => void;
  /** Graph › Over time: the dock is shown, and the addition opened from the timeline (Show in graph). Held by the vault. */
  overTime?: OverTime;
  onOverTimeChange?: (next: OverTime) => void;
  /** The drive whose source timeline Over time reads. */
  driveId?: string;
  /** The vault's graph, for the timeline's fallback against an older server; the view never loads its own. */
  timelineGraph?: TimelineGraphData;
};

const NO_GRAPH: TimelineGraphData = { allNodes: [], nodes: [], edges: [], isLoading: false, error: null, refetch: () => undefined };

export type OverTime = { on: boolean; pick: string | null };

type HoverInfo = {
  id: string;
  label: string;
  type: string;
  meta: string;
  x: number;
  y: number;
};

type SelectedDetail = {
  id: string;
  label: string;
  type: string;
  tier: string | null;
  linkCount: number;
  x: number;
  y: number;
};

type DragState = {
  index: number;
  /** World offset from the pointer to the node's centre, kept while dragging. */
  dx: number;
  dy: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type PanState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moved: boolean;
};

/** Everything the frame loop and the pointer handlers share. Lives in a ref, never in React state. */
type Scene = {
  host: HTMLDivElement;
  renderer: GraphRenderer;
  engine: LayoutEngine;
  store: LayoutStore;
  /** The layout's centre, fixed at mount so a resize never shifts the graph. */
  center: [number, number];
  view: RenderView;
  width: number;
  height: number;
  graph: IndexedGraph | null;
  draw: RenderGraph | null;
  edgePrimary: Uint8Array;
  highlight: Uint8Array;
  /** The legend's mask (computeVisibility), or null when nothing is hidden. Applied with the highlight. */
  visible: Visibility | null;
  /** The last mask's arrays, kept while nothing is hidden so the next toggle reuses them (updateVisibility). */
  spare: Visibility | null;
  /** Over time: each node's arrival (ms; NaN when the timeline does not know it), in graph order. */
  arrivedAt: Float64Array | null;
  /** Over time: the moment shown, or null when no time narrows the graph. */
  moment: number | null;
  /** Arrays for the time mask when the legend hides nothing. */
  timeSpare: Visibility | null;
  /** Show in graph: an addition's notes and topics, lit when nothing is hovered or selected. */
  spotlightSet: number[] | null;
  /** The overlay the arrival rings are drawn on (Over time). */
  rings: HTMLCanvasElement | null;
  nodeIds: Set<string>;
  linkIds: Set<string>;
  /** Bumped with every graph sent to the layout; frames of an older graph are dropped. */
  version: number;
  /** The layout's latest positions; the drawn ones (draw.pos) ease toward them. */
  target: Float32Array;
  easing: boolean;
  /** Smoothed time between layout frames, ms. */
  frameInterval: number;
  lastFrameAt: number;
  /** The node held by a drag, or -1. */
  held: number;
  /** The saved layout for the current key: undefined while it loads. */
  saved: Map<string, Point> | null | undefined;
  loaded: boolean;
  fitted: boolean;
  /** The layout on screen was started from scratch in this session (no saved one, or Re-layout). */
  fromScratch: boolean;
  /** It has come to rest at least once. */
  settledOnce: boolean;
  /** The user has dragged a node since it started. */
  userDragged: boolean;
  /** While the first layout spreads out, the view eases toward a fit of it (until the user takes over). */
  fitTarget: RenderView | null;
  lastFitAt: number;
  dirty: boolean;
  positionsDirty: boolean;
  dragDirty: boolean;
  hovered: number;
  hoverSet: number[] | null;
  selectedSet: number[] | null;
  pendingHover: Point | null;
  /**
   * Where the pointer rests over the canvas (screen px), or null once it has
   * left. Hover is tested again whenever the nodes or the view move under it —
   * not only when the pointer moves — so a highlight never stays on a node the
   * layout or a zoom has carried away, and a node that arrives under a still
   * pointer lights up.
   */
  pointer: Point | null;
  /** The view and positions hover was last tested against. */
  hoverView: RenderView | null;
  hoverStale: boolean;
  drag: DragState | null;
  pan: PanState | null;
  raf: number;
  lastTime: number;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * How far outside a node's outline the pointer still finds it: 5 screen
 * pixels at every zoom. Zoomed out over a large vault a node is a dot a pixel
 * or two wide and this is what makes it reachable; zoomed in, it stays a
 * hair's breadth rather than growing with the zoom (the old floor of 4 world
 * units was 16 px at 4×, so nodes lit up with the pointer visibly beside them).
 */
function hitPad(view: RenderView): number {
  return 5 / view.scale;
}

/** A pointer that moves less than this (squared, in px) is a click, not a drag. */
const DRAG_THRESHOLD_SQ = 16;
/** The layout's cooling rate, as it has always been. */
const LAYOUT_DECAY = 0.02;
/** After a refresh or a remembered layout: a short, gentle settle. */
const SETTLE_DECAY = 0.05;
/**
 * Share of nodes and links that must change before a settled layout this
 * session made from scratch is laid out again instead of nudged.
 */
const RESTART_CHANGE = 0.05;
/**
 * Share of the graph a remembered layout must already place to be reused. A
 * vault being filled by the pipeline grows between visits — 20 notes to 48 in
 * an afternoon — and at the old 90 % nearly every visit threw its layout away
 * and laid the whole graph out again: a second of spreading on every open, and
 * a different picture each time. From half known, the known nodes open where
 * they were left and the new ones settle in beside their neighbours.
 */
const RESTORE_SHARE = 0.5;
const MAX_ZOOM = 4;
/**
 * The first view, and "Fit to screen": the whole graph with air around it.
 * Clear of the zoom buttons drawn over the top right and the legend over the
 * bottom left, at 88 % of an edge-to-edge fit, and never closer than 1.5× —
 * a small vault at 2× was a few huge nodes. It reads as a map to explore
 * rather than a wall of nodes to scroll.
 */
// top clears the find box (12 px down, 32 px tall).
const FIT_INSETS = { top: 56, right: 72, bottom: 96, left: 40 };
const FIT_ROOM = 0.88;
const FIT_MAX_SCALE = 1.5;

/** The fitted view for the drawn positions in a canvas of this size. */
function fitFor(
  g: IndexedGraph,
  pos: Float32Array,
  width: number,
  height: number,
): RenderView | null {
  return fitView(g, pos, width, height, FIT_INSETS, FIT_MAX_SCALE, FIT_ROOM);
}
/** Zoom out at most to 0.1×, or to half the fit of a graph larger than that. */
const MIN_ZOOM = 0.1;

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function GraphView(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  /** Bumped when a saved layout has loaded, to merge the data into it. */
  const [layoutToken, setLayoutToken] = useState(0);

  const selectedIdRef = useRef<string | null>(null);
  const recenterRef = useRef<(() => void) | null>(null);
  const zoomByRef = useRef<((factor: number) => void) | null>(null);
  const relayoutRef = useRef<(() => void) | null>(null);
  // True once the user pans/zooms/drags — turns OFF the auto-fit-on-cool
  // behaviour so we don't yank the view out from under them.
  const userInteractedRef = useRef(false);
  // Latest props for handlers that live as long as the scene.
  const onGraphFocusChangeRef = useRef(props.onGraphFocusChange);
  onGraphFocusChangeRef.current = props.onGraphFocusChange;
  const layoutKeyRef = useRef(props.layoutKey);
  layoutKeyRef.current = props.layoutKey;
  const filterRef = useRef(props.filter);
  filterRef.current = props.filter;

  // Graph › Over time: the timeline is read only while the dock is shown.
  const overTimeOn = props.overTime?.on ?? false;
  const pick = props.overTime?.pick ?? null;
  const {
    timeline,
    error: timelineError,
    refetch: refetchTimeline,
  } = useSourceTimeline(overTimeOn ? props.driveId : undefined, props.timelineGraph ?? NO_GRAPH);
  const arrivalsRef = useRef<Map<string, number> | null>(null);
  /** The ring overlay; it can mount before the scene exists (Show in graph opens the graph in Over time). */
  const ringsRef = useRef<HTMLCanvasElement | null>(null);
  const spotlightRef = useRef<Set<string> | null>(null);
  // The dock's "now": fixed while it is open, so a replay never chases a moving end; a new timeline moves it.
  const [dockNow, setDockNow] = useState(() => Date.now());
  useEffect(() => setDockNow(Date.now()), [timeline]);
  const dockNowRef = useRef(dockNow);
  dockNowRef.current = dockNow;
  // The legend sits above the dock, however tall the dock's caption makes it.
  const [dockSpace, setDockSpace] = useState(DOCK_SPACE);
  const onDockHeight = useCallback((px: number) => setDockSpace(Math.ceil(px) + DOCK_MARGIN), []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.dirty = true;
    scene.renderer.markStyles();
  }, [theme]);

  // Tooltip and selection card are React state (HTML overlays); they change
  // only when the hovered or selected node changes, never per frame.
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(
    null,
  );

  /** Select node `i` (or nothing), update the highlight, and tell the sidebar. */
  /**
   * Tell the parent (the sidebar's connection list) about a selection — as a
   * transition, so however long the vault takes to re-render, the graph's own
   * highlight is painted first and the page stays responsive meanwhile.
   */
  function notifyFocus(focus: GraphFocus | null) {
    startTransition(() => onGraphFocusChangeRef.current?.(focus));
  }

  function select(i: number, at: Point | null, notify = true) {
    const scene = sceneRef.current;
    const g = scene?.graph;
    if (i < 0 || !scene || !g) {
      selectedIdRef.current = null;
      setSelectedDetail(null);
      if (scene) {
        scene.selectedSet = null;
        refreshHighlight(scene);
      }
      if (notify) notifyFocus(null);
      return;
    }
    const node = g.nodes[i];
    selectedIdRef.current = node.id;
    const focused = neighbourhood(g, i);
    scene.selectedSet = focused;
    refreshHighlight(scene);
    setSelectedDetail({
      id: node.id,
      label: node.label,
      type: node.isMoc ? "MoC" : "Note",
      tier: node.tier ?? null,
      linkCount: node.linkCount,
      x: at?.x ?? 0,
      y: at?.y ?? 0,
    });
    if (notify) {
      notifyFocus({
        selectedId: node.id,
        focusedIds: focused.map((k) => g.nodes[k].id),
      });
    }
  }

  function clearGraphSelection() {
    select(-1, null);
  }

  // Parent asked to clear (sidebar ✕) — drop metacard + highlight without
  // re-notifying (parent already nulled graphFocus).
  useEffect(() => {
    if (!props.clearFocusNonce) return;
    select(-1, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clearFocusNonce]);

  // The legend changed: one pass to rebuild the mask, the highlight pass to
  // draw it. The layout is not told: hidden nodes keep their places.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const g = scene.graph;
    if (g) updateMasks(scene, g, props.filter);
    else scene.visible = null;
    // What is under a resting pointer may now be hidden.
    scene.hoverStale = true;
    refreshHighlight(scene);
    dropHiddenSelection(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.filter]);

  // Over time on or off, a new timeline, another addition lit: arrivals, the
  // lit addition and the masks follow. Turning it off shows everything again.
  useEffect(() => {
    arrivalsRef.current = overTimeOn && timeline ? arrivalsOf(timeline) : null;
    spotlightRef.current = overTimeOn && timeline && pick ? additionMembers(timeline, pick) : null;
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const g = scene.graph;
    if (!overTimeOn) scene.moment = null;
    scene.arrivedAt = g && arrivalsRef.current ? arrivalArray(g, arrivalsRef.current, dockNow) : null;
    scene.spotlightSet = g ? spotlightOf(g, spotlightRef.current) : null;
    if (g) updateMasks(scene, g, filterRef.current);
    scene.hoverStale = true;
    refreshHighlight(scene);
    dropHiddenSelection(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, overTimeOn, timeline, pick, dockNow]);

  /** The dock moved to a moment: show what existed then. */
  const showMoment = useRef<(t: number) => void>(() => undefined);
  showMoment.current = (t: number) => {
    const scene = sceneRef.current;
    const g = scene?.graph;
    if (!scene || !g) return;
    scene.moment = t;
    updateMasks(scene, g, filterRef.current);
    scene.hoverStale = true;
    refreshHighlight(scene);
    dropHiddenSelection(scene);
  };
  const onMoment = useMemo(() => (t: number) => showMoment.current(t), []);

  /** A selected node that is now hidden cannot stay selected. */
  function dropHiddenSelection(scene: Scene) {
    const id = selectedIdRef.current;
    const i = id && scene.graph ? scene.graph.index.get(id) : undefined;
    if (i !== undefined && scene.visible && scene.visible.node[i] === 0)
      select(-1, null);
  }

  /** The find box chose a node: show its kind if hidden, move to it, select it. */
  function chooseFound(id: string) {
    const scene = sceneRef.current;
    const g = scene?.graph;
    const draw = scene?.draw;
    if (!scene || !g || !draw) return;
    const i = g.index.get(id);
    if (i === undefined) return;
    // Under Over time, a node that had not arrived at the moment shown: back to the whole graph.
    if (scene.moment !== null && scene.arrivedAt && scene.arrivedAt[i] > scene.moment) {
      scene.moment = null;
      updateMasks(scene, g, filterRef.current);
      props.onOverTimeChange?.({ on: false, pick: null });
    }
    if (scene.visible && scene.visible.node[i] === 0) {
      const next = showNodeKind(filterRef.current, g.nodes[i]);
      filterRef.current = next;
      // Drawn at once; the parent's state catches up on its next render.
      updateMasks(scene, g, next);
      props.onFilterChange(next);
    }
    const x = draw.pos[i * 2];
    const y = draw.pos[i * 2 + 1];
    let at: Point | null = null;
    // A node the layout has not placed yet (NaN) is selected without moving the view.
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // The user chose where to look: no auto-fit takes the view back.
      userInteractedRef.current = true;
      scene.view = centerOn(scene.view, x, y, scene.width, scene.height, 1);
      scene.dirty = true;
      at = { x: scene.width / 2, y: scene.height / 2 };
    }
    select(i, at);
  }

  function findOnGraph(query: string) {
    const g = sceneRef.current?.graph;
    return g ? findNodes(g, query) : [];
  }

  /* ---------------------------------------------------------------- */
  /*  Scene: built once per mount                                      */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const renderer = createRenderer(props.renderer);
    const canvas = renderer.canvas;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.insertBefore(canvas, host.firstChild);
    host.dataset.graphRenderer = renderer.kind;

    const onFrame = (frame: LayoutFrame) => {
      const s = sceneRef.current;
      if (!s) return;
      if (
        frame.version === s.version &&
        frame.positions.length === s.target.length
      ) {
        const now = performance.now();
        if (s.lastFrameAt > 0)
          s.frameInterval = s.frameInterval * 0.7 + (now - s.lastFrameAt) * 0.3;
        s.lastFrameAt = frame.settled ? 0 : now;
        s.target.set(frame.positions);
        s.easing = true;
        // Every node now has a position (the layout places them all).
        if (s.draw && !s.draw.placed) s.draw.placed = true;
        if (frame.settled && s.draw) {
          // At rest: land exactly on the final layout, then remember it.
          easeTowards(s.draw.pos, s.target, s.held, 1);
          s.positionsDirty = true;
          s.easing = false;
          onLayoutEnd(s);
        }
      }
      s.engine.send({ type: "recycle", buffer: frame.positions });
    };

    const rect = host.getBoundingClientRect();
    const scene: Scene = {
      host,
      renderer,
      engine: createLayoutEngine(onFrame, { inline: props.inlineLayout }),
      store: layoutStore(),
      center: [(rect.width || 800) / 2, (rect.height || 600) / 2],
      view: { scale: 1, x: 0, y: 0 },
      width: rect.width || 800,
      height: rect.height || 600,
      graph: null,
      draw: null,
      edgePrimary: new Uint8Array(0),
      highlight: new Uint8Array(0),
      visible: null,
      spare: null,
      arrivedAt: null,
      moment: null,
      timeSpare: null,
      spotlightSet: null,
      rings: ringsRef.current,
      nodeIds: new Set(),
      linkIds: new Set(),
      version: 0,
      target: new Float32Array(0),
      easing: false,
      frameInterval: 16,
      lastFrameAt: 0,
      held: -1,
      saved: undefined,
      loaded: false,
      fitted: false,
      fromScratch: false,
      settledOnce: false,
      userDragged: false,
      fitTarget: null,
      lastFitAt: 0,
      dirty: true,
      positionsDirty: false,
      dragDirty: false,
      hovered: -1,
      hoverSet: null,
      selectedSet: null,
      pendingHover: null,
      pointer: null,
      hoverView: null,
      hoverStale: false,
      drag: null,
      pan: null,
      raf: 0,
      lastTime: 0,
    };
    sceneRef.current = scene;
    host.dataset.graphLayout = scene.engine.kind;

    const resize = () => {
      const r = host.getBoundingClientRect();
      scene.width = r.width || scene.width;
      scene.height = r.height || scene.height;
      renderer.resize(
        scene.width,
        scene.height,
        Math.min(globalThis.devicePixelRatio || 1, 2),
      );
      scene.dirty = true;
      // The window was resized or re-tiled after the graph was framed: frame
      // it again, unless the user has since panned, zoomed or dragged.
      if (scene.fitted && !userInteractedRef.current) recenterRef.current?.();
    };
    resize();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    if (!observer) globalThis.addEventListener("resize", resize);

    const recenter = () => {
      const g = scene.graph;
      if (!g || !scene.draw) return;
      const fit = fitFor(g, scene.draw.pos, scene.width, scene.height);
      if (!fit) return;
      scene.view = fit;
      scene.dirty = true;
    };
    recenterRef.current = recenter;

    /** The layout came to rest: remember it, and frame it the first time. */
    function onLayoutEnd(s: Scene) {
      s.settledOnce = true;
      const key = layoutKeyRef.current;
      if (key && s.graph && s.draw)
        s.store.save(
          key,
          s.graph.nodes.map((n) => n.id),
          s.draw.pos,
        );
      if (!userInteractedRef.current && !s.fitted) {
        recenter();
        s.fitted = true;
      }
    }

    /* ---- Frame loop: ease toward the layout, then draw if anything changed ---- */
    const frame = (time: number) => {
      scene.raf = requestAnimationFrame(frame);
      const dt = scene.lastTime ? Math.min(100, time - scene.lastTime) : 16;
      scene.lastTime = time;
      scene.engine.pump(); // steps the layout only when it runs inline
      const draw = scene.draw;
      const g = scene.graph;
      if (draw && g) {
        if (scene.pendingHover) {
          const at = scene.pendingHover;
          scene.pendingHover = null;
          const p = toWorld(at);
          setHover(
            hitTest(
              g,
              draw.pos,
              p.x,
              p.y,
              hitPad(scene.view),
              scene.visible?.node ?? null,
            ),
            at,
          );
          scene.hoverView = scene.view;
          scene.hoverStale = false;
        }
        if (scene.easing) {
          const k = easeFactor(dt, scene.frameInterval);
          if (k >= 1) {
            // Frames as fast as the screen: take the layout's positions in one copy.
            const h = scene.held;
            const hx = h >= 0 ? draw.pos[h * 2] : 0;
            const hy = h >= 0 ? draw.pos[h * 2 + 1] : 0;
            draw.pos.set(scene.target);
            if (h >= 0) {
              draw.pos[h * 2] = hx;
              draw.pos[h * 2 + 1] = hy;
            }
            scene.easing = false;
          } else {
            scene.easing = easeTowards(draw.pos, scene.target, scene.held, k);
          }
          scene.positionsDirty = true;
        }
        if (scene.dragDirty && scene.held >= 0) {
          const h = scene.held;
          scene.engine.send({
            type: "drag",
            index: h,
            x: draw.pos[h * 2],
            y: draw.pos[h * 2 + 1],
          });
          scene.dragDirty = false;
        }
        if (scene.positionsDirty) {
          renderer.markPositions();
          scene.positionsDirty = false;
          scene.dirty = true;
          scene.hoverStale = true;
        }
      }
      // Keep a first layout in view as it spreads out, until the user takes over.
      if (
        draw &&
        g &&
        !scene.fitted &&
        !userInteractedRef.current &&
        scene.loaded
      ) {
        if (time - scene.lastFitAt > 500) {
          scene.fitTarget = fitFor(g, draw.pos, scene.width, scene.height);
          scene.lastFitAt = time;
        }
        const t = scene.fitTarget;
        if (t) {
          const k = 1 - Math.exp(-dt / 250);
          const v = scene.view;
          scene.view = {
            scale: v.scale + (t.scale - v.scale) * k,
            x: v.x + (t.x - v.x) * k,
            y: v.y + (t.y - v.y) * k,
          };
          scene.dirty = true;
        }
      }
      // The nodes or the view moved under a pointer that did not: test again.
      // Not while dragging (the held node is the highlight) or panning (the
      // graph moves with the pointer); both re-test when they end.
      if (
        draw &&
        g &&
        scene.pointer &&
        !scene.drag &&
        !scene.pan &&
        (scene.hoverStale || scene.hoverView !== scene.view)
      ) {
        const at = scene.pointer;
        const over =
          at.x >= 0 && at.y >= 0 && at.x <= scene.width && at.y <= scene.height;
        const p = toWorld(at);
        // A drag can end with the pointer outside the canvas: nothing there is hovered.
        setHover(
          over
            ? hitTest(
                g,
                draw.pos,
                p.x,
                p.y,
                hitPad(scene.view),
                scene.visible?.node ?? null,
              )
            : -1,
          at,
        );
        scene.hoverView = scene.view;
        scene.hoverStale = false;
      }
      if (scene.dirty) {
        renderer.render(scene.view);
        drawRings(scene);
        scene.dirty = false;
      }
    };
    scene.raf = requestAnimationFrame(frame);

    /* ---- Pointer input ---- */
    const toScreen = (e: { clientX: number; clientY: number }): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toWorld = (p: Point): Point => ({
      x: (p.x - scene.view.x) / scene.view.scale,
      y: (p.y - scene.view.y) / scene.view.scale,
    });

    const setHover = (i: number, at: Point) => {
      if (i === scene.hovered) return;
      const g = scene.graph;
      scene.hovered = i;
      scene.hoverSet = i >= 0 && g ? neighbourhood(g, i) : null;
      refreshHighlight(scene);
      canvas.style.cursor = i >= 0 ? "pointer" : "default";
      if (i < 0 || !g) {
        setHoverInfo(null);
        return;
      }
      const node = g.nodes[i];
      setHoverInfo({
        id: node.id,
        label: node.label,
        type: node.isMoc ? "MoC" : "Note",
        meta: node.tier
          ? node.tier
          : `${node.linkCount} link${node.linkCount !== 1 ? "s" : ""}`,
        x: at.x,
        y: at.y,
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const g = scene.graph;
      const draw = scene.draw;
      if (!g || !draw) return;
      try {
        // Keep receiving the drag when the pointer leaves the canvas.
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Not every pointer can be captured (synthetic events, some pens); the drag still works inside the canvas.
      }
      const at = toScreen(e);
      const p = toWorld(at);
      const hit = hitTest(
        g,
        draw.pos,
        p.x,
        p.y,
        hitPad(scene.view),
        scene.visible?.node ?? null,
      );
      if (hit >= 0) {
        scene.drag = {
          index: hit,
          dx: draw.pos[hit * 2] - p.x,
          dy: draw.pos[hit * 2 + 1] - p.y,
          startX: at.x,
          startY: at.y,
          moved: false,
        };
      } else {
        scene.pan = {
          x: at.x,
          y: at.y,
          vx: scene.view.x,
          vy: scene.view.y,
          moved: false,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const at = toScreen(e);
      scene.pointer = at;
      const drag = scene.drag;
      const draw = scene.draw;
      if (drag && draw) {
        if (!drag.moved) {
          const dx = at.x - drag.startX;
          const dy = at.y - drag.startY;
          if (dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return;
          drag.moved = true;
          userInteractedRef.current = true;
          scene.held = drag.index;
          scene.userDragged = true;
          setHoverInfo(null); // the tooltip would stay behind; the highlight stays on
        }
        // The grabbed node follows the pointer in this very frame; the layout
        // hears of it once per frame and swings its neighbours after it.
        const p = toWorld(at);
        draw.pos[drag.index * 2] = p.x + drag.dx;
        draw.pos[drag.index * 2 + 1] = p.y + drag.dy;
        scene.positionsDirty = true;
        scene.dragDirty = true;
        return;
      }
      const pan = scene.pan;
      if (pan) {
        const dx = at.x - pan.x;
        const dy = at.y - pan.y;
        if (!pan.moved && dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
          pan.moved = true;
          userInteractedRef.current = true;
        }
        scene.view = { ...scene.view, x: pan.vx + dx, y: pan.vy + dy };
        scene.dirty = true;
        return;
      }
      scene.pendingHover = at;
    };

    const endPointer = (e: PointerEvent, cancelled: boolean) => {
      try {
        if (canvas.hasPointerCapture(e.pointerId))
          canvas.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      const at = toScreen(e);
      // Whatever ended — a click, a drag, a pan — what is under the pointer now
      // is tested on the next frame.
      scene.hoverStale = true;
      const drag = scene.drag;
      if (drag) {
        scene.drag = null;
        if (drag.moved) {
          const draw = scene.draw;
          const h = scene.held;
          if (draw && h >= 0) {
            scene.engine.send({
              type: "drag",
              index: h,
              x: draw.pos[h * 2],
              y: draw.pos[h * 2 + 1],
            });
            // Until the layout's next frame, its target is where it was dropped.
            scene.target[h * 2] = draw.pos[h * 2];
            scene.target[h * 2 + 1] = draw.pos[h * 2 + 1];
          }
          scene.engine.send({ type: "drop" });
          scene.held = -1;
          scene.dragDirty = false;
        } else if (!cancelled) {
          const id = scene.graph?.nodes[drag.index]?.id;
          if (id && selectedIdRef.current === id) select(-1, null);
          else select(drag.index, at);
        }
        return;
      }
      const pan = scene.pan;
      if (pan) {
        scene.pan = null;
        // A click on empty canvas (no pan) clears the selection.
        if (!cancelled && !pan.moved && selectedIdRef.current) select(-1, null);
      }
    };
    const onPointerUp = (e: PointerEvent) => endPointer(e, false);
    const onPointerCancel = (e: PointerEvent) => endPointer(e, true);
    const onPointerLeave = () => {
      if (!scene.drag) {
        scene.pointer = null;
        scene.pendingHover = null;
        setHover(-1, { x: 0, y: 0 });
      }
    };

    const zoomAround = (factor: number, cx: number, cy: number) => {
      userInteractedRef.current = true;
      const g = scene.graph;
      const fit =
        g && scene.draw
          ? fitFor(g, scene.draw.pos, scene.width, scene.height)
          : null;
      const min = Math.min(MIN_ZOOM, fit ? fit.scale / 2 : MIN_ZOOM);
      const { scale, x, y } = scene.view;
      const next = Math.max(min, Math.min(MAX_ZOOM, scale * factor));
      const wx = (cx - x) / scale;
      const wy = (cy - y) / scale;
      scene.view = { scale: next, x: cx - wx * next, y: cy - wy * next };
      scene.dirty = true;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const at = toScreen(ev);
      zoomAround(ev.deltaY < 0 ? 1.1 : 0.9, at.x, at.y);
    };
    zoomByRef.current = (factor: number) =>
      zoomAround(factor, scene.width / 2, scene.height / 2);

    relayoutRef.current = () => {
      const key = layoutKeyRef.current;
      if (key) scene.store.clear(key);
      userInteractedRef.current = false;
      startFromScratch(scene);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    host.addEventListener("wheel", onWheel, { passive: false });

    setReady(true);

    return () => {
      cancelAnimationFrame(scene.raf);
      observer?.disconnect();
      if (!observer) globalThis.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("wheel", onWheel);
      recenterRef.current = null;
      zoomByRef.current = null;
      relayoutRef.current = null;
      // Graph unmounting (e.g. open a document) — restore default sidebar.
      onGraphFocusChangeRef.current?.(null);
      sceneRef.current = null;
      scene.engine.dispose();
      const key = layoutKeyRef.current;
      if (key && scene.loaded && scene.graph && scene.draw) {
        scene.store.save(
          key,
          scene.graph.nodes.map((n) => n.id),
          scene.draw.pos,
        );
      }
      renderer.destroy();
      canvas.remove();
      setReady(false);
    };
    // The renderer and layout options are read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Saved layout: loaded per key before the first data merge         */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const key = props.layoutKey;
    scene.loaded = false;
    scene.fitted = false;
    if (!key) {
      scene.saved = null;
      setLayoutToken((t) => t + 1);
      return;
    }
    scene.saved = undefined;
    let current = true;
    void scene.store.load(key).then((saved) => {
      if (!current || sceneRef.current !== scene) return;
      scene.saved = saved;
      setLayoutToken((t) => t + 1);
    });
    return () => {
      current = false;
    };
  }, [ready, props.layoutKey]);

  /* ---------------------------------------------------------------- */
  /*  Data: merged into the running layout, never a rebuild            */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || scene.saved === undefined) return;
    const model = buildGraphModel(props.notes, props.mocs ?? []);
    const prev = scene.graph;

    if (
      scene.loaded &&
      prev &&
      scene.draw &&
      sameStructure(scene.nodeIds, scene.linkIds, model)
    ) {
      // Same nodes and edges: only labels, statuses or sizes can differ.
      let resized = false;
      for (const spec of model.nodes) {
        const i = prev.index.get(spec.id);
        if (i === undefined) continue;
        if (prev.radius[i] !== spec.radius) resized = true;
        prev.nodes[i] = spec;
        prev.radius[i] = spec.radius;
        scene.draw.meta[i * 2] = spec.radius;
        scene.draw.nodeColor[i * 4] = (spec.color >> 16) & 0xff;
        scene.draw.nodeColor[i * 4 + 1] = (spec.color >> 8) & 0xff;
        scene.draw.nodeColor[i * 4 + 2] = spec.color & 0xff;
      }
      // A status or a link type can change without the structure changing:
      // sort them into the legend's kinds again, so the filter follows.
      refreshKinds(prev, model);
      updateMasks(scene, prev, filterRef.current);
      scene.hoverStale = true;
      refreshHighlight(scene);
      dropHiddenSelection(scene);
      if (resized) {
        // A new radius changes collisions: tell the layout, and redraw sizes.
        scene.renderer.setGraph(scene.draw);
        sendGraph(scene, null);
      } else {
        scene.renderer.markStyles();
      }
      scene.dirty = true;
      return;
    }

    const first = !scene.loaded;
    // Remembered positions serve nodes that arrive later too (in Connect the
    // MoCs land a moment after the notes).
    const saved = scene.saved;
    const g = indexGraph(model);
    const merged = mergePositions(
      prev && scene.draw && !first
        ? { index: prev.index, pos: scene.draw.pos }
        : null,
      g,
      saved,
    );
    const nodeAttrs = nodeAttributes(g);
    const edgeAttrs = edgeAttributes(g);
    const heldId =
      scene.held >= 0 && prev ? prev.nodes[scene.held]?.id : undefined;

    scene.graph = g;
    scene.draw = {
      pos: merged.pos,
      placed: merged.pos.every(Number.isFinite),
      meta: nodeAttrs.meta,
      nodeColor: nodeAttrs.color,
      src: g.src,
      dst: g.dst,
      edgeColor: edgeAttrs.color,
      edgeWidth: edgeAttrs.width,
    };
    scene.edgePrimary = edgeAttrs.primary;
    scene.highlight = new Uint8Array(g.nodes.length);
    // Indices have changed: Over time's arrivals and the lit addition follow them.
    scene.arrivedAt = arrivalsRef.current ? arrivalArray(g, arrivalsRef.current, dockNowRef.current) : null;
    scene.spotlightSet = spotlightOf(g, spotlightRef.current);
    updateMasks(scene, g, filterRef.current);
    scene.nodeIds = new Set(g.nodes.map((n) => n.id));
    const linkIds = new Set(model.links.map((l) => l.id));
    let linkDelta = 0;
    if (!first) {
      for (const id of linkIds) if (!scene.linkIds.has(id)) linkDelta++;
      for (const id of scene.linkIds) if (!linkIds.has(id)) linkDelta++;
    }
    scene.linkIds = linkIds;

    // Keep selection, hover and drag pointing at the same nodes, if they remain.
    const selected = selectedIdRef.current;
    const selectedIndex = selected ? g.index.get(selected) : undefined;
    if (selected && selectedIndex === undefined) select(-1, null);
    scene.selectedSet =
      selectedIndex !== undefined ? neighbourhood(g, selectedIndex) : null;
    scene.hovered = -1;
    scene.hoverSet = null;
    setHoverInfo(null);
    scene.renderer.canvas.style.cursor = "default";
    // Indices have changed: what is under a resting pointer is found again next frame.
    scene.hoverStale = true;
    const heldIndex = heldId ? g.index.get(heldId) : undefined;
    scene.held = heldIndex ?? -1;
    if (scene.drag) {
      if (heldIndex === undefined && scene.drag.moved) scene.drag = null;
      else if (heldIndex !== undefined) scene.drag.index = heldIndex;
      else {
        const dragId = prev?.nodes[scene.drag.index]?.id;
        const di = dragId ? g.index.get(dragId) : undefined;
        if (di === undefined) scene.drag = null;
        else scene.drag.index = di;
      }
    }

    scene.renderer.setGraph(scene.draw);
    refreshHighlight(scene);

    let heat: Heat | null;
    let restart = false;
    if (first) {
      scene.loaded = true;
      scene.settledOnce = false;
      scene.userDragged = false;
      if (
        saved &&
        g.nodes.length > 0 &&
        merged.restored >= g.nodes.length * RESTORE_SHARE
      ) {
        // A remembered layout opens exactly as it was left. Only nodes it
        // does not know need room — they start beside a neighbour — and the
        // settle is as warm as the share of them: a few new notes barely
        // stir it, a third new makes real room.
        scene.fromScratch = false;
        const fresh = (g.nodes.length - merged.restored) / g.nodes.length;
        heat =
          fresh > 0
            ? {
                alpha: Math.min(0.5, 0.05 + fresh),
                decay: SETTLE_DECAY,
                target: 0,
              }
            : null;
        if (!userInteractedRef.current) {
          const fit = fitFor(g, merged.pos, scene.width, scene.height);
          if (fit) scene.view = fit;
          // Framed at once; while new nodes settle the view keeps them in
          // frame, and the end of the settle frames the result.
          scene.fitted = fresh === 0;
        }
      } else {
        scene.fromScratch = true;
        heat = { alpha: 1, decay: LAYOUT_DECAY, target: 0, fast: true };
      }
    } else {
      const change =
        (merged.added + merged.removed) / Math.max(1, g.nodes.length) +
        linkDelta / Math.max(1, g.links.length);
      if (
        scene.fromScratch &&
        !scene.userDragged &&
        (!scene.settledOnce || change > RESTART_CHANGE)
      ) {
        // The layout this session started from scratch, untouched, and the
        // graph has changed under it — in Connect the links and MoCs arrive
        // after the notes. Lay the whole graph out again, as Re-layout does,
        // rather than nudging a layout made for a different graph.
        restart = true;
        heat = null;
      } else if (merged.added - merged.restored + merged.removed > 0) {
        // New nodes with no remembered place, or nodes gone: make room.
        heat = { alpha: 0.12, decay: 0.04, target: 0 };
      } else if (linkDelta > 0 && scene.fromScratch) {
        heat = { alpha: 0.05, decay: SETTLE_DECAY, target: 0 };
      } else {
        // Nothing new to place: links a remembered layout already reflects,
        // or nodes returning to their remembered places.
        heat = null;
      }
    }
    sendGraph(scene, heat);
    if (restart) startFromScratch(scene);
    if (scene.held >= 0) scene.dragDirty = true; // the layout re-learns the drag
    scene.positionsDirty = true;
    scene.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layoutToken, props.notes, props.mocs]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ touchAction: "none" }}
    >
      {/* The arrival rings of Over time, drawn over the graph. */}
      {overTimeOn && (
        <canvas
          ref={(el) => {
            ringsRef.current = el;
            const scene = sceneRef.current;
            if (scene) {
              scene.rings = el;
              scene.dirty = true;
            }
          }}
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
          aria-hidden="true"
        />
      )}

      {/* Toolbar: zoom in/out + fit + re-layout, and Over time */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <ToolbarButton title="Zoom in" onClick={() => zoomByRef.current?.(1.2)}>
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M11 8v6M8 11h6M21 21l-4.35-4.35" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="Zoom out"
          onClick={() => zoomByRef.current?.(0.83)}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M8 11h6M21 21l-4.35-4.35" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="Fit to screen"
          onClick={() => recenterRef.current?.()}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="Re-layout (forget the saved positions)"
          onClick={() => relayoutRef.current?.()}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="Over time: replay how the vault grew"
          pressed={overTimeOn}
          onClick={() => props.onOverTimeChange?.({ on: !overTimeOn, pick: null })}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </ToolbarButton>
      </div>

      <GraphFind search={findOnGraph} onChoose={chooseFound} />

      {/* Over time's dock takes the bottom edge; the legend sits above it. */}
      <div style={overTimeOn ? { position: "absolute", left: 0, right: 0, bottom: dockSpace, height: 0 } : undefined}>
        <GraphLegend filter={props.filter} onChange={props.onFilterChange} />
      </div>

      {overTimeOn &&
        (timeline ? (
          <TimeDock
            timeline={timeline}
            now={dockNow}
            pick={pick}
            onMoment={onMoment}
            onShowEverything={() => props.onOverTimeChange?.({ on: true, pick: null })}
            onHeight={onDockHeight}
          />
        ) : timelineError ? (
          <div
            className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm"
            style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)", color: "var(--bai-text-secondary)" }}
            role="alert"
          >
            <span>Couldn&apos;t read the vault&apos;s history. The graph shows everything as it is now.</span>
            <button type="button" className="vault-btn" onClick={refetchTimeline}>
              Try again
            </button>
          </div>
        ) : (
          <div
            className="absolute bottom-3 left-3 right-3 z-20 rounded-xl px-4 py-3 text-sm"
            style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)", color: "var(--bai-text-tertiary)" }}
            role="status"
          >
            Reading the vault&apos;s history…
          </div>
        ))}

      {/* Hover tooltip — only when nothing is selected (the metacard
          covers that role for selected nodes) */}
      {hoverInfo && !selectedDetail && (
        <div
          className="pointer-events-none absolute z-20 rounded-md px-2 py-1.5 text-[11px] shadow-lg"
          style={{
            left: hoverInfo.x + 12,
            top: hoverInfo.y + 12,
            backgroundColor: "var(--bai-surface, #181825)",
            color: "var(--bai-text, #e4e4e7)",
            border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
            maxWidth: 320,
          }}
        >
          <div className="font-medium">{hoverInfo.label}</div>
          <div className="text-[10px] opacity-70">
            {hoverInfo.type}
            {hoverInfo.meta ? ` · ${hoverInfo.meta}` : ""}
          </div>
        </div>
      )}

      {/* Selection metacard — appears on click. Has Open button so a
          drag-then-release doesn't open the doc by accident. */}
      {selectedDetail && (
        <div
          className="absolute z-30 w-72 rounded-lg border p-3 shadow-xl"
          style={{
            left: Math.min(
              selectedDetail.x + 14,
              (containerRef.current?.offsetWidth ?? 800) - 300,
            ),
            top: Math.max(8, selectedDetail.y - 20),
            backgroundColor: "var(--bai-surface, #181825)",
            color: "var(--bai-text, #e4e4e7)",
            borderColor: "var(--bai-border, rgba(255,255,255,0.1))",
          }}
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="text-sm font-medium leading-tight">
              {selectedDetail.label}
            </div>
            <button
              type="button"
              onClick={clearGraphSelection}
              className="shrink-0 text-xs opacity-60 hover:opacity-100"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div
            className="mb-3 text-[11px]"
            style={{ color: "var(--bai-text-muted, #9ca3af)" }}
          >
            {selectedDetail.type}
            {selectedDetail.tier ? ` · ${selectedDetail.tier}` : ""}
            {` · ${selectedDetail.linkCount} link${selectedDetail.linkCount !== 1 ? "s" : ""}`}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedNode(selectedDetail.id);
            }}
            className="w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: "var(--bai-accent, #cba6f7)",
              color: "var(--bai-accent-text, #1e1e2e)",
            }}
          >
            Open document
          </button>
        </div>
      )}
    </div>
  );
}

/** Lay the graph out from scratch (Re-layout, or a graph that changed under a fresh layout). */
function startFromScratch(scene: Scene) {
  scene.fromScratch = true;
  scene.settledOnce = false;
  scene.userDragged = false;
  scene.fitted = false;
  scene.engine.send({
    type: "relayout",
    heat: { alpha: 1, decay: LAYOUT_DECAY, target: 0, fast: true },
  });
}

/** Send the scene's graph to the layout as a new version. */
function sendGraph(scene: Scene, heat: Heat | null) {
  const g = scene.graph;
  const draw = scene.draw;
  if (!g || !draw) return;
  scene.version++;
  const cmd = packGraph(g, draw.pos, scene.version, scene.center, heat);
  scene.target = draw.pos.slice();
  scene.easing = false;
  scene.lastFrameAt = 0;
  scene.engine.send(cmd);
}

/** Room the time dock takes at the bottom edge until it has measured itself; the legend sits above it. */
const DOCK_SPACE = 132;
/** The dock's offset from the bottom edge plus a gap above it. */
const DOCK_MARGIN = 20;
/** A node is ringed for this long after it arrived, at the moment shown. */
const RING_WINDOW_MS = 30 * 60_000;

/** The legend's mask, then — under Over time — narrowed to what existed at the moment shown. */
function updateMasks(scene: Scene, g: IndexedGraph, filter: GraphFilter) {
  updateVisibility(scene, g, filter);
  if (scene.moment === null || !scene.arrivedAt || scene.arrivedAt.length !== g.nodes.length) return;
  const v = maskByTime(g, scene.visible, scene.arrivedAt, scene.moment, scene.timeSpare);
  if (v !== scene.visible) scene.timeSpare = v;
  scene.visible = v;
}

/**
 * The lit addition's members as indices of this graph — none when it has
 * nothing here yet, since an empty highlight would dim the whole graph.
 */
function spotlightOf(g: IndexedGraph, ids: Set<string> | null): number[] | null {
  if (!ids) return null;
  const out: number[] = [];
  for (const id of ids) {
    const i = g.index.get(id);
    if (i !== undefined) out.push(i);
  }
  return out.length > 0 ? out : null;
}

/** Rings around what arrived in the half hour before the moment shown, over the graph. */
function drawRings(scene: Scene) {
  const c = scene.rings;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(scene.width * dpr);
  const h = Math.round(scene.height * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  const draw = scene.draw;
  if (scene.moment === null || !scene.arrivedAt || !draw) return;
  const arrived = arrivedWithin(scene.arrivedAt, scene.moment, RING_WINDOW_MS, scene.visible);
  if (arrived.length === 0) return;
  ctx.strokeStyle = getComputedStyle(c).getPropertyValue("--bai-accent").trim() || "#cba6f7";
  ctx.lineWidth = 1.6;
  const { scale, x: ox, y: oy } = scene.view;
  for (const i of arrived) {
    const x = draw.pos[i * 2];
    const y = draw.pos[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const age = (scene.moment - scene.arrivedAt[i]) / RING_WINDOW_MS;
    ctx.globalAlpha = 0.15 + 0.7 * (1 - age);
    ctx.beginPath();
    ctx.arc(x * scale + ox, y * scale + oy, draw.meta[i * 2] * scale + 3 + 7 * age, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Recompute what is highlighted (hover wins over selection) into the colours' alpha. */
function refreshHighlight(scene: Scene) {
  const g = scene.graph;
  const draw = scene.draw;
  if (!g || !draw) return;
  const set = scene.hoverSet ?? scene.selectedSet ?? scene.spotlightSet;
  const flags = scene.highlight;
  flags.fill(0);
  if (set) for (const i of set) flags[i] = 1;
  applyHighlight(
    g,
    set ? flags : null,
    draw.nodeColor,
    draw.edgeColor,
    scene.edgePrimary,
    scene.visible,
  );
  scene.renderer.markStyles();
  scene.dirty = true;
}

function ToolbarButton(props: {
  title: string;
  onClick: () => void;
  /** A toggle: shown pressed, in the accent. */
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.pressed}
      className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
      style={{
        backgroundColor: props.pressed
          ? "color-mix(in srgb, var(--bai-accent) 18%, var(--bai-bg, #11111b))"
          : "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
        color: props.pressed ? "var(--bai-accent)" : "var(--bai-text-secondary, #d4d4d8)",
        border: props.pressed
          ? "1px solid color-mix(in srgb, var(--bai-accent) 55%, transparent)"
          : "1px solid var(--bai-border, rgba(255,255,255,0.1))",
      }}
    >
      {props.children}
    </button>
  );
}
