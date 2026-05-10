import { useEffect, useRef, useState, type ReactNode } from "react";
import { Application, Container, Graphics, Circle } from "pixi.js";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";

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
};

type SimNode = SimulationNodeDatum & {
  id: string;
  label: string;
  isMoc: boolean;
  tier: "HUB" | "DOMAIN" | "TOPIC" | null;
  status: string | null;
  radius: number;
  color: number;
  linkCount: number;
};

type SimLink = SimulationLinkDatum<SimNode> & {
  id: string;
  isPrimaryParent: boolean;
  linkType: string | null;
};

type HoverInfo = {
  id: string;
  label: string;
  type: string;
  meta: string;
  x: number;
  y: number;
};

/* ------------------------------------------------------------------ */
/*  Color tokens — match the legacy Cytoscape graph 1:1 so users see  */
/*  the same status / link-type semantics they're used to.            */
/* ------------------------------------------------------------------ */

const STATUS_COLOR_HEX: Record<string, string> = {
  DRAFT: "#f59e0b", // amber
  IN_REVIEW: "#3b82f6", // blue
  CANONICAL: "#10b981", // emerald
  ARCHIVED: "#6b7280", // gray
};

const STATUS_COLOR_NUM: Record<string, number> = {
  DRAFT: 0xf59e0b,
  IN_REVIEW: 0x3b82f6,
  CANONICAL: 0x10b981,
  ARCHIVED: 0x6b7280,
};

const LINK_TYPE_COLOR_HEX: Record<string, string> = {
  RELATES_TO: "#64748b",
  BUILDS_ON: "#0ea5e9",
  CONTRADICTS: "#ef4444",
  SUPERSEDES: "#a855f7",
  DERIVED_FROM: "#f59e0b",
};

const LINK_TYPE_COLOR_NUM: Record<string, number> = {
  RELATES_TO: 0x64748b,
  BUILDS_ON: 0x0ea5e9,
  CONTRADICTS: 0xef4444,
  SUPERSEDES: 0xa855f7,
  DERIVED_FROM: 0xf59e0b,
};

const MOC_COLOR_HEX = "#cba6f7";
const MOC_COLOR = 0xcba6f7; // mauve
const DEFAULT_NODE_COLOR = 0x6b7280;
const DEFAULT_EDGE_COLOR = 0x64748b;
const MOC_EDGE_COLOR = 0xcba6f7; // mauve dashed-equivalent
const BG_COLOR = 0x11111b; // catppuccin mocha base

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function computeNodeAlpha(
  id: string,
  highlightSet: Set<string> | null,
): number {
  if (!highlightSet) return 1.0;
  return highlightSet.has(id) ? 1.0 : 0.15;
}

function computeEdgeAlpha(
  sId: string,
  tId: string,
  highlightSet: Set<string> | null,
): number {
  if (!highlightSet) return 0.55;
  if (highlightSet.has(sId) && highlightSet.has(tId)) return 0.9;
  return 0.04;
}

function buildNeighborhood(
  id: string,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const set = new Set<string>([id]);
  const neighbors = adjacency.get(id);
  if (neighbors) {
    for (const nb of neighbors) set.add(nb);
  }
  return set;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function GraphViewPixi(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  // Visual state refs (avoid React re-renders in PIXI loop)
  const highlightedIdsRef = useRef<Set<string> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const recenterRef = useRef<(() => void) | null>(null);
  const zoomByRef = useRef<((factor: number) => void) | null>(null);
  // True once the user pans/zooms/drags — turns OFF the auto-fit-on-cool
  // behaviour so we don't yank the view out from under them.
  const userInteractedRef = useRef(false);

  // Tooltip uses React state (HTML overlay)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  // Sticky selection card — appears on click. Has an "Open" button so
  // drag-then-release doesn't navigate by accident.
  const [selectedDetail, setSelectedDetail] = useState<{
    id: string;
    label: string;
    type: string;
    tier: string | null;
    linkCount: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;
    const app = new Application();

    void (async () => {
      await app.init({
        width: host.clientWidth || 800,
        height: host.clientHeight || 600,
        backgroundColor: BG_COLOR,
        antialias: true,
        autoDensity: true,
        resolution: globalThis.devicePixelRatio || 1,
        resizeTo: host,
      });

      if (cancelled) {
        app.destroy({ removeView: true });
        return;
      }

      // Lock canvas to host bounds so it never escapes the parent layout.
      // Without this the canvas can flow outside the panel and cover
      // surrounding chrome (top toolbar, sidebar).
      app.canvas.style.display = "block";
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      host.appendChild(app.canvas);
      appRef.current = app;

      // Root container transformed for pan/zoom
      const world = new Container();
      app.stage.addChild(world);

      const edgeGraphics = new Graphics();
      const nodeContainer = new Container();
      world.addChild(edgeGraphics);
      world.addChild(nodeContainer);

      /* ---- Build simulation nodes ---- */
      const nodes: SimNode[] = [];
      const nodeById = new Map<string, SimNode>();

      for (const n of props.notes) {
        const linkCount = n.links.length;
        const status = n.status ?? "DRAFT";
        const node: SimNode = {
          id: n.id,
          label: n.title ?? n.name,
          isMoc: false,
          tier: null,
          status,
          radius: 9 + Math.min(22, Math.sqrt(linkCount) * 3.2),
          color: STATUS_COLOR_NUM[status] ?? DEFAULT_NODE_COLOR,
          linkCount,
        };
        nodes.push(node);
        nodeById.set(n.id, node);
      }

      for (const m of props.mocs ?? []) {
        const linkCount = m.coreIdeas.length + m.childRefs.length;
        const node: SimNode = {
          id: m.id,
          label: m.title,
          isMoc: true,
          tier: m.tier,
          status: null,
          radius: 22 + Math.min(36, Math.sqrt(linkCount) * 3.6),
          color: MOC_COLOR,
          linkCount,
        };
        nodes.push(node);
        nodeById.set(m.id, node);
      }

      /* ---- Build simulation links ---- */
      const links: SimLink[] = [];
      const firstParentByNote = new Map<string, string>();

      for (const m of props.mocs ?? []) {
        for (const idea of m.coreIdeas) {
          if (!firstParentByNote.has(idea.noteRef)) {
            firstParentByNote.set(idea.noteRef, m.id);
          }
        }
      }

      // MoC -> note (coreIdeas) and MoC -> MoC (childRefs)
      for (const m of props.mocs ?? []) {
        for (const idea of m.coreIdeas) {
          if (!nodeById.has(idea.noteRef)) continue;
          links.push({
            id: `moc-${m.id}-${idea.noteRef}`,
            source: m.id,
            target: idea.noteRef,
            linkType: "CORE_IDEA",
            isPrimaryParent: firstParentByNote.get(idea.noteRef) === m.id,
          });
        }
        for (const child of m.childRefs) {
          if (!nodeById.has(child)) continue;
          links.push({
            id: `moc-child-${m.id}-${child}`,
            source: m.id,
            target: child,
            linkType: "CORE_IDEA",
            isPrimaryParent: true,
          });
        }
      }

      // Note -> note (inline links)
      for (const n of props.notes) {
        for (const l of n.links) {
          if (!l.targetDocumentId || !nodeById.has(l.targetDocumentId))
            continue;
          links.push({
            id: l.id,
            source: n.id,
            target: l.targetDocumentId,
            linkType: l.linkType,
            isPrimaryParent: true,
          });
        }
      }

      /* ---- d3-force simulation ---- */
      const w = app.screen.width;
      const h = app.screen.height;

      // Forces tuned for "Obsidian-like cluster + tight perimeter".
      // forceX/forceY give every node a gentle pull toward the canvas
      // center — without them, isolated/lightly-connected nodes drift
      // out to the perimeter. Collide radius keeps them from stacking.
      const sim = forceSimulation<SimNode, SimLink>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-220))
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance((l) => (l.linkType === "CORE_IDEA" ? 95 : 75))
            .strength(0.25),
        )
        .force("center", forceCenter<SimNode>(w / 2, h / 2))
        .force("x", forceX<SimNode>(w / 2).strength(0.06))
        .force("y", forceY<SimNode>(h / 2).strength(0.06))
        .force(
          "collide",
          forceCollide<SimNode>()
            .radius((d) => d.radius + 6)
            .iterations(2)
            .strength(0.9),
        )
        .alpha(1)
        .alphaDecay(0.02);

      simRef.current = sim;

      /* ---- Adjacency map (computed once) ---- */
      const adjacency = new Map<string, Set<string>>();
      for (const n of nodes) adjacency.set(n.id, new Set());
      for (const l of links) {
        const sId =
          typeof l.source === "string" ? l.source : (l.source as SimNode).id;
        const tId =
          typeof l.target === "string" ? l.target : (l.target as SimNode).id;
        adjacency.get(sId)?.add(tId);
        adjacency.get(tId)?.add(sId);
      }

      /* ---- Helper: effective highlight set ---- */
      function effectiveHighlight(): Set<string> | null {
        if (highlightedIdsRef.current) return highlightedIdsRef.current;
        if (selectedIdRef.current) {
          return buildNeighborhood(selectedIdRef.current, adjacency);
        }
        return null;
      }

      /* ---- Per-node Graphics ---- */
      const nodeGfx = new Map<string, Graphics>();

      for (const n of nodes) {
        const g = new Graphics();
        if (n.isMoc) {
          // Solid purple diamond — matches the legacy graph's MoC shape.
          // Diamond points: top, right, bottom, left at distance r from
          // center. Stroked with a brighter mauve so the silhouette
          // separates cleanly from any overlapping note circle below.
          const r = n.radius;
          const pts = [0, -r, r, 0, 0, r, -r, 0];
          // Soft glow halo (slightly larger diamond at low alpha)
          const haloR = r + 6;
          g.poly([0, -haloR, haloR, 0, 0, haloR, -haloR, 0]).fill({
            color: MOC_COLOR,
            alpha: 0.15,
          });
          // Solid mauve fill
          g.poly(pts).fill({ color: MOC_COLOR });
          // Bright outer stroke
          g.poly(pts).stroke({
            color: 0xfaf5ff,
            width: 2,
            alpha: 0.95,
          });
        } else {
          g.circle(0, 0, n.radius).fill({ color: n.color });
          // Subtle 1px border so notes pop on dense backgrounds
          g.circle(0, 0, n.radius).stroke({
            color: 0xfaf5ff,
            width: 0.6,
            alpha: 0.4,
          });
        }

        // Per-node interaction
        g.eventMode = "static";
        g.cursor = "pointer";
        g.hitArea = new Circle(0, 0, n.radius + 4);

        g.on("pointerover", (e) => {
          highlightedIdsRef.current = buildNeighborhood(n.id, adjacency);
          const nodeData = nodeById.get(n.id);
          const type = nodeData?.isMoc ? "MoC" : "Note";
          const tier = nodeData?.tier;
          const meta = tier
            ? tier
            : nodeData?.linkCount != null
              ? `${nodeData.linkCount} link${nodeData.linkCount !== 1 ? "s" : ""}`
              : "";
          setHoverInfo({
            id: n.id,
            label: n.label,
            type,
            meta,
            x: e.global.x,
            y: e.global.y,
          });
          // Kick sim to repaint (even if settled)
          sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
        });

        g.on("pointerout", () => {
          highlightedIdsRef.current = null;
          setHoverInfo(null);
          sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
        });

        g.on("pointerdown", (e) => {
          userInteractedRef.current = true;
          // Fix node and start drag
          n.fx = n.x;
          n.fy = n.y;
          sim.alphaTarget(0.3).restart();

          const onMove = (ev: { global: { x: number; y: number } }) => {
            const local = world.toLocal(ev.global as { x: number; y: number });
            n.fx = local.x;
            n.fy = local.y;
          };

          const onUp = () => {
            n.fx = null;
            n.fy = null;
            sim.alphaTarget(0);
            app.stage.off("globalpointermove", onMove);
            app.stage.off("pointerup", onUp);
            app.stage.off("pointerupoutside", onUp);
          };

          app.stage.on("globalpointermove", onMove);
          app.stage.on("pointerup", onUp);
          app.stage.on("pointerupoutside", onUp);

          // Stop event from triggering stage pan
          e.stopPropagation();
        });

        g.on("pointertap", (e) => {
          // Toggle selection. Don't navigate — that's the Open button's
          // job on the metacard. This way drag-and-release doesn't
          // accidentally open the doc.
          if (selectedIdRef.current === n.id) {
            selectedIdRef.current = null;
            setSelectedDetail(null);
          } else {
            selectedIdRef.current = n.id;
            const nodeData = nodeById.get(n.id);
            setSelectedDetail({
              id: n.id,
              label: n.label,
              type: nodeData?.isMoc ? "MoC" : "Note",
              tier: nodeData?.tier ?? null,
              linkCount: nodeData?.linkCount ?? 0,
              x: e.global.x,
              y: e.global.y,
            });
          }
          sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
        });

        nodeContainer.addChild(g);
        nodeGfx.set(n.id, g);
      }

      /* ---- Tick: redraw edges + reposition nodes ---- */
      sim.on("tick", () => {
        const hlSet = effectiveHighlight();

        edgeGraphics.clear();
        for (const l of links) {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          if (s.x == null || s.y == null || t.x == null || t.y == null)
            continue;

          const sId = s.id;
          const tId = t.id;

          // Skip secondary (non-primary-parent) edges unless highlighted
          if (!l.isPrimaryParent) {
            const inHighlight = hlSet && (hlSet.has(sId) || hlSet.has(tId));
            if (!inHighlight) continue;
          }

          // Colour edges by linkType — MoC→note CORE_IDEA edges keep
          // mauve so the MoC backbone is visible; note↔note edges pick
          // up their semantic colour (relates_to / builds_on / contradicts
          // / supersedes / derived_from).
          const color =
            l.linkType === "CORE_IDEA"
              ? MOC_EDGE_COLOR
              : (LINK_TYPE_COLOR_NUM[l.linkType ?? ""] ?? DEFAULT_EDGE_COLOR);
          const alpha = computeEdgeAlpha(sId, tId, hlSet);

          // Edges visible by default; thicker for primary, thinner for
          // surfaced-on-hover secondaries.
          const width = l.isPrimaryParent
            ? l.linkType === "CORE_IDEA"
              ? 1.4
              : 1.0
            : 0.8;

          edgeGraphics
            .moveTo(s.x, s.y)
            .lineTo(t.x, t.y)
            .stroke({ color, width, alpha });
        }

        for (const n of nodes) {
          const g = nodeGfx.get(n.id);
          if (g && n.x != null && n.y != null) {
            g.position.set(n.x, n.y);
            g.alpha = computeNodeAlpha(n.id, hlSet);
          }
        }
      });

      /* ---- Stage tap: clear selection ---- */
      app.stage.on("pointertap", (e) => {
        if (e.target === app.stage) {
          selectedIdRef.current = null;
          setSelectedDetail(null);
          sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
        }
      });

      /* ---- Pan/Zoom ---- */
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      let isPanning = false;
      let panStart = { x: 0, y: 0, wx: 0, wy: 0 };

      app.stage.on("pointerdown", (e) => {
        if (e.target === app.stage) {
          isPanning = true;
          userInteractedRef.current = true;
          panStart = {
            x: e.global.x,
            y: e.global.y,
            wx: world.x,
            wy: world.y,
          };
        }
      });

      app.stage.on("globalpointermove", (e) => {
        if (!isPanning) return;
        world.position.set(
          panStart.wx + (e.global.x - panStart.x),
          panStart.wy + (e.global.y - panStart.y),
        );
      });

      app.stage.on("pointerup", () => {
        isPanning = false;
      });

      app.stage.on("pointerupoutside", () => {
        isPanning = false;
      });

      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        userInteractedRef.current = true;
        const factor = ev.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.1, Math.min(4, world.scale.x * factor));
        const rect = host.getBoundingClientRect();
        const cx = ev.clientX - rect.left;
        const cy = ev.clientY - rect.top;
        const wx = (cx - world.x) / world.scale.x;
        const wy = (cy - world.y) / world.scale.y;
        world.scale.set(newScale);
        world.position.set(cx - wx * newScale, cy - wy * newScale);
      };

      host.addEventListener("wheel", onWheel, { passive: false });

      /* ---- Zoom toolbar helper (zooms around canvas center) ---- */
      zoomByRef.current = (factor: number) => {
        userInteractedRef.current = true;
        const newScale = Math.max(0.1, Math.min(4, world.scale.x * factor));
        const cx = app.screen.width / 2;
        const cy = app.screen.height / 2;
        const wx = (cx - world.x) / world.scale.x;
        const wy = (cy - world.y) / world.scale.y;
        world.scale.set(newScale);
        world.position.set(cx - wx * newScale, cy - wy * newScale);
      };

      /* ---- Recenter ---- */
      recenterRef.current = () => {
        world.position.set(0, 0);
        world.scale.set(1);
        // Fit all nodes in view
        if (nodes.length === 0) return;
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const n of nodes) {
          if (n.x == null || n.y == null) continue;
          if (n.x - n.radius < minX) minX = n.x - n.radius;
          if (n.x + n.radius > maxX) maxX = n.x + n.radius;
          if (n.y - n.radius < minY) minY = n.y - n.radius;
          if (n.y + n.radius > maxY) maxY = n.y + n.radius;
        }
        if (!isFinite(minX)) return;
        const cw = app.screen.width;
        const ch = app.screen.height;
        const padding = 40;
        const scaleX = (cw - padding * 2) / (maxX - minX);
        const scaleY = (ch - padding * 2) / (maxY - minY);
        const scale = Math.min(scaleX, scaleY, 2); // cap at 2x
        world.scale.set(scale);
        world.position.set(padding - minX * scale, padding - minY * scale);
      };

      // Auto-fit the whole graph in view on first cooldown — only if the
      // user hasn't already pan/zoomed/dragged. Subsequent layouts are
      // left alone so the user's framing isn't yanked away.
      sim.on("end", () => {
        if (!userInteractedRef.current) recenterRef.current?.();
      });
      // Belt-and-suspenders: also fit after a timed budget in case the
      // sim never fires "end" (rare, but cheap to guard).
      const initialFitTimer = setTimeout(() => {
        if (!userInteractedRef.current) recenterRef.current?.();
      }, 4000);

      // Stash for cleanup
      (
        app as unknown as {
          __wheelHandler?: typeof onWheel;
          __initialFitTimer?: ReturnType<typeof setTimeout>;
        }
      ).__wheelHandler = onWheel;
      (
        app as unknown as { __initialFitTimer?: ReturnType<typeof setTimeout> }
      ).__initialFitTimer = initialFitTimer;
    })();

    return () => {
      cancelled = true;
      recenterRef.current = null;
      zoomByRef.current = null;

      const currentSim = simRef.current;
      if (currentSim) currentSim.stop();

      const currentApp = appRef.current;
      if (currentApp) {
        const ext = currentApp as unknown as {
          __wheelHandler?: (ev: WheelEvent) => void;
          __initialFitTimer?: ReturnType<typeof setTimeout>;
        };
        if (ext.__wheelHandler && host)
          host.removeEventListener("wheel", ext.__wheelHandler);
        if (ext.__initialFitTimer) clearTimeout(ext.__initialFitTimer);
        currentApp.destroy(
          { removeView: true },
          { children: true, texture: true, textureSource: true },
        );
      }

      appRef.current = null;
      simRef.current = null;

      // Do NOT wipe host.firstChild — that destroys the React-managed
      // toolbar / legend / tooltip nodes too, and React won't re-attach
      // them until something else triggers a re-render. `app.destroy`
      // with `removeView: true` already removes the canvas.
    };
  }, [props.notes, props.mocs]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ touchAction: "none" }}
    >
      {/* Toolbar: zoom in/out + fit */}
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
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 rounded-lg px-3 py-2.5 text-[10px] backdrop-blur-sm"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
          border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
        }}
      >
        {/* Node types */}
        <div className="flex flex-wrap items-center gap-3">
          {Object.entries(STATUS_COLOR_HEX).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span style={{ color: "var(--bai-text-tertiary, #9ca3af)" }}>
                {status.replace("_", " ")}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3"
              style={{
                backgroundColor: MOC_COLOR_HEX,
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }}
            />
            <span style={{ color: "var(--bai-text-tertiary, #9ca3af)" }}>
              MOC
            </span>
          </div>
        </div>
        {/* Edge types */}
        <div className="flex flex-wrap items-center gap-3">
          {Object.entries(LINK_TYPE_COLOR_HEX).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3 border-t-2"
                style={{ borderColor: color }}
              />
              <span style={{ color: "var(--bai-text-muted, #6b7280)" }}>
                {type.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-3 border-t-2"
              style={{ borderColor: MOC_COLOR_HEX }}
            />
            <span style={{ color: "var(--bai-text-muted, #6b7280)" }}>
              core idea
            </span>
          </div>
        </div>
      </div>

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
              onClick={() => {
                selectedIdRef.current = null;
                setSelectedDetail(null);
              }}
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

function ToolbarButton(props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
        color: "var(--bai-text-secondary, #d4d4d8)",
        border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
      }}
    >
      {props.children}
    </button>
  );
}
