import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  isFileNodeKind,
  setSelectedNode,
  useNodesInSelectedDrive,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { prefetchOnHover } from "../lib/prefetch.js";
import { useVaultName } from "../hooks/use-vault-name.js";
import type { Node } from "@powerhousedao/shared/document-drive";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import type { GraphFocus } from "./GraphViewPixi.js";
import { LoadingLine, SidebarSkeleton, Spinner } from "./LoadingStates.js";

type VaultSidebarProps = {
  notes: KnowledgeNoteInfo[];
  mocs: MocInfo[];
  /**
   * True until the first vault metadata fetch settles. Drives the
   * skeletons below: without it the sidebar renders zero-count groups
   * and "nothing here" copy while the data is still in flight.
   */
  isLoading?: boolean;
  /** When set, sidebar content is replaced by the graph highlight neighborhood. */
  graphFocus?: GraphFocus | null;
  onClearGraphFocus?: () => void;
};

const STATUS_ORDER = ["CANONICAL", "IN_REVIEW", "DRAFT", "ARCHIVED"] as const;
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-amber-400",
  IN_REVIEW: "bg-blue-400",
  CANONICAL: "bg-emerald-400",
  ARCHIVED: "bg-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Drafts",
  IN_REVIEW: "In Review",
  CANONICAL: "Canonical",
  ARCHIVED: "Archived",
};

type SidebarSection = "notes" | "mocs" | "signals" | "folders";

const MIN_WIDTH = 200;

const SIDEBAR_NOTE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  CONCEPT: { bg: "rgba(139,92,246,0.15)", color: "rgba(167,139,250,1)" },
  DECISION: { bg: "rgba(239,68,68,0.12)", color: "rgba(248,113,113,1)" },
  PATTERN: { bg: "rgba(16,185,129,0.15)", color: "rgba(52,211,153,1)" },
  PROCEDURE: { bg: "rgba(59,130,246,0.15)", color: "rgba(96,165,250,1)" },
  REFERENCE: { bg: "rgba(245,158,11,0.15)", color: "rgba(252,211,77,1)" },
  BUG_PATTERN: { bg: "rgba(239,68,68,0.15)", color: "rgba(248,113,113,1)" },
  OBSERVATION: { bg: "rgba(244,114,182,0.15)", color: "rgba(243,156,185,1)" },
  INTEGRATION: { bg: "rgba(16,185,129,0.15)", color: "rgba(52,211,153,1)" },
  WORKFLOW: { bg: "rgba(59,130,246,0.15)", color: "rgba(96,165,250,1)" },
};
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

const SELECTED_ROW_STYLE = {
  backgroundColor: "var(--bai-hover)",
} as const;

export function VaultSidebar({
  notes,
  mocs,
  isLoading = false,
  graphFocus = null,
  onClearGraphFocus,
}: VaultSidebarProps) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<SidebarSection>("notes");
  const selectedNode = useSelectedNode();
  const selectedId = selectedNode?.id;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    ARCHIVED: true,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const resizing = useRef(false);
  // File nodes only — no doc state fetch. `useDocumentsInSelectedDrive`
  // would suspend-and-throw on any orphan id missing from the cache,
  // freezing the whole drive editor in retry-loops.
  const allNodes: Node[] | undefined = useNodesInSelectedDrive();
  const fileNodes = useMemo(
    () =>
      (allNodes ?? []).filter(
        (n): n is Node & { kind: "file"; documentType: string } =>
          isFileNodeKind(n),
      ),
    [allNodes],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

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
    [sidebarWidth],
  );

  const vaultName = useVaultName();

  const observations = useMemo(() => {
    return fileNodes
      .filter((n) => n.documentType === "bai/observation")
      .map((n) => ({
        id: n.id,
        title: n.name,
        category: null as string | null,
        status: "PENDING" as const,
      }));
  }, [fileNodes]);

  const tensions = useMemo(() => {
    return fileNodes
      .filter((n) => n.documentType === "bai/tension")
      .map((n) => ({
        id: n.id,
        title: n.name,
        status: "OPEN" as const,
      }));
  }, [fileNodes]);

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return notes;
    return notes.filter(
      (n) =>
        (n.title ?? n.name).toLowerCase().includes(q) ||
        (n.noteType ?? "").toLowerCase().includes(q) ||
        n.topics.some((t) => t.name.toLowerCase().includes(q)),
    );
  }, [notes, q]);

  const filteredMocs = useMemo(() => {
    if (!q) return mocs;
    return mocs.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.tier ?? "").toLowerCase().includes(q),
    );
  }, [mocs, q]);

  const filteredObservations = useMemo(() => {
    if (!q) return observations;
    return observations.filter((o) => o.title.toLowerCase().includes(q));
  }, [observations, q]);

  const filteredTensions = useMemo(() => {
    if (!q) return tensions;
    return tensions.filter((t) => t.title.toLowerCase().includes(q));
  }, [tensions, q]);

  const grouped = useMemo(() => {
    const groups: Record<string, KnowledgeNoteInfo[]> = {};
    for (const s of STATUS_ORDER) groups[s] = [];
    for (const note of filtered) {
      const status = note.status ?? "DRAFT";
      (groups[status] ?? groups.DRAFT).push(note);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    if (!selectedId || !selectedNode || !isFileNodeKind(selectedNode)) return;
    const docType = selectedNode.documentType;
    if (docType === "bai/knowledge-note") setSection("notes");
    else if (docType === "bai/moc") setSection("mocs");
    else if (docType === "bai/observation" || docType === "bai/tension")
      setSection("signals");
    else setSection("folders");
    const note = notes.find((n) => n.id === selectedId);
    if (note) {
      const status = note.status ?? "DRAFT";
      setCollapsed((c) => (c[status] ? { ...c, [status]: false } : c));
    }
  }, [selectedId, selectedNode, notes]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector("[data-sidebar-active=\"true\"]")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, section]);

  // A loading state is only honest while there is nothing to show. Once
  // any data has arrived — including a cached snapshot that the live fetch
  // will replace — we render it and show a quieter refresh hint instead.
  const showNotesSkeleton = isLoading && notes.length === 0;
  const showMocsSkeleton = isLoading && mocs.length === 0;
  const showSignalsSkeleton =
    isLoading && observations.length === 0 && tensions.length === 0;
  const showTreeSkeleton = isLoading && (allNodes?.length ?? 0) === 0;
  const isRefreshing = isLoading && notes.length > 0;

  const noteMap = useMemo(() => {
    const map = new Map<string, KnowledgeNoteInfo>();
    for (const n of notes) map.set(n.id, n);
    return map;
  }, [notes]);

  const mocMap = useMemo(() => {
    const map = new Map<string, MocInfo>();
    for (const m of mocs) map.set(m.id, m);
    return map;
  }, [mocs]);

  const connectionItems = useMemo(() => {
    if (!graphFocus) return [];
    const selectedId = graphFocus.selectedId;
    // Selected node first, then neighbors in stable focusedIds order.
    const ordered = [
      selectedId,
      ...graphFocus.focusedIds.filter((id) => id !== selectedId),
    ];
    // The edge between the selected note and a neighbour, either
    // direction, with its articulation when one was recorded — so the
    // list says not just WHAT is connected but WHY.
    const selectedNote = noteMap.get(selectedId);
    const edgeTo = (
      id: string,
    ): { linkType: string | null; reason: string | null; direction: "out" | "in" } | null => {
      const out = selectedNote?.links.find((l) => l.targetDocumentId === id);
      if (out) return { linkType: out.linkType, reason: out.reason, direction: "out" };
      const back = noteMap.get(id)?.links.find((l) => l.targetDocumentId === selectedId);
      if (back) return { linkType: back.linkType, reason: back.reason, direction: "in" };
      return null;
    };
    return ordered.map((id) => {
      const edge = id === selectedId ? null : edgeTo(id);
      const note = noteMap.get(id);
      if (note) {
        return {
          id,
          title: note.title ?? note.name,
          kind: "Note" as const,
          meta: note.noteType,
          topics: note.topics,
          isSelected: id === selectedId,
          edge,
        };
      }
      const moc = mocMap.get(id);
      if (moc) {
        return {
          id,
          title: moc.title,
          kind: "MoC" as const,
          meta: moc.tier,
          topics: [] as { id: string; name: string }[],
          isSelected: id === selectedId,
          edge,
        };
      }
      return {
        id,
        title: id.slice(0, 12),
        kind: "Unknown" as const,
        meta: null as string | null,
        topics: [] as { id: string; name: string }[],
        isSelected: id === selectedId,
        edge,
      };
    });
  }, [graphFocus, noteMap, mocMap]);

  const selectedConnectionTitle =
    connectionItems.find((i) => i.isSelected)?.title ?? "Selected node";

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
  // `top-[31px]` straddles the top bar's bottom border instead of sitting
  // inside the bar (where it overlapped the Search tab). The wrapper and
  // DriveExplorer's top bar are siblings in the same flex row, so they
  // share a y origin: the bar is 44px tall (`py-2` = 8+8, around a
  // `py-1.5 text-xs` tab of 6+16+6 = 28) and its border sits at y=44-45.
  // This button is 26px tall (16px icon + `p-1` 4+4 + 1px border each
  // side), so 44.5 - 13 = ~31 centres it on that line. Revisit if the top
  // bar's padding, the tab size, or this button's own padding changes.
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
          className="sidebar-collapse-btn absolute left-0.09 top-[28px] z-20 rounded-full p-1 backdrop-blur transition-colors"
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
      className="relative flex h-full shrink-0 flex-col border-r"
      style={{
        width: sidebarWidth,
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
          <button
            type="button"
            onClick={() => setSelectedNode(undefined)}
            className="sidebar-vault-name flex-1 text-left text-sm font-semibold transition-colors truncate min-w-0"
            style={{ color: "var(--bai-text)" }}
            title="Back to vault overview"
          >
            {vaultName}
          </button>
        </div>
      </div>

      {/* Search */}
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

      {/* Section tabs — min height so the four labels stay clickable;
          at text-[10px] py-1 they were a ~24px strip and pointer clicks
          on MOCs/Signals/Tree never landed. */}
      <div className="flex gap-1 px-2 pb-1">
        {(
          [
            ["notes", "Notes"],
            ["mocs", "MOCs"],
            ["signals", "Signals"],
            ["folders", "Tree"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            aria-label={
              key === "notes"
                ? `Notes, ${notes.length}`
                : key === "mocs"
                  ? `MOCs, ${mocs.length}`
                  : key === "signals"
                    ? `Signals, ${observations.length + tensions.length}`
                    : "Tree"
            }
            onClick={() => {
              if (graphFocus) onClearGraphFocus?.();
              setSection(key);
            }}
            className="sidebar-tab flex min-h-8 flex-1 items-center justify-center rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors"
            style={
              section === key
                ? {
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-accent)",
                  }
                : { color: "var(--bai-text-faint)" }
            }
          >
            {label}
            {key === "notes" && notes.length > 0 && (
              <span className="ml-1" style={{ color: "var(--bai-text-faint)" }}>
                {notes.length}
              </span>
            )}
            {key === "mocs" && mocs.length > 0 && (
              <span className="ml-1" style={{ color: "var(--bai-text-faint)" }}>
                {mocs.length}
              </span>
            )}
            {key === "signals" && observations.length + tensions.length > 0 && (
              <span className="ml-1 text-amber-400">
                {observations.length + tensions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Refreshing hint: data is on screen but may be a cached snapshot. */}
      {isRefreshing && (
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
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {graphFocus ? (
          <div className="space-y-1">
            <div className="mb-1 flex items-start gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  Connections ({connectionItems.length})
                </p>
                <p
                  className="truncate text-xs font-medium"
                  style={{ color: "var(--bai-text-secondary)" }}
                  title={selectedConnectionTitle}
                >
                  {selectedConnectionTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onClearGraphFocus?.()}
                className="sidebar-collapse-btn shrink-0 rounded p-1 transition-colors"
                style={{ color: "var(--bai-text-faint)" }}
                title="Clear selection"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {connectionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedNode(item.id)}
                {...prefetchOnHover(item.id)}
                className="sidebar-row group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
                data-sidebar-active={item.isSelected ? "true" : undefined}
                aria-current={item.isSelected ? "page" : undefined}
                style={item.isSelected ? SELECTED_ROW_STYLE : undefined}
              >
                <span
                  className="sidebar-note-title truncate text-xs font-medium"
                  style={{
                    color: item.isSelected
                      ? "var(--bai-accent)"
                      : "var(--bai-text-secondary)",
                  }}
                >
                  {item.isSelected ? "● " : ""}
                  {item.title}
                </span>
                <div className="flex items-center gap-1.5">
                  {item.kind === "Note" && item.meta && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor:
                          SIDEBAR_NOTE_TYPE_COLORS[item.meta]?.bg ?? "var(--bai-hover)",
                        color:
                          SIDEBAR_NOTE_TYPE_COLORS[item.meta]?.color ?? "var(--bai-text-tertiary)",
                      }}
                    >
                      {item.meta}
                    </span>
                  )}
                  {item.kind !== "Note" && item.meta && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--bai-hover)",
                        color: "var(--bai-text-tertiary)",
                      }}
                    >
                      {item.kind}
                      {item.meta ? ` · ${item.meta}` : ""}
                    </span>
                  )}
                  {item.kind === "Note" && !item.meta && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--bai-hover)",
                        color: "var(--bai-text-tertiary)",
                      }}
                    >
                      {item.kind}
                    </span>
                  )}
                  {item.topics.slice(0, 2).map((t) => (
                    <span
                      key={t.id}
                      className="text-[10px]"
                      style={{
                        color: "var(--bai-accent)",
                        opacity: 0.6,
                      }}
                    >
                      #{t.name}
                    </span>
                  ))}
                  {item.edge && (
                    <span
                      className="ml-auto shrink-0 text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                      title={
                        item.edge.direction === "out"
                          ? `${selectedConnectionTitle} → ${item.title}`
                          : `${item.title} → ${selectedConnectionTitle}`
                      }
                    >
                      {item.edge.direction === "out" ? "→ " : "← "}
                      {(item.edge.linkType ?? "linked")
                        .replace(/_/g, " ")
                        .toLowerCase()}
                    </span>
                  )}
                </div>
                {item.edge?.reason && (
                  <span
                    className="line-clamp-2 text-[10px] italic leading-snug"
                    style={{ color: "var(--bai-text-faint)" }}
                    title={item.edge.reason}
                  >
                    {item.edge.reason}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <>
            {section === "notes" && showNotesSkeleton && (
              <SidebarSkeleton label="Loading notes…" />
            )}

            {section === "notes" && !showNotesSkeleton && (
              <>
                {notes.length === 0 && (
                  <div className="px-2 py-6 text-center">
                    <p
                      className="text-xs"
                      style={{ color: "var(--bai-text-muted)" }}
                    >
                      No knowledge notes yet
                    </p>
                    <p
                      className="mt-1 text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      Add a source to start the extraction pipeline
                    </p>
                  </div>
                )}
                {notes.length > 0 && filtered.length === 0 && (
                  <p
                    className="px-2 py-4 text-center text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No notes match “{search}”
                  </p>
                )}
                {STATUS_ORDER.map((status) => {
                  const groupNotes = grouped[status];
                  if (groupNotes.length === 0) return null;
                  const isCollapsed = collapsed[status] ?? status === "ARCHIVED";
                  return (
                    <div key={status} className="mb-1">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsed((c) => ({
                            ...c,
                            [status]: !isCollapsed,
                          }))
                        }
                        className="sidebar-row flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs"
                        style={{ color: "var(--bai-text-muted)" }}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`}
                        />
                        <span className="flex-1 text-left font-medium">
                          {STATUS_LABELS[status]}
                        </span>
                        <span style={{ color: "var(--bai-text-faint)" }}>
                          {groupNotes.length}
                        </span>
                        <svg
                          className={`h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                      {!isCollapsed && (
                        <div className="ml-1 space-y-px">
                          {groupNotes.map((note) => (
                            <button
                              key={note.id}
                              type="button"
                              onClick={() => setSelectedNode(note.id)}
                              {...prefetchOnHover(note.id)}
                              className="sidebar-row group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
                              data-sidebar-active={selectedId === note.id ? "true" : undefined}
                              aria-current={selectedId === note.id ? "page" : undefined}
                              style={
                                selectedId === note.id ? SELECTED_ROW_STYLE : undefined
                              }
                            >
                              <span
                                className="sidebar-note-title truncate text-xs font-medium"
                                style={{
                                  color:
                                    selectedId === note.id
                                      ? "var(--bai-accent)"
                                      : "var(--bai-text-secondary)",
                                }}
                              >
                                {note.title ?? note.name}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {note.noteType && (
                                  <span
                                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{
                                      backgroundColor:
                                        SIDEBAR_NOTE_TYPE_COLORS[note.noteType]?.bg ??
                                        "var(--bai-hover)",
                                      color:
                                        SIDEBAR_NOTE_TYPE_COLORS[note.noteType]?.color ??
                                        "var(--bai-text-tertiary)",
                                    }}
                                  >
                                    {note.noteType}
                                  </span>
                                )}
                                {note.topics.slice(0, 2).map((t) => (
                                  <span
                                    key={t.id}
                                    className="text-[10px]"
                                    style={{
                                      color: "var(--bai-accent)",
                                      opacity: 0.6,
                                    }}
                                  >
                                    #{t.name}
                                  </span>
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {section === "mocs" && (
              <div className="space-y-1">
                {showMocsSkeleton ? (
                  <SidebarSkeleton label="Loading MOCs…" rows={4} />
                ) : mocs.length === 0 ? (
                  <p
                    className="px-2 py-4 text-center text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No MOCs yet
                  </p>
                ) : filteredMocs.length === 0 ? (
                  <p
                    className="px-2 py-4 text-center text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No MOCs match “{search}”
                  </p>
                ) : (
                  <>
                    {(["HUB", "DOMAIN", "TOPIC"] as const).map((tier) => {
                      const tierMocs = filteredMocs.filter((m) => m.tier === tier);
                      if (tierMocs.length === 0) return null;
                      return (
                        <div key={tier}>
                          <p
                            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: "var(--bai-text-faint)" }}
                          >
                            {tier}
                          </p>
                          {tierMocs.map((moc) => (
                            <MocRow
                              key={moc.id}
                              moc={moc}
                              selected={selectedId === moc.id}
                            />
                          ))}
                        </div>
                      );
                    })}
                    {(() => {
                      const untiered = filteredMocs.filter((m) => m.tier === null);
                      if (untiered.length === 0) return null;
                      return (
                        <div key="untiered">
                          <p
                            className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: "var(--bai-text-faint)" }}
                          >
                            Untiered
                          </p>
                          {untiered.map((moc) => (
                            <MocRow
                              key={moc.id}
                              moc={moc}
                              selected={selectedId === moc.id}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            {section === "signals" && (
              <div className="space-y-3">
                {filteredObservations.length > 0 && (
                  <div>
                    <p
                      className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      Observations ({filteredObservations.length})
                    </p>
                    {filteredObservations.map((obs) => (
                      <button
                        key={obs.id}
                        type="button"
                        onClick={() => setSelectedNode(obs.id)}
                        className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                        data-sidebar-active={selectedId === obs.id ? "true" : undefined}
                        aria-current={selectedId === obs.id ? "page" : undefined}
                        style={
                          selectedId === obs.id ? SELECTED_ROW_STYLE : undefined
                        }
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                        <span
                          className="sidebar-note-title truncate text-xs"
                          style={{
                            color:
                              selectedId === obs.id
                                ? "var(--bai-accent)"
                                : "var(--bai-text-secondary)",
                          }}
                        >
                          {obs.title}
                        </span>
                        {obs.category && (
                          <span
                            className="rounded px-1 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: "var(--bai-hover)",
                              color: "var(--bai-text-muted)",
                            }}
                          >
                            {obs.category}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {filteredTensions.length > 0 && (
                  <div>
                    <p
                      className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      Tensions ({filteredTensions.length})
                    </p>
                    {filteredTensions.map((ten) => (
                      <button
                        key={ten.id}
                        type="button"
                        onClick={() => setSelectedNode(ten.id)}
                        className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                        data-sidebar-active={selectedId === ten.id ? "true" : undefined}
                        aria-current={selectedId === ten.id ? "page" : undefined}
                        style={
                          selectedId === ten.id ? SELECTED_ROW_STYLE : undefined
                        }
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                        <span
                          className="sidebar-note-title truncate text-xs"
                          style={{
                            color:
                              selectedId === ten.id
                                ? "var(--bai-accent)"
                                : "var(--bai-text-secondary)",
                          }}
                        >
                          {ten.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {showSignalsSkeleton && (
                  <LoadingLine label="Loading signals…" />
                )}
                {!showSignalsSkeleton &&
                  observations.length === 0 &&
                  tensions.length === 0 && (
                    <p
                      className="px-2 py-4 text-center text-xs"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      No pending signals
                    </p>
                  )}
                {!showSignalsSkeleton &&
                  (observations.length > 0 || tensions.length > 0) &&
                  filteredObservations.length === 0 &&
                  filteredTensions.length === 0 && (
                    <p
                      className="px-2 py-4 text-center text-xs"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      No signals match “{search}”
                    </p>
                  )}
              </div>
            )}

            {section === "folders" &&
              (showTreeSkeleton ? (
                <LoadingLine label="Loading drive tree…" />
              ) : (
                <FolderTreeView
                  nodes={allNodes ?? []}
                  query={q}
                  selectedId={selectedId}
                />
              ))}
          </>
        )}
      </div>

      <style aria-hidden="true">{`
        .sidebar-collapse-btn:hover {
          background-color: var(--bai-hover);
          color: var(--bai-accent);
        }
        .sidebar-vault-name:hover {
          color: var(--bai-accent);
        }
        .sidebar-search-input::placeholder {
          color: var(--bai-text-faint);
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

function MocRow({ moc, selected }: { moc: MocInfo; selected: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setSelectedNode(moc.id)}
      className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
      data-sidebar-active={selected ? "true" : undefined}
      aria-current={selected ? "page" : undefined}
      style={selected ? SELECTED_ROW_STYLE : undefined}
    >
      <svg
        className="h-3.5 w-3.5 shrink-0"
        style={{
          color: "var(--bai-accent)",
          opacity: 0.6,
        }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <span
        className="sidebar-note-title truncate text-xs"
        style={{
          color: selected ? "var(--bai-accent)" : "var(--bai-text-secondary)",
        }}
      >
        {moc.title}
      </span>
      {moc.noteCount + moc.childRefs.length > 0 && (
        <span
          className="ml-auto text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {moc.noteCount + moc.childRefs.length}
        </span>
      )}
    </button>
  );
}

function FolderTreeView({
  nodes,
  query,
  selectedId,
}: {
  nodes: Node[];
  query: string;
  selectedId?: string;
}) {
  type TreeNode = {
    id: string;
    name: string;
    kind: string;
    children: TreeNode[];
    docType?: string;
  };

  const tree = useMemo(() => {
    function build(parentId: string | null): TreeNode[] {
      return nodes
        .filter((n) =>
          parentId == null
            ? n.parentFolder == null
            : n.parentFolder === parentId,
        )
        .map(
          (node): TreeNode => ({
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

    function matches(node: TreeNode): boolean {
      if (!query) return true;
      if (node.name.toLowerCase().includes(query)) return true;
      return node.children.some(matches);
    }

    function prune(nodes: TreeNode[]): TreeNode[] {
      if (!query) return nodes;
      return nodes.filter(matches).map((n) => ({
        ...n,
        children: prune(n.children),
      }));
    }

    return prune(build(null));
  }, [nodes, query]);

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
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          forceExpand={!!query}
          selectedId={selectedId}
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
}: {
  node: {
    id: string;
    name: string;
    kind: string;
    children: {
      id: string;
      name: string;
      kind: string;
      children: any[];
      docType?: string;
    }[];
    docType?: string;
  };
  depth: number;
  forceExpand?: boolean;
  selectedId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = node.kind === "folder";
  const hasChildren = node.children.length > 0;
  const open = forceExpand || expanded;
  const selected = selectedId === node.id;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          isFolder ? setExpanded(!expanded) : setSelectedNode(node.id)
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
          />
        ))}
    </div>
  );
}
