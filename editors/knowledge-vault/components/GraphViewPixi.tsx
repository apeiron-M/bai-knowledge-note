import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
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

/* ------------------------------------------------------------------ */
/*  Color tokens                                                        */
/* ------------------------------------------------------------------ */

const NOTE_COLOR = 0xfab387; // amber
const MOC_COLOR = 0xcba6f7; // mauve
const EDGE_COLOR = 0x4b5563; // slate
const MOC_EDGE_COLOR = 0x9ca3af; // lighter for MoC edges
const BG_COLOR = 0x11111b; // catppuccin mocha base

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function GraphViewPixi(props: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

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
          radius: 4 + Math.min(8, Math.sqrt(linkCount) * 1.2),
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
          radius: 8 + Math.min(10, Math.sqrt(linkCount) * 1.3),
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

      const sim = forceSimulation<SimNode, SimLink>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-180))
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance((l) => (l.linkType === "CORE_IDEA" ? 80 : 60))
            .strength(0.15),
        )
        .force("center", forceCenter<SimNode>(w / 2, h / 2))
        .force(
          "collide",
          forceCollide<SimNode>()
            .radius((d) => d.radius + 4)
            .iterations(2),
        )
        .alpha(1)
        .alphaDecay(0.02);

      simRef.current = sim;

      /* ---- Per-node Graphics ---- */
      const nodeGfx = new Map<string, Graphics>();

      for (const n of nodes) {
        const g = new Graphics();
        g.circle(0, 0, n.radius).fill({ color: n.color });
        if (n.isMoc) {
          const r = n.radius + 3;
          g.poly([0, -r, r, 0, 0, r, -r, 0]).stroke({
            color: MOC_COLOR,
            width: 1,
            alpha: 0.5,
          });
        }
        nodeContainer.addChild(g);
        nodeGfx.set(n.id, g);
      }

      /* ---- Tick: redraw edges + reposition nodes ---- */
      sim.on("tick", () => {
        edgeGraphics.clear();
        for (const l of links) {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          if (s.x == null || s.y == null || t.x == null || t.y == null)
            continue;
          const color =
            l.linkType === "CORE_IDEA" ? MOC_EDGE_COLOR : EDGE_COLOR;
          edgeGraphics
            .moveTo(s.x, s.y)
            .lineTo(t.x, t.y)
            .stroke({ color, width: 0.6, alpha: 0.45 });
        }
        for (const n of nodes) {
          const g = nodeGfx.get(n.id);
          if (g && n.x != null && n.y != null) {
            g.position.set(n.x, n.y);
          }
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

      // Stash for cleanup
      (app as unknown as { __wheelHandler?: typeof onWheel }).__wheelHandler =
        onWheel;
    })();

    return () => {
      cancelled = true;

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
      className="h-full w-full"
      style={{ touchAction: "none" }}
    />
  );
}
