import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Circle } from "pixi.js";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
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
/*  Color tokens                                                        */
/* ------------------------------------------------------------------ */

const NOTE_COLOR = 0xfab387; // amber
const MOC_COLOR = 0xcba6f7; // mauve
const EDGE_COLOR = 0x6b7280; // slate-500 — readable on dark bg
const MOC_EDGE_COLOR = 0xcba6f7; // mauve — links to/from MoCs match the MoC color
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

  // Tooltip uses React state (HTML overlay)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

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
        const node: SimNode = {
          id: n.id,
          label: n.title ?? n.name,
          isMoc: false,
          tier: null,
          radius: 9 + Math.min(22, Math.sqrt(linkCount) * 3.2),
          color: NOTE_COLOR,
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

      // Forces tuned for larger nodes: stronger repulsion + longer links
      // give breathing room without losing cluster cohesion. Collide radius
      // adds a 6px gap on top of each node's visual radius — guarantees
      // no two nodes share screen pixels.
      const sim = forceSimulation<SimNode, SimLink>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-340))
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance((l) => (l.linkType === "CORE_IDEA" ? 110 : 90))
            .strength(0.2),
        )
        .force("center", forceCenter<SimNode>(w / 2, h / 2))
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
          // MoC visual treatment: solid mauve fill + bright halo ring +
          // dark inner border. Much larger than notes so they read as the
          // graph's structural backbone at any zoom.
          g.circle(0, 0, n.radius + 6).fill({ color: MOC_COLOR, alpha: 0.18 }); // glow
          g.circle(0, 0, n.radius).fill({ color: MOC_COLOR });
          g.circle(0, 0, n.radius).stroke({
            color: 0xfaf5ff,
            width: 2,
            alpha: 0.9,
          });
        } else {
          g.circle(0, 0, n.radius).fill({ color: n.color });
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

        g.on("pointertap", () => {
          // Update sticky selection
          if (selectedIdRef.current === n.id) {
            selectedIdRef.current = null;
          } else {
            selectedIdRef.current = n.id;
          }
          sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
          // Navigate
          setSelectedNode(n.id);
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

          const color =
            l.linkType === "CORE_IDEA" ? MOC_EDGE_COLOR : EDGE_COLOR;
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

      // Stash for cleanup
      (app as unknown as { __wheelHandler?: typeof onWheel }).__wheelHandler =
        onWheel;
    })();

    return () => {
      cancelled = true;
      recenterRef.current = null;

      const currentSim = simRef.current;
      if (currentSim) currentSim.stop();

      const currentApp = appRef.current;
      if (currentApp) {
        const wheel = (
          currentApp as unknown as {
            __wheelHandler?: (ev: WheelEvent) => void;
          }
        ).__wheelHandler;
        if (wheel && host) host.removeEventListener("wheel", wheel);
        currentApp.destroy(
          { removeView: true },
          { children: true, texture: true, textureSource: true },
        );
      }

      appRef.current = null;
      simRef.current = null;

      while (host.firstChild) host.removeChild(host.firstChild);
    };
  }, [props.notes, props.mocs]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ touchAction: "none" }}
    >
      {/* Recenter button */}
      <button
        type="button"
        onClick={() => recenterRef.current?.()}
        className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-xs"
        style={{
          backgroundColor: "var(--bai-surface, #181825)",
          color: "var(--bai-text-secondary, #d4d4d8)",
          border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
        }}
        title="Recenter graph"
      >
        Recenter
      </button>

      {/* Hover tooltip */}
      {hoverInfo && (
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
    </div>
  );
}
