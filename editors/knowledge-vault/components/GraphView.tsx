import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";

type PersistedGraphState = {
  nodes: { id: string; documentId: string; title?: string | null; noteType?: string | null; status?: string | null }[];
  edges: { id: string; sourceDocumentId: string; targetDocumentId: string; linkType?: string | null }[];
  lastSyncedAt?: string | null;
} | null;

type GraphViewProps = {
  notes: KnowledgeNoteInfo[];
  graphState?: PersistedGraphState;
};

type GraphNode = {
  id: string;
  label: string;
  status: string;
  linkCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: string | null;
};

const STATUS_NODE_COLORS: Record<string, string> = {
  DRAFT: "#f59e0b",
  IN_REVIEW: "#3b82f6",
  CANONICAL: "#10b981",
  ARCHIVED: "#6b7280",
};

const LINK_TYPE_COLORS: Record<string, string> = {
  RELATES_TO: "#64748b",
  BUILDS_ON: "#0ea5e9",
  CONTRADICTS: "#ef4444",
  SUPERSEDES: "#a855f7",
  DERIVED_FROM: "#f59e0b",
};

function buildGraphFromState(
  graphState: NonNullable<PersistedGraphState>,
) {
  const edges: GraphEdge[] = graphState.edges.map((e) => ({
    source: e.sourceDocumentId,
    target: e.targetDocumentId,
    type: e.linkType ?? null,
  }));

  const linkCounts = new Map<string, number>();
  for (const edge of edges) {
    linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1);
    linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = graphState.nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / graphState.nodes.length;
    const radius = Math.min(300, graphState.nodes.length * 15);
    return {
      id: node.documentId,
      label: node.title ?? node.documentId.slice(0, 8),
      status: node.status ?? "DRAFT",
      linkCount: linkCounts.get(node.documentId) ?? 0,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  return { nodes, edges };
}

function buildGraph(
  notes: KnowledgeNoteInfo[],
) {
  const nodeIds = new Set(notes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  for (const note of notes) {
    for (const link of note.links) {
      if (link.targetDocumentId && nodeIds.has(link.targetDocumentId)) {
        edges.push({
          source: note.id,
          target: link.targetDocumentId,
          type: link.linkType,
        });
      }
    }
  }

  // Count links per node
  const linkCounts = new Map<string, number>();
  for (const edge of edges) {
    linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1);
    linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1);
  }

  // Initial positions in a circle
  const nodes: GraphNode[] = notes.map((note, i) => {
    const angle = (2 * Math.PI * i) / notes.length;
    const radius = Math.min(300, notes.length * 15);
    return {
      id: note.id,
      label: note.title ?? note.name,
      status: note.status ?? "DRAFT",
      linkCount: linkCounts.get(note.id) ?? 0,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  return { nodes, edges };
}

function simulateForces(nodes: GraphNode[], edges: GraphEdge[], iterations: number) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (800 * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 120) * 0.03 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      node.vx -= node.x * 0.01 * alpha;
      node.vy -= node.y * 0.01 * alpha;
    }

    // Apply velocity with damping
    for (const node of nodes) {
      node.x += node.vx * 0.5;
      node.y += node.vy * 0.5;
      node.vx *= 0.6;
      node.vy *= 0.6;
    }
  }
}

export function GraphView({ notes, graphState }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { graphNodes, edges, nodePositions } = useMemo(() => {
    // Prefer persisted graph state if available, otherwise compute from notes
    const { nodes, edges: e } = graphState?.nodes.length
      ? buildGraphFromState(graphState)
      : buildGraph(notes);
    simulateForces(nodes, e, 100);
    const positions = new Map(nodes.map((n) => [n.id, n]));
    return { graphNodes: nodes, edges: e, nodePositions: positions };
  }, [notes, graphState]);
  const cx = dimensions.width / 2;
  const cy = dimensions.height / 2;

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
  }, []);

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">No notes to display in graph</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#11111b]">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="h-full w-full"
      >
        {/* Edges */}
        {edges.map((edge, i) => {
          const source = nodePositions.get(edge.source);
          const target = nodePositions.get(edge.target);
          if (!source || !target) return null;
          const isHighlighted =
            hoveredNode === edge.source || hoveredNode === edge.target;
          const color = LINK_TYPE_COLORS[edge.type ?? "RELATES_TO"] ?? "#64748b";

          return (
            <line
              key={`${edge.source}-${edge.target}-${i}`}
              x1={source.x + cx}
              y1={source.y + cy}
              x2={target.x + cx}
              y2={target.y + cy}
              stroke={color}
              strokeWidth={isHighlighted ? 2 : 1}
              opacity={
                hoveredNode
                  ? isHighlighted
                    ? 0.8
                    : 0.1
                  : 0.3
              }
            />
          );
        })}

        {/* Nodes */}
        {graphNodes.map((node) => {
          const radius = Math.max(5, Math.min(16, 5 + node.linkCount * 2));
          const color = STATUS_NODE_COLORS[node.status] ?? "#6b7280";
          const isHovered = hoveredNode === node.id;
          const isConnected =
            hoveredNode &&
            edges.some(
              (e) =>
                (e.source === hoveredNode && e.target === node.id) ||
                (e.target === hoveredNode && e.source === node.id),
            );
          const dimmed = hoveredNode && !isHovered && !isConnected;

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => handleNodeClick(node.id)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Glow */}
              {isHovered && (
                <circle
                  cx={node.x + cx}
                  cy={node.y + cy}
                  r={radius + 6}
                  fill={color}
                  opacity={0.15}
                />
              )}
              <circle
                cx={node.x + cx}
                cy={node.y + cy}
                r={radius}
                fill={color}
                opacity={dimmed ? 0.15 : 0.9}
                stroke={isHovered ? "#fff" : "none"}
                strokeWidth={2}
              />
              {/* Label */}
              {(isHovered || isConnected || !hoveredNode) && (
                <text
                  x={node.x + cx}
                  y={node.y + cy + radius + 14}
                  textAnchor="middle"
                  className="pointer-events-none select-none fill-gray-400 text-[10px]"
                  opacity={dimmed ? 0.2 : isHovered ? 1 : 0.7}
                >
                  {node.label.length > 25
                    ? node.label.slice(0, 25) + "\u2026"
                    : node.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-4 rounded-lg bg-[#1e1e2e]/90 px-3 py-2 text-[10px] backdrop-blur-sm">
        {Object.entries(STATUS_NODE_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-400">
              {status.replace("_", " ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
