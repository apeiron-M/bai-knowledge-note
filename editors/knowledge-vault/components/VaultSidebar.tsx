import { useState, useMemo, useCallback, useRef } from "react";
import {
  isFileNodeKind,
  setSelectedNode,
  useNodesInSelectedDrive,
  useSelectedDrive,
} from "@powerhousedao/reactor-browser";
import type { Node } from "@powerhousedao/shared/document-drive";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";

type VaultSidebarProps = {
  notes: KnowledgeNoteInfo[];
  mocs: MocInfo[];
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
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

export function VaultSidebar({ notes, mocs }: VaultSidebarProps) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<SidebarSection>("notes");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    ARCHIVED: true,
  });
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const resizing = useRef(false);
  // File nodes only — no doc state fetch. `useDocumentsInSelectedDrive`
  // would suspend-and-throw on any orphan id missing from the cache,
  // freezing the whole drive editor in retry-loops.
  //
  // `useNodesInSelectedDrive()` returns `any` in dev.253; cast to `Node[]`
  // so the type predicate below can narrow correctly. Without the cast,
  // every downstream filter/map callback infers `any` for its parameter.
  const allNodes = useNodesInSelectedDrive() as Node[] | undefined;
  const fileNodes = useMemo(
    () =>
      (allNodes ?? []).filter(
        (n): n is Node & { kind: "file"; documentType: string } =>
          isFileNodeKind(n),
      ),
    [allNodes],
  );
  const [selectedDrive] = useSelectedDrive();

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

  // Drive header has the name; no doc-state fetch needed.
  const vaultName = selectedDrive?.header.name || "Knowledge Vault";

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

  const filtered = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(
      (n) =>
        (n.title ?? n.name).toLowerCase().includes(q) ||
        (n.noteType ?? "").toLowerCase().includes(q) ||
        n.topics.some((t) => t.name.toLowerCase().includes(q)),
    );
  }, [notes, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, KnowledgeNoteInfo[]> = {};
    for (const s of STATUS_ORDER) groups[s] = [];
    for (const note of filtered) {
      const status = note.status ?? "DRAFT";
      (groups[status] ?? groups.DRAFT).push(note);
    }
    return groups;
  }, [filtered]);

  // Collapsed: show a thin strip with toggle button
  if (!sidebarOpen) {
    return (
      <div
        className="flex h-full w-10 shrink-0 flex-col items-center border-r py-3"
        style={{
          backgroundColor: "var(--bai-deep)",
          borderColor: "var(--bai-border)",
        }}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="sidebar-collapse-btn rounded p-1.5 transition-colors"
          style={{ color: "var(--bai-text-muted)" }}
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
          <button
            type="button"
            onClick={() => setCreateSourceOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--bai-accent-soft)",
              color: "var(--bai-accent)",
            }}
            title="Paste raw content — articles, notes, transcripts — for AI extraction"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Source
          </button>
          <CreateDocumentDialog
            open={createSourceOpen}
            documentType="bai/source"
            documentTypeLabel="Source"
            onClose={() => setCreateSourceOpen(false)}
          />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="sidebar-search-input w-full rounded-md border px-3 py-1.5 text-xs outline-none"
          style={{
            borderColor: "var(--bai-border)",
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-secondary)",
          }}
        />
      </div>

      {/* Section tabs */}
      <div className="flex gap-px px-3 pb-1">
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
            onClick={() => setSection(key)}
            className={`sidebar-tab flex-1 rounded-md py-1 text-[10px] font-medium transition-colors`}
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
            {key === "signals" && observations.length + tensions.length > 0 && (
              <span className="ml-1 text-amber-400">
                {observations.length + tensions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {section === "notes" && (
          <>
            {STATUS_ORDER.map((status) => {
              const groupNotes = grouped[status];
              if (groupNotes.length === 0) return null;
              const isCollapsed = collapsed[status] ?? false;
              return (
                <div key={status} className="mb-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [status]: !isCollapsed }))
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
                          className="sidebar-row group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
                        >
                          <span
                            className="sidebar-note-title truncate text-xs font-medium"
                            style={{ color: "var(--bai-text-secondary)" }}
                          >
                            {note.title ?? note.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {note.noteType && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px]"
                                style={{
                                  backgroundColor: "var(--bai-hover)",
                                  color: "var(--bai-text-tertiary)",
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
            {mocs.length === 0 ? (
              <p
                className="px-2 py-4 text-center text-xs"
                style={{ color: "var(--bai-text-faint)" }}
              >
                No MOCs yet
              </p>
            ) : (
              <>
                {(["HUB", "DOMAIN", "TOPIC"] as const).map((tier) => {
                  const tierMocs = mocs.filter((m) => m.tier === tier);
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
                        <button
                          key={moc.id}
                          type="button"
                          onClick={() => setSelectedNode(moc.id)}
                          className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                        >
                          <svg
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: "var(--bai-accent)", opacity: 0.6 }}
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
                            style={{ color: "var(--bai-text-secondary)" }}
                          >
                            {moc.title}
                          </span>
                          <span
                            className="ml-auto text-[10px]"
                            style={{ color: "var(--bai-text-faint)" }}
                          >
                            {moc.noteCount}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {(() => {
                  const untiered = mocs.filter((m) => m.tier === null);
                  if (untiered.length === 0) return null;
                  return (
                    <div key="untiered">
                      <p
                        className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        UNTIERED
                      </p>
                      {untiered.map((moc) => (
                        <button
                          key={moc.id}
                          type="button"
                          onClick={() => setSelectedNode(moc.id)}
                          className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                        >
                          <svg
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: "var(--bai-accent)", opacity: 0.6 }}
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
                            style={{ color: "var(--bai-text-secondary)" }}
                          >
                            {moc.title}
                          </span>
                          <span
                            className="ml-auto text-[10px]"
                            style={{ color: "var(--bai-text-faint)" }}
                          >
                            {moc.noteCount}
                          </span>
                        </button>
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
            {observations.length > 0 && (
              <div>
                <p
                  className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  Observations ({observations.length})
                </p>
                {observations.map((obs) => (
                  <button
                    key={obs.id}
                    type="button"
                    onClick={() => setSelectedNode(obs.id)}
                    className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                    <span
                      className="sidebar-note-title truncate text-xs"
                      style={{ color: "var(--bai-text-secondary)" }}
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
            {tensions.length > 0 && (
              <div>
                <p
                  className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  Tensions ({tensions.length})
                </p>
                {tensions.map((ten) => (
                  <button
                    key={ten.id}
                    type="button"
                    onClick={() => setSelectedNode(ten.id)}
                    className="sidebar-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span
                      className="sidebar-note-title truncate text-xs"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {ten.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {observations.length === 0 && tensions.length === 0 && (
              <p
                className="px-2 py-4 text-center text-xs"
                style={{ color: "var(--bai-text-faint)" }}
              >
                No pending signals
              </p>
            )}
          </div>
        )}

        {section === "folders" && <FolderTreeView nodes={allNodes ?? []} />}
      </div>

      <style>{`
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

function FolderTreeView({ nodes }: { nodes: Node[] }) {
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
    return build(null);
  }, [nodes]);

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TreeItem key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}

function TreeItem({
  node,
  depth,
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
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = node.kind === "folder";
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          isFolder ? setExpanded(!expanded) : setSelectedNode(node.id)
        }
        className="sidebar-row group flex w-full items-center gap-1 rounded px-1 py-1 text-left"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isFolder ? (
          <svg
            className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
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
            color: isFolder
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
        expanded &&
        node.children.map((child) => (
          <TreeItem key={child.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}
