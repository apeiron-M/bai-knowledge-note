import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import {
  setSelectedNode,
  useNodesInSelectedDrive,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { ancestorFolderIds } from "../lib/folder-path.js";
import type { Node } from "@powerhousedao/shared/document-drive";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { LoadingLine, Spinner } from "./LoadingStates.js";
import {
  VaultPlaces,
  type VaultPlace,
  type VaultPlaceId,
} from "./VaultPlaces.js";
import {
  altStepDelta,
  stepId,
  VaultContextList,
  type VaultContextListProps,
} from "./VaultContextList.js";

type VaultSidebarProps = {
  /** Only to tell a background refresh from a first load. */
  notes: KnowledgeNoteInfo[];
  /**
   * True until the first vault metadata fetch settles. Drives the
   * skeletons below: without it the sidebar renders zero-count groups
   * and "nothing here" copy while the data is still in flight.
   */
  isLoading?: boolean;
  /**
   * The list of what you are in (a source folder, a topic map, a graph
   * selection). While it is set it replaces the places rail and the tree.
   */
  context?: VaultContextListProps;
  /**
   * The sidebar owns its width and tells the shell, whose first column
   * follows it. `undefined` means "no width chosen": the shell's own default
   * applies. 0 while collapsed, so the column closes with the sidebar.
   */
  onWidthChange?: (px: number | undefined) => void;
  /** The place the sidebar is showing. */
  place?: VaultPlaceId;
  places?: VaultPlace[];
  onSelectPlace?: (id: VaultPlaceId) => void;
  onOpenSettings?: () => void;
};

/** What the sidebar body shows: a context's list, the drive tree, or nothing but the places. */
export type SidebarBody = "context" | "folders" | "places";

/**
 * The one place that decides what the sidebar body shows. A context wins,
 * then the drive tree while it is open, then the places alone.
 */
export function sidebarBody(hasContext: boolean, treeOpen: boolean): SidebarBody {
  return hasContext ? "context" : treeOpen ? "folders" : "places";
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

/**
 * The note tree while a context shows its list. Where the browser has
 * `content-visibility` (Chrome/Edge 85+, Firefox 125+, Safari 18+) its rows
 * keep their rendering state, so bringing them back costs nothing; elsewhere
 * it is simply not displayed.
 */
const HIDDEN_TREE_STYLE =
  typeof CSS !== "undefined" && CSS.supports("content-visibility", "hidden")
    ? ({ contentVisibility: "hidden" } as const)
    : ({ display: "none" } as const);

const SELECTED_ROW_STYLE = {
  backgroundColor: "var(--bai-hover)",
} as const;

export function VaultSidebar({
  notes,
  isLoading = false,
  context,
  onWidthChange,
  place = "notes",
  places = [],
  onSelectPlace,
  onOpenSettings,
}: VaultSidebarProps) {
  const [search, setSearch] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const selectedNode = useSelectedNode();
  const selectedId = selectedNode?.id;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Null until the user drags: the shell's column (and its breakpoints) set
  // the width until then.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  useLayoutEffect(() => {
    onWidthChange?.(sidebarOpen ? (sidebarWidth ?? undefined) : 0);
  }, [onWidthChange, sidebarOpen, sidebarWidth]);
  // File nodes only — no doc state fetch. `useDocumentsInSelectedDrive`
  // would suspend-and-throw on any orphan id missing from the cache,
  // freezing the whole drive editor in retry-loops.
  const allNodes: Node[] | undefined = useNodesInSelectedDrive();

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth =
        rootRef.current?.getBoundingClientRect().width ?? MIN_WIDTH;

      function onMouseMove(ev: MouseEvent) {
        if (!resizing.current) return;
        const newWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)),
        );
        setSidebarWidth(newWidth);
      }
      function onMouseUp() {
        resizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [],
  );

  const q = search.trim().toLowerCase();

  const hasContext = context !== undefined;
  const body = sidebarBody(hasContext, treeOpen);

  // Alt+ArrowUp / Alt+ArrowDown hop along the context's list, unless the
  // reader is typing somewhere.
  useEffect(() => {
    const ctx = context;
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA");
      const delta = altStepDelta(e.key, e.altKey, typing);
      if (delta === undefined) return;
      const next = stepId(
        ctx.items.map((item) => item.id),
        ctx.activeId,
        delta,
      );
      if (next === undefined) return;
      e.preventDefault();
      ctx.onOpen(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [context]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector("[data-sidebar-active=\"true\"]")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, body]);

  // A loading state is only honest while there is nothing to show. Once
  // any data has arrived — including a cached snapshot that the live fetch
  // will replace — we render it and show a quieter refresh hint instead.
  const showTreeSkeleton = isLoading && (allNodes?.length ?? 0) === 0;
  const isRefreshing = isLoading && notes.length > 0;

  // The note tree is the heaviest part of the sidebar: a row per node, ~2,000 in a
  // large vault. Memoised, and kept mounted (hidden) while a context's list is
  // up, so going back to the tree neither rebuilds nor remounts it.
  const treeContent = useMemo(
    () =>
      showTreeSkeleton ? (
        <LoadingLine label="Loading drive tree…" />
      ) : (
        <FolderTreeView
          nodes={allNodes ?? []}
          query={q}
          selectedId={selectedId}
        />
      ),
    [showTreeSkeleton, allNodes, q, selectedId],
  );

  // A context's list shows from the top; clearing it puts the tree back
  // where the reader had scrolled it.
  const contentRef = useRef<HTMLDivElement>(null);
  const treeScrollTop = useRef(0);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el) el.scrollTop = hasContext ? 0 : treeScrollTop.current;
  }, [hasContext]);

  // Collapsed: just the re-open button, floating over the content.
  //
  // This used to render a full-height `w-10` strip (its own background +
  // right border), which kept taking horizontal space from the content
  // after collapsing — the point of collapsing. `absolute` takes the
  // button out of flow so the panel to the right reclaims the full width,
  // and the zero-width wrapper is `relative` only so the button positions
  // against it rather than some ancestor. A translucent background keeps
  // the glyph legible over whatever it floats above.
  //
  // `-top-4` straddles the host bar's bottom border instead of sitting inside
  // the bar (where it overlapped the Search tab). The wrapper is the sidebar
  // cell, which starts at that border, so a negative offset lifts the button
  // back across it: the bar is ~45px tall (`py-2` = 8+8, around a `py-1.5
  // text-xs` tab of 6+16+6 = 28, plus the 1px border) and this button is 26px
  // tall, so the 28px it used to sit at from the window top is 28 - 45 = ~-16.
  // Revisit if the bar's padding, the tab size, or this button's own padding
  // changes.
  //
  // Round (`rounded-full`) rather than a rounded square: the circle pulls
  // its corners away from the adjacent Search tab, so the two read as
  // separate controls even where they come close.
  if (!sidebarOpen) {
    return (
      <div className="relative h-full w-0 shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="sidebar-collapse-btn absolute left-0.09 -top-4 z-20 rounded-full p-1 backdrop-blur transition-colors"
          style={{
            color: "var(--bai-text-muted)",
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
          title="Open sidebar"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="vault-sidebar relative flex h-full flex-col border-r"
      style={{
        width: "100%",
        backgroundColor: "var(--bai-deep)",
        borderColor: "var(--bai-border)",
      }}
    >
      {/* Resize handle */}
      <div
        className="sidebar-resize-handle absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div
        className="border-b px-3 py-3"
        style={{ borderColor: "var(--bai-border)" }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="sidebar-collapse-btn shrink-0 rounded p-1 transition-colors"
            style={{ color: "var(--bai-text-faint)" }}
            title="Collapse sidebar"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter: narrows the drive tree, the only list it is shown over. */}
      {body === "folders" && (
        <div className="px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter this list…"
            className="sidebar-search-input w-full rounded-md border px-3 py-1.5 text-xs outline-none"
            style={{
              borderColor: "var(--bai-border)",
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
            }}
          />
        </div>
      )}

      {body !== "context" && (
        <VaultPlaces
          places={places}
          active={place}
          onSelect={(id) => {
            setTreeOpen(false);
            onSelectPlace?.(id);
          }}
          onOpenSettings={() => onOpenSettings?.()}
          tree={{
            active: body === "folders",
            onOpen: () => setTreeOpen(true),
          }}
        />
      )}

      {/* Refreshing hint: data is on screen but may be a cached snapshot. */}
      {body !== "context" && isRefreshing && (
        <div className="flex items-center gap-1.5 px-3 pb-1">
          <Spinner className="h-2.5 w-2.5" />
          <span
            className="text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Refreshing…
          </span>
        </div>
      )}

      {/* Content */}
      <div
        ref={contentRef}
        onScroll={(e) => {
          if (!hasContext) treeScrollTop.current = e.currentTarget.scrollTop;
        }}
        className="flex-1 overflow-y-auto px-2 pb-4"
      >
        {context && <VaultContextList {...context} />}
        {/* Kept mounted once opened, and hidden while a context's list shows
            (see HIDDEN_TREE_STYLE); inert keeps its rows out of the tab order
            and the accessibility tree meanwhile. */}
        {treeOpen && (
          <div
            inert={hasContext}
            aria-hidden={hasContext ? true : undefined}
            style={hasContext ? HIDDEN_TREE_STYLE : undefined}
          >
            {treeContent}
          </div>
        )}
      </div>

      <style aria-hidden="true">{`
        .sidebar-collapse-btn:hover {
          background-color: var(--bai-hover);
          color: var(--bai-accent);
        }
        .sidebar-search-input::placeholder {
          color: var(--bai-text-muted);
        }
        .sidebar-search-input:focus {
          border-color: var(--bai-accent);
        }
        .sidebar-tab:hover {
          color: var(--bai-text-tertiary);
        }
        .sidebar-row:hover {
          background-color: var(--bai-hover);
        }
        .sidebar-row:hover .sidebar-note-title {
          color: var(--bai-accent);
        }
        .sidebar-resize-handle:hover {
          background-color: color-mix(in srgb, var(--bai-accent) 30%, transparent);
        }
        .sidebar-resize-handle:active {
          background-color: color-mix(in srgb, var(--bai-accent) 50%, transparent);
        }
      `}</style>
    </div>
  );
}

type FolderTreeNode = {
  id: string;
  name: string;
  kind: string;
  children: FolderTreeNode[];
  docType?: string;
};

function FolderTreeView({
  nodes,
  query,
  selectedId,
}: {
  nodes: Node[];
  query: string;
  selectedId?: string;
}) {
  const tree = useMemo(() => {
    function build(parentId: string | null): FolderTreeNode[] {
      return nodes
        .filter((n) =>
          parentId == null
            ? n.parentFolder == null
            : n.parentFolder === parentId,
        )
        .map(
          (node): FolderTreeNode => ({
            id: node.id,
            name: node.name,
            kind: node.kind,
            docType:
              node.kind === "file"
                ? (node as Node & { kind: "file"; documentType: string })
                    .documentType
                : undefined,
            children: node.kind === "folder" ? build(node.id) : [],
          }),
        )
        .sort((a, b) => {
          if (a.kind === "folder" && b.kind !== "folder") return -1;
          if (a.kind !== "folder" && b.kind === "folder") return 1;
          return a.name.localeCompare(b.name);
        });
    }

    function matches(node: FolderTreeNode): boolean {
      if (!query) return true;
      if (node.name.toLowerCase().includes(query)) return true;
      return node.children.some(matches);
    }

    function prune(nodes: FolderTreeNode[]): FolderTreeNode[] {
      if (!query) return nodes;
      return nodes.filter(matches).map((n) => ({
        ...n,
        children: prune(n.children),
      }));
    }

    return prune(build(null));
  }, [nodes, query]);

  // Open folders live here, not in each row, so the folders above the
  // selection can be opened from one place. A selection is only useful if it
  // is visible: after a reload, or when a document is opened from somewhere
  // other than this tree (the Sources tab, search, a chat citation), every
  // folder starts closed and the highlighted row would sit hidden inside
  // them.
  const selectedPath = useMemo(
    () => ancestorFolderIds(nodes, selectedId),
    [nodes, selectedId],
  );
  // Changes when the selection moves, or when the tree first learns where the
  // selection lives (it can load after the selection is known).
  const revealKey = `${selectedId ?? ""}|${selectedPath.join("/")}`;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(selectedPath),
  );
  const [revealedKey, setRevealedKey] = useState(revealKey);
  // Adjusted during render rather than in an effect, so the first paint of a
  // new selection already has its folders open. Once per selection: a folder
  // the user closes afterwards stays closed until the selection moves again.
  if (revealKey !== revealedKey) {
    setRevealedKey(revealKey);
    if (selectedPath.some((id) => !expanded.has(id))) {
      setExpanded(new Set([...expanded, ...selectedPath]));
    }
  }
  const toggleFolder = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    containerRef.current
      ?.querySelector('[data-sidebar-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, revealKey]);

  if (query && tree.length === 0) {
    return (
      <p
        className="px-2 py-4 text-center text-xs"
        style={{ color: "var(--bai-text-faint)" }}
      >
        No files match “{query}”
      </p>
    );
  }

  return (
    <div ref={containerRef} className="space-y-0.5">
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          forceExpand={!!query}
          selectedId={selectedId}
          expanded={expanded}
          onToggleFolder={toggleFolder}
        />
      ))}
    </div>
  );
}

function TreeItem({
  node,
  depth,
  forceExpand = false,
  selectedId,
  expanded,
  onToggleFolder,
}: {
  node: FolderTreeNode;
  depth: number;
  forceExpand?: boolean;
  selectedId?: string;
  expanded: ReadonlySet<string>;
  onToggleFolder: (id: string) => void;
}) {
  const isFolder = node.kind === "folder";
  const hasChildren = node.children.length > 0;
  const open = forceExpand || expanded.has(node.id);
  const selected = selectedId === node.id;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          isFolder ? onToggleFolder(node.id) : setSelectedNode(node.id)
        }
        className="sidebar-row group flex w-full items-center gap-1 rounded px-1 py-1 text-left"
        data-sidebar-active={selected ? "true" : undefined}
        aria-current={selected ? "page" : undefined}
        style={{
          paddingLeft: `${depth * 12 + 4}px`,
          ...(selected ? SELECTED_ROW_STYLE : {}),
        }}
      >
        {isFolder ? (
          <svg
            className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            style={{ color: "var(--bai-text-faint)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : (
          <span className="h-3 w-3" />
        )}
        {isFolder ? (
          <svg
            className="h-3.5 w-3.5 shrink-0 text-amber-400/70"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        ) : (
          <svg
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--bai-text-faint)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        )}
        <span
          className={`sidebar-note-title truncate text-[11px] ${isFolder ? "font-medium" : ""}`}
          style={{
            color: selected
              ? "var(--bai-accent)"
              : isFolder
                ? "var(--bai-text-secondary)"
                : "var(--bai-text-tertiary)",
          }}
        >
          {node.name}
        </span>
        {isFolder && hasChildren && (
          <span
            className="ml-auto text-[9px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {node.children.length}
          </span>
        )}
      </button>
      {isFolder &&
        open &&
        node.children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            forceExpand={forceExpand}
            selectedId={selectedId}
            expanded={expanded}
            onToggleFolder={onToggleFolder}
          />
        ))}
    </div>
  );
}
