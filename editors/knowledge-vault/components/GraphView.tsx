import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import cytoscape from "cytoscape";

// @ts-expect-error - no types available for cytoscape-cose-bilkent
import coseBilkent from "cytoscape-cose-bilkent";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";

// Register the cose-bilkent layout once

cytoscape.use(coseBilkent as cytoscape.Ext);

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type PersistedGraphState = {
  nodes: {
    id: string;
    documentId: string;
    title?: string | null;
    noteType?: string | null;
    status?: string | null;
  }[];
  edges: {
    id: string;
    sourceDocumentId: string;
    targetDocumentId: string;
    linkType?: string | null;
  }[];
  lastSyncedAt?: string | null;
} | null;

type MocInfo = {
  id: string;
  title: string;
  tier: string | null;
  coreIdeas: { noteRef: string; contextPhrase: string }[];
};

type GraphViewProps = {
  notes: KnowledgeNoteInfo[];
  graphState?: PersistedGraphState;
  mocs?: MocInfo[];
};

type NodeDetail = {
  id: string;
  label: string;
  status: string;
  noteType: string | null;
  description: string | null;
  topics: { id: string; name: string }[];
  linkCount: number;
  neighbors: { id: string; label: string; edgeType: string | null }[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

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

const MOC_NODE_COLOR = "#cba6f7";
const MOC_EDGE_COLOR = "#cba6f7";
const DEFAULT_NODE_COLOR = "#6b7280";
const DEFAULT_EDGE_COLOR = "#64748b";

/* ------------------------------------------------------------------ */
/*  Build cytoscape elements from data                                */
/* ------------------------------------------------------------------ */

function buildElements(
  notes: KnowledgeNoteInfo[],
  graphState: PersistedGraphState,
  mocs?: MocInfo[],
) {
  const elements: cytoscape.ElementDefinition[] = [];
  const noteMap = new Map(notes.map((n) => [n.id, n]));

  if (graphState?.nodes.length) {
    // Use persisted graph state
    const linkCounts = new Map<string, number>();
    for (const edge of graphState.edges) {
      linkCounts.set(
        edge.sourceDocumentId,
        (linkCounts.get(edge.sourceDocumentId) ?? 0) + 1,
      );
      linkCounts.set(
        edge.targetDocumentId,
        (linkCounts.get(edge.targetDocumentId) ?? 0) + 1,
      );
    }

    for (const node of graphState.nodes) {
      const note = noteMap.get(node.documentId);
      elements.push({
        data: {
          id: node.documentId,
          label: node.title ?? node.documentId.slice(0, 8),
          status: node.status ?? "DRAFT",
          noteType: note?.noteType ?? node.noteType ?? null,
          description: note?.description ?? null,
          topics: note?.topics ?? [],
          linkCount: linkCounts.get(node.documentId) ?? 0,
          color:
            STATUS_NODE_COLORS[node.status ?? "DRAFT"] ?? DEFAULT_NODE_COLOR,
        },
      });
    }

    for (const edge of graphState.edges) {
      elements.push({
        data: {
          id: edge.id,
          source: edge.sourceDocumentId,
          target: edge.targetDocumentId,
          linkType: edge.linkType ?? null,
          color: LINK_TYPE_COLORS[edge.linkType ?? ""] ?? DEFAULT_EDGE_COLOR,
        },
      });
    }
  } else {
    // Compute from notes
    const nodeIds = new Set(notes.map((n) => n.id));
    const edgeList: {
      source: string;
      target: string;
      linkType: string | null;
    }[] = [];

    for (const note of notes) {
      for (const link of note.links) {
        if (link.targetDocumentId && nodeIds.has(link.targetDocumentId)) {
          edgeList.push({
            source: note.id,
            target: link.targetDocumentId,
            linkType: link.linkType,
          });
        }
      }
    }

    const linkCounts = new Map<string, number>();
    for (const edge of edgeList) {
      linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1);
      linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1);
    }

    for (const note of notes) {
      elements.push({
        data: {
          id: note.id,
          label: note.title ?? note.name,
          status: note.status ?? "DRAFT",
          noteType: note.noteType ?? null,
          description: note.description ?? null,
          topics: note.topics,
          linkCount: linkCounts.get(note.id) ?? 0,
          color:
            STATUS_NODE_COLORS[note.status ?? "DRAFT"] ?? DEFAULT_NODE_COLOR,
        },
      });
    }

    edgeList.forEach((edge, i) => {
      elements.push({
        data: {
          id: `e-${i}`,
          source: edge.source,
          target: edge.target,
          linkType: edge.linkType ?? null,
          color: LINK_TYPE_COLORS[edge.linkType ?? ""] ?? DEFAULT_EDGE_COLOR,
        },
      });
    });
  }

  // Add MOC nodes and their edges to core ideas
  const existingNodeIds = new Set(elements.filter((e) => !e.data.source).map((e) => e.data.id));
  if (mocs?.length) {
    for (const moc of mocs) {
      elements.push({
        data: {
          id: moc.id,
          label: moc.title,
          status: "MOC",
          noteType: `MOC (${moc.tier ?? "TOPIC"})`,
          description: null,
          topics: [],
          linkCount: moc.coreIdeas.length,
          color: MOC_NODE_COLOR,
          isMoc: true,
        },
      });

      for (const idea of moc.coreIdeas) {
        if (existingNodeIds.has(idea.noteRef)) {
          elements.push({
            data: {
              id: `moc-${moc.id}-${idea.noteRef}`,
              source: moc.id,
              target: idea.noteRef,
              linkType: "CORE_IDEA",
              color: MOC_EDGE_COLOR,
            },
          });
        }
      }
    }
  }

  return elements;
}

/* ------------------------------------------------------------------ */
/*  Cytoscape stylesheet                                              */
/* ------------------------------------------------------------------ */

const cyStylesheet: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      label: "data(label)",
      color: "#a6adc8",
      "font-size": "10px",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "text-max-width": "100px",
      "text-wrap": "ellipsis",
      "text-overflow-wrap": "anywhere",
      width: "mapData(linkCount, 0, 10, 16, 40)",
      height: "mapData(linkCount, 0, 10, 16, 40)",
      "border-width": 0,
      "border-color": "#fff",
      "overlay-padding": 4,
      "transition-property":
        "background-color, border-width, width, height, opacity",
      "transition-duration": 150,
    } as cytoscape.Css.Node,
  },
  {
    selector: "edge",
    style: {
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      width: 1.5,
      opacity: 0.4,
      "transition-property": "opacity, width, line-color",
      "transition-duration": 150,
    } as cytoscape.Css.Edge,
  },
  // MOC nodes — diamond shape, larger
  {
    selector: "node[?isMoc]",
    style: {
      shape: "diamond",
      width: 35,
      height: 35,
      "font-size": "11px",
      "font-weight": "bold",
      "border-width": 2,
      "border-color": "#cba6f7",
      "border-opacity": 0.5,
    } as cytoscape.Css.Node,
  },
  // MOC edges — dashed
  {
    selector: "edge[linkType = 'CORE_IDEA']",
    style: {
      "line-style": "dashed",
      "line-dash-pattern": [6, 3],
      opacity: 0.6,
      width: 1,
    } as cytoscape.Css.Edge,
  },
  // Highlighted node (hovered or selected)
  {
    selector: "node.highlighted",
    style: {
      "border-width": 3,
      "border-color": "#cba6f7",
      "background-opacity": 1,
      "z-index": 10,
    } as cytoscape.Css.Node,
  },
  // Neighbor of highlighted
  {
    selector: "node.neighbor",
    style: {
      "background-opacity": 1,
      "z-index": 5,
    } as cytoscape.Css.Node,
  },
  // Dimmed (not highlighted or neighbor)
  {
    selector: "node.dimmed",
    style: {
      opacity: 0.12,
    } as cytoscape.Css.Node,
  },
  // Highlighted edge
  {
    selector: "edge.highlighted",
    style: {
      opacity: 0.85,
      width: 2.5,
    } as cytoscape.Css.Edge,
  },
  // Dimmed edge
  {
    selector: "edge.dimmed",
    style: {
      opacity: 0.06,
    } as cytoscape.Css.Edge,
  },
  // Selected node
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "#cba6f7",
    } as cytoscape.Css.Node,
  },
];

/* ------------------------------------------------------------------ */
/*  Layout options                                                    */
/* ------------------------------------------------------------------ */

function getLayoutOptions(): cytoscape.LayoutOptions {
  return {
    name: "cose-bilkent",
    animate: false,
    nodeRepulsion: 6000,
    idealEdgeLength: 120,
    edgeElasticity: 0.1,
    nestingFactor: 0.1,
    gravity: 0.25,
    numIter: 2500,
    tile: true,
    fit: true,
    padding: 40,
  } as cytoscape.LayoutOptions;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function GraphView({ notes, graphState, mocs }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoverInfo, setHoverInfo] = useState<{
    node: NodeDetail;
    x: number;
    y: number;
  } | null>(null);

  // Build elements from data
  const elements = useMemo(
    () => buildElements(notes, graphState ?? null, mocs),
    [notes, graphState],
  );

  // Gather neighbor info for the detail panel
  const getNodeDetail = useCallback((nodeId: string): NodeDetail | null => {
    const cy = cyRef.current;
    if (!cy) return null;
    const node = cy.getElementById(nodeId);
    if (!node.length) return null;

    const neighborhood = node.neighborhood();
    const neighborNodes = neighborhood.nodes();
    const connectedEdges = node.connectedEdges();

    const neighbors: NodeDetail["neighbors"] = [];
    neighborNodes.forEach((n) => {
      const connectingEdge = connectedEdges.filter(
        (e) =>
          (e.source().id() === nodeId && e.target().id() === n.id()) ||
          (e.target().id() === nodeId && e.source().id() === n.id()),
      );
      neighbors.push({
        id: n.id(),
        label: String(n.data("label") ?? ""),
        edgeType: connectingEdge.length
          ? String(connectingEdge.first().data("linkType") ?? "") || null
          : null,
      });
    });

    type NodeData = {
      label: string;
      status: string;
      noteType: string | null;
      description: string | null;
      topics: NodeDetail["topics"];
      linkCount: number;
    };
    const d = node.data() as NodeData;
    return {
      id: nodeId,
      label: d.label,
      status: d.status,
      noteType: d.noteType,
      description: d.description,
      topics: d.topics,
      linkCount: d.linkCount,
      neighbors,
    };
  }, []);

  // Highlight a node and its neighborhood, dim the rest
  const highlightNode = useCallback((cy: cytoscape.Core, nodeId: string) => {
    const node = cy.getElementById(nodeId);
    if (!node.length) return;

    const neighborhood = node.closedNeighborhood();

    cy.batch(() => {
      cy.elements().removeClass("highlighted neighbor dimmed");
      cy.elements().not(neighborhood).addClass("dimmed");
      neighborhood.edges().addClass("highlighted");
      neighborhood.nodes().not(node).addClass("neighbor");
      node.addClass("highlighted");
    });
  }, []);

  const clearHighlight = useCallback((cy: cytoscape.Core) => {
    cy.batch(() => {
      cy.elements().removeClass("highlighted neighbor dimmed");
    });
  }, []);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cyStylesheet,
      layout: getLayoutOptions(),
      zoom: 1,
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 3,
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;

    // After layout settles, ensure zoom is 100% with nodes centered.
    // fit:true already centered the graph; now pin zoom to 1 around
    // the midpoint of the bounding box so pan stays correct.
    cy.one("layoutstop", () => {
      const bb = cy.elements().boundingBox();
      const modelCenter = { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
      cy.zoom({ level: 1, position: modelCenter });
      cy.center();
    });

    // Track zoom level for UI
    cy.on("zoom", () => {
      setZoomLevel(cy.zoom());
    });

    // Click node: select it in reactor + show detail
    cy.on("tap", "node", (evt) => {
      const nodeId = String((evt.target as cytoscape.NodeSingular).id());
      setSelectedNode(nodeId);
      highlightNode(cy, nodeId);
      setSelectedDetail(getNodeDetail(nodeId));
    });

    // Hover node: highlight neighborhood + show tooltip
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      const nodeId = String(node.id());
      highlightNode(cy, nodeId);
      containerRef.current!.style.cursor = "pointer";

      const detail = getNodeDetail(nodeId);
      if (detail) {
        const pos = node.renderedPosition();
        setHoverInfo({ node: detail, x: pos.x, y: pos.y });
      }
    });

    cy.on("mouseout", "node", () => {
      setHoverInfo(null);
      // Only clear if no node is selected in detail panel
      if (!cyRef.current?.$(":selected").length) {
        clearHighlight(cy);
      }
      containerRef.current!.style.cursor = "default";
    });

    // Click background: deselect
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        clearHighlight(cy);
        setSelectedDetail(null);
      }
    });

    setZoomLevel(cy.zoom());

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, highlightNode, clearHighlight, getNodeDetail]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate(
      {
        zoom: {
          level: cy.zoom() * 1.4,
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        },
      },
      { duration: 200 },
    );
  }, []);

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate(
      {
        zoom: {
          level: cy.zoom() / 1.4,
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        },
      },
      { duration: 200 },
    );
  }, []);

  const handleFit = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate(
      { fit: { eles: cy.elements(), padding: 40 } },
      { duration: 300 },
    );
    setSelectedDetail(null);
    clearHighlight(cy);
  }, [clearHighlight]);

  // Focus on selected node — zoom in and center
  const handleFocusNode = useCallback(
    (nodeId: string) => {
      const cy = cyRef.current;
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (!node.length) return;
      cy.animate(
        {
          center: { eles: node },
          zoom: { level: 2.5, position: node.position() },
        },
        { duration: 300 },
      );
      highlightNode(cy, nodeId);
      setSelectedDetail(getNodeDetail(nodeId));
    },
    [highlightNode, getNodeDetail],
  );

  // Re-run layout
  const handleRelayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(getLayoutOptions()).run();
  }, []);

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p style={{ color: "var(--bai-text-muted)" }}>
          No notes to display in graph
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: "var(--bai-deep)" }}
    >
      {/* Cytoscape container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Zoom controls */}
      <div className="absolute right-4 top-4 flex flex-col gap-1">
        <button
          type="button"
          onClick={handleZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
            color: "var(--bai-text-secondary)",
          }}
          title="Zoom in"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
            color: "var(--bai-text-secondary)",
          }}
          title="Zoom out"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleFit}
          className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
            color: "var(--bai-text-secondary)",
          }}
          title="Fit to screen"
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
        </button>
        <button
          type="button"
          onClick={handleRelayout}
          className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
            color: "var(--bai-text-secondary)",
          }}
          title="Re-run layout"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
        </button>
        <div
          className="mt-1 rounded-md px-1.5 py-1 text-center text-[9px] backdrop-blur-sm"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
            color: "var(--bai-text-muted)",
          }}
        >
          {Math.round(zoomLevel * 100)}%
        </div>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-4 left-4 flex flex-col gap-2 rounded-lg px-3 py-2.5 text-[10px] backdrop-blur-sm"
        style={{
          backgroundColor: "color-mix(in srgb, var(--bai-bg) 90%, transparent)",
          border: "1px solid var(--bai-border)",
        }}
      >
        {/* Node types */}
        <div className="flex items-center gap-3">
          {Object.entries(STATUS_NODE_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span style={{ color: "var(--bai-text-tertiary)" }}>
                {status.replace("_", " ")}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3"
              style={{
                backgroundColor: MOC_NODE_COLOR,
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }}
            />
            <span style={{ color: "var(--bai-text-tertiary)" }}>MOC</span>
          </div>
        </div>
        {/* Edge types */}
        <div className="flex items-center gap-3">
          {Object.entries(LINK_TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3 border-t-2"
                style={{ borderColor: color }}
              />
              <span style={{ color: "var(--bai-text-muted)" }}>
                {type.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-3 border-t-2 border-dashed"
              style={{ borderColor: MOC_EDGE_COLOR }}
            />
            <span style={{ color: "var(--bai-text-muted)" }}>core idea</span>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoverInfo && !selectedDetail && (
        <div
          className="pointer-events-none absolute z-30 w-96 rounded-lg border p-5 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(
              hoverInfo.x + 16,
              (containerRef.current?.offsetWidth ?? 800) - 410,
            ),
            top: Math.max(8, hoverInfo.y - 20),
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 95%, transparent)",
            borderColor: "var(--bai-border)",
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
              style={{
                backgroundColor:
                  STATUS_NODE_COLORS[hoverInfo.node.status] ??
                  DEFAULT_NODE_COLOR,
              }}
            />
            <span
              className="truncate text-base font-semibold"
              style={{ color: "var(--bai-text)" }}
            >
              {hoverInfo.node.label}
            </span>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-[11px]"
              style={{
                backgroundColor: "var(--bai-hover)",
                color: "var(--bai-text-tertiary)",
              }}
            >
              {hoverInfo.node.status.replace("_", " ")}
            </span>
            {hoverInfo.node.noteType && (
              <span
                className="rounded px-2 py-0.5 text-[11px]"
                style={{
                  backgroundColor: "var(--bai-accent-soft)",
                  color: "var(--bai-accent)",
                }}
              >
                {hoverInfo.node.noteType}
              </span>
            )}
            {hoverInfo.node.linkCount > 0 && (
              <span
                className="text-[11px]"
                style={{ color: "var(--bai-text-muted)" }}
              >
                {hoverInfo.node.linkCount} connection
                {hoverInfo.node.linkCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {hoverInfo.node.description && (
            <p
              className="mb-2.5 line-clamp-5 text-sm leading-relaxed"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              {hoverInfo.node.description}
            </p>
          )}

          {hoverInfo.node.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {hoverInfo.node.topics.map((topic) => (
                <span
                  key={topic.id}
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-text-muted)",
                  }}
                >
                  {topic.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail panel */}
      {selectedDetail && (
        <div
          className="absolute right-14 top-4 w-72 rounded-lg border p-4 shadow-xl backdrop-blur-sm"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--bai-bg) 95%, transparent)",
            borderColor: "var(--bai-border)",
          }}
        >
          {/* Header */}
          <div className="mb-3 flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-sm font-semibold"
                style={{ color: "var(--bai-text)" }}
              >
                {selectedDetail.label}
              </h3>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      STATUS_NODE_COLORS[selectedDetail.status] ??
                      DEFAULT_NODE_COLOR,
                  }}
                />
                <span
                  className="text-[10px]"
                  style={{ color: "var(--bai-text-tertiary)" }}
                >
                  {selectedDetail.status}
                </span>
                {selectedDetail.noteType && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: "var(--bai-hover)",
                      color: "var(--bai-text-muted)",
                    }}
                  >
                    {selectedDetail.noteType}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedDetail(null);
                if (cyRef.current) clearHighlight(cyRef.current);
              }}
              className="ml-2"
              style={{ color: "var(--bai-text-muted)" }}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Description */}
          {selectedDetail.description && (
            <p
              className="mb-3 line-clamp-3 text-xs leading-relaxed"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              {selectedDetail.description}
            </p>
          )}

          {/* Topics */}
          {selectedDetail.topics.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {selectedDetail.topics.map((topic) => (
                <span
                  key={topic.id}
                  className="rounded-full px-2 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: "var(--bai-accent-soft)",
                    color: "var(--bai-accent)",
                  }}
                >
                  {topic.name}
                </span>
              ))}
            </div>
          )}

          {/* Connections */}
          {selectedDetail.neighbors.length > 0 && (
            <div>
              <h4
                className="mb-1.5 text-[10px] font-medium uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Connections ({selectedDetail.neighbors.length})
              </h4>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {selectedDetail.neighbors.map((neighbor) => (
                  <button
                    key={neighbor.id}
                    type="button"
                    onClick={() => handleFocusNode(neighbor.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors"
                    style={{ color: "var(--bai-text-secondary)" }}
                  >
                    <span
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          LINK_TYPE_COLORS[neighbor.edgeType ?? ""] ??
                          DEFAULT_EDGE_COLOR,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {neighbor.label}
                    </span>
                    <span
                      className="flex-shrink-0 text-[9px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {(neighbor.edgeType ?? "untyped")
                        .replace(/_/g, " ")
                        .toLowerCase()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Open button */}
          <button
            type="button"
            onClick={() => setSelectedNode(selectedDetail.id)}
            className="mt-3 w-full rounded-md py-1.5 text-xs font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--bai-accent-soft)",
              color: "var(--bai-accent)",
            }}
          >
            Open Note
          </button>
        </div>
      )}
    </div>
  );
}
