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
import { VaultMenu, type VaultMenuItem } from "./VaultMenu.js";
import { VaultGlyph } from "./VaultGlyph.js";
import { VaultIcon } from "./vault-icons.js";
import { SIDEBAR_CSS } from "./sidebar-css.js";
import { useFrameWidth } from "./VaultShell.js";

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
   * selection). While it is set it takes the sidebar's height; the places
   * fold into one row of icons above it.
   */
  context?: VaultContextListProps;
  /**
   * The sidebar owns its width and tells the shell, whose first column
   * follows it: a dragged width, the rail's, or `undefined` for the shell's
   * own default.
   */
  onWidthChange?: (px: number | undefined) => void;
  /** The place you are in; none while a view that belongs to no place shows (search, activity…). */
  place?: VaultPlaceId;
  /** A Vault settings view or document is showing: its row at the foot is the current one. */
  settingsActive?: boolean;
  places?: VaultPlace[];
  onSelectPlace?: (id: VaultPlaceId) => void;
  /** The vault's name, at the top of the sidebar. */
  vaultName?: string;
  /** Ids of the vault's largest topics: its glyph beside the name. */
  glyphSeeds?: string[];
  /**
   * "This vault": the menu under the name and behind Vault settings. The
   * `files` entry opens the drive tree here; every other key goes to
   * `onMenuSelect`.
   */
  menuItems?: VaultMenuItem[];
  onMenuSelect?: (key: string) => void;
  onSearch?: () => void;
  /** The search view is the one showing. */
  searchActive?: boolean;
  onAddSources?: () => void;
  /** Beside Add sources: the other things a person can add (a note, a topic, pasted text). */
  createItems?: VaultMenuItem[];
  onCreate?: (key: string) => void;
  onGettingStarted?: () => void;
};

/** What the sidebar body shows: a context's list, the drive tree, or the places. */
export type SidebarBody = "context" | "folders" | "places";

/**
 * The one place that decides what the sidebar body shows. A context wins,
 * then the drive tree while it is open, then the places alone.
 */
export function sidebarBody(hasContext: boolean, treeOpen: boolean): SidebarBody {
  return hasContext ? "context" : treeOpen ? "folders" : "places";
}

/** Below this frame width the sidebar is the icon rail (design: 720–899 px). */
export const RAIL_BELOW = 900;
/** The labelled icon rail's width (design: 78 px). */
export const RAIL_WIDTH = 78;

/**
 * Full sidebar or labelled icon rail. The rail when the reader collapsed the
 * sidebar, or when the frame is too narrow for both columns. An unmeasured
 * frame (0) keeps the full sidebar.
 */
export function sidebarMode(frameWidth: number, collapsed: boolean): "full" | "rail" {
  return collapsed || (frameWidth > 0 && frameWidth < RAIL_BELOW) ? "rail" : "full";
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

/** "⌘ K" on a Mac, "Ctrl K" elsewhere. */
function searchShortcut(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return /mac/i.test(platform) ? "⌘ K" : "Ctrl K";
}

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

type OpenMenu = "head" | "add" | "foot" | null;

/**
 * The vault's one navigation column. Top to bottom: the vault (its menu),
 * search and adding, the places — or, while you are in something, that
 * thing's list under a row of the places' icons — and at the foot this
 * vault's settings and the guide. There is no bar above the content: the
 * sidebar holds everything (design: docs/design/vault-view).
 */
export function VaultSidebar({
  notes,
  isLoading = false,
  context,
  onWidthChange,
  place,
  settingsActive = false,
  places = [],
  onSelectPlace,
  vaultName = "",
  glyphSeeds = [],
  menuItems = [],
  onMenuSelect,
  onSearch,
  searchActive = false,
  onAddSources,
  createItems = [],
  onCreate,
  onGettingStarted,
}: VaultSidebarProps) {
  const [search, setSearch] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [menu, setMenu] = useState<OpenMenu>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const selectedNode = useSelectedNode();
  const selectedId = selectedNode?.id;
  const [collapsed, setCollapsed] = useState(false);
  const frameWidth = useFrameWidth();
  const mode = sidebarMode(frameWidth, collapsed);
  const forcedRail = mode === "rail" && !collapsed;
  // Null until the user drags: the shell's column (and its breakpoints) set
  // the width until then.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const resizing = useRef(false);
  useLayoutEffect(() => {
    onWidthChange?.(mode === "rail" ? RAIL_WIDTH : (sidebarWidth ?? undefined));
  }, [onWidthChange, mode, sidebarWidth]);
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

  // The drive tree is the heaviest part of the sidebar: a row per node, ~2,000 in a
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

  const selectPlace = (id: VaultPlaceId) => {
    setTreeOpen(false);
    onSelectPlace?.(id);
  };
  const selectMenu = (key: string) => {
    if (key === "files") {
      setCollapsed(false);
      setTreeOpen(true);
      return;
    }
    onMenuSelect?.(key);
  };
  // The rail has no room for the drive tree: its entry waits for a wider frame.
  const vaultMenuItems = forcedRail ? menuItems.filter((i) => i.key !== "files") : menuItems;
  const vaultMenu = (placement: "below" | "above") => (
    <VaultMenu
      label={vaultName ? `${vaultName}: this vault` : "This vault"}
      heading="This vault"
      items={vaultMenuItems}
      placement={placement}
      onSelect={selectMenu}
      onClose={closeMenu}
    />
  );
  const rail = mode === "rail";

  return (
    <aside
      ref={rootRef}
      className="vault-sidebar"
      data-mode={mode}
      aria-label={vaultName ? `Vault ${vaultName}` : "Vault"}
    >
      <style aria-hidden="true">{SIDEBAR_CSS}</style>
      {!rail && (
        <div
          className="sidebar-resize-handle absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize"
          onMouseDown={handleMouseDown}
          aria-hidden="true"
        />
      )}

      {/* The vault: its name opens this vault's menu. */}
      <div className="vs-head">
        <div className="vs-anchor" style={{ flex: 1, minWidth: 0, width: rail ? "100%" : undefined }}>
          <button
            type="button"
            className="vs-ident"
            title={vaultName}
            aria-haspopup="menu"
            aria-expanded={menu === "head"}
            onClick={() => setMenu(menu === "head" ? null : "head")}
          >
            <VaultGlyph seeds={glyphSeeds} />
            <span className="vs-name">{vaultName}</span>
            <span className="vs-chev">
              <VaultIcon name="down" size={14} />
            </span>
          </button>
          {menu === "head" && vaultMenu("below")}
        </div>
        {!forcedRail && (
          <button
            type="button"
            className="vs-iconbtn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          >
            <VaultIcon name={collapsed ? "expand" : "collapse"} />
          </button>
        )}
      </div>

      {onSearch && (
        <button
          type="button"
          className="vs-search"
          onClick={onSearch}
          aria-current={searchActive ? "page" : undefined}
          title={`Search the vault (${searchShortcut()})`}
        >
          <VaultIcon name="search" />
          <span className="lbl">Search</span>
          <kbd>{searchShortcut()}</kbd>
        </button>
      )}

      {onAddSources && (
        <div className="vs-add vs-anchor">
          <button
            type="button"
            className="vs-add-main"
            data-split={createItems.length > 0 ? "" : undefined}
            onClick={onAddSources}
            title="Add sources"
          >
            <VaultIcon name="plus" />
            <span className="lbl">Add sources</span>
          </button>
          {createItems.length > 0 && (
            <button
              type="button"
              className="vs-add-more"
              aria-label="More to add"
              title="Write a note, start a topic, paste text"
              aria-haspopup="menu"
              aria-expanded={menu === "add"}
              onClick={() => setMenu(menu === "add" ? null : "add")}
            >
              <VaultIcon name="down" size={14} />
            </button>
          )}
          {menu === "add" && (
            <VaultMenu
              label="Add to the vault"
              heading="Add to the vault"
              items={createItems}
              placement="below"
              onSelect={(key) => onCreate?.(key)}
              onClose={closeMenu}
            />
          )}
        </div>
      )}

      <div
        ref={contentRef}
        className="vs-body"
        onScroll={(e) => {
          if (!hasContext) treeScrollTop.current = e.currentTarget.scrollTop;
        }}
      >
        {rail || body === "places" ? (
          <VaultPlaces places={places} active={place} onSelect={selectPlace} />
        ) : (
          <VaultPlaces places={places} active={place} onSelect={selectPlace} variant="icons" />
        )}

        {/* Refreshing hint: data is on screen but may be a cached snapshot. */}
        {!rail && body !== "context" && isRefreshing && (
          <div className="flex items-center gap-1.5 px-2">
            <Spinner className="h-2.5 w-2.5" />
            <span className="text-[11px]" style={{ color: "var(--bai-text-tertiary)" }}>
              Refreshing…
            </span>
          </div>
        )}

        {!rail && context && <VaultContextList {...context} />}

        {!rail && body === "folders" && (
          <div className="flex flex-col gap-2">
            <div className="vs-list-head">
              <button
                type="button"
                className="vs-iconbtn"
                onClick={() => setTreeOpen(false)}
                title="Back to the places"
                aria-label="Back to the places"
              >
                <VaultIcon name="back" />
              </button>
              <b>Files and folders</b>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter this list…"
              aria-label="Filter the files"
              className="sidebar-search-input w-full rounded-md border px-3 py-1.5 text-xs outline-none"
              style={{ color: "var(--bai-text-secondary)" }}
            />
          </div>
        )}
        {/* Kept mounted once opened, and hidden while a context's list shows
            (see HIDDEN_TREE_STYLE); inert keeps its rows out of the tab order
            and the accessibility tree meanwhile. */}
        {!rail && treeOpen && (
          <div
            inert={hasContext}
            aria-hidden={hasContext ? true : undefined}
            style={hasContext ? HIDDEN_TREE_STYLE : undefined}
          >
            {treeContent}
          </div>
        )}
      </div>

      {/* This vault's settings and the guide, at the foot. */}
      <div className="vs-foot">
        <div className="vs-anchor">
          <button
            type="button"
            className="vs-row"
            title="Vault settings"
            aria-current={settingsActive ? "page" : undefined}
            aria-haspopup="menu"
            aria-expanded={menu === "foot"}
            onClick={() => setMenu(menu === "foot" ? null : "foot")}
          >
            <VaultIcon name="gear" />
            <span className="lbl">Vault settings</span>
          </button>
          {menu === "foot" && vaultMenu("above")}
        </div>
        {onGettingStarted && (
          <button
            type="button"
            className="vs-row"
            title="Getting started"
            onClick={onGettingStarted}
          >
            <VaultIcon name="help" />
            <span className="lbl">Getting started</span>
          </button>
        )}
      </div>

      <style aria-hidden="true">{`
        .sidebar-search-input::placeholder {
          color: var(--bai-text-muted);
        }
        .sidebar-search-input:focus {
          border-color: var(--bai-accent);
        }
        .sidebar-row:hover {
          background-color: var(--v-rail-hover);
        }
        .sidebar-row:hover .sidebar-note-title {
          color: var(--bai-accent);
        }
      `}</style>
    </aside>
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
