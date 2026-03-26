import { useState, useMemo } from "react";
import {
  setSelectedNode,
  showCreateDocumentModal,
  useDocumentsInSelectedDrive,
  useNodesInSelectedDrive,
  useSelectedDriveId,
  addDocument,
} from "@powerhousedao/reactor-browser";
import type { Node } from "document-drive";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";

type VaultSidebarProps = {
  notes: KnowledgeNoteInfo[];
};

const STATUS_ORDER = ["CANONICAL", "IN_REVIEW", "DRAFT", "ARCHIVED"] as const;
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-amber-400", IN_REVIEW: "bg-blue-400", CANONICAL: "bg-emerald-400", ARCHIVED: "bg-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Drafts", IN_REVIEW: "In Review", CANONICAL: "Canonical", ARCHIVED: "Archived",
};

type SidebarSection = "notes" | "mocs" | "signals" | "folders";

export function VaultSidebar({ notes }: VaultSidebarProps) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<SidebarSection>("notes");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ ARCHIVED: true });
  const documents = useDocumentsInSelectedDrive();
  const allNodes = useNodesInSelectedDrive();

  // MOCs
  const mocs = useMemo(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/moc")
      .map((d) => ({
        id: d.header.id,
        name: d.header.name,
        title: ((d.state as unknown as { global: Record<string, unknown> }).global.title as string) ?? d.header.name,
        tier: ((d.state as unknown as { global: Record<string, unknown> }).global.tier as string) ?? null,
        noteCount: ((d.state as unknown as { global: Record<string, unknown> }).global.noteCount as number) ?? 0,
      }));
  }, [documents]);

  // Observations + Tensions
  const observations = useMemo(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/observation")
      .map((d) => ({
        id: d.header.id,
        title: ((d.state as unknown as { global: Record<string, unknown> }).global.title as string) ?? d.header.name,
        category: ((d.state as unknown as { global: Record<string, unknown> }).global.category as string) ?? null,
        status: ((d.state as unknown as { global: Record<string, unknown> }).global.status as string) ?? "PENDING",
      }))
      .filter((o) => o.status === "PENDING");
  }, [documents]);

  const tensions = useMemo(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/tension")
      .map((d) => ({
        id: d.header.id,
        title: ((d.state as unknown as { global: Record<string, unknown> }).global.title as string) ?? d.header.name,
        status: ((d.state as unknown as { global: Record<string, unknown> }).global.status as string) ?? "OPEN",
      }))
      .filter((t) => t.status === "OPEN");
  }, [documents]);

  const filtered = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(
      (n) => (n.title ?? n.name).toLowerCase().includes(q) ||
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

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-[#11111b]">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-[#cba6f7]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
          </svg>
          <button type="button" onClick={() => setSelectedNode(undefined)}
            className="flex-1 text-left text-sm font-semibold text-gray-200 transition-colors hover:text-[#cba6f7]"
            title="Back to vault overview">
            Knowledge Vault
          </button>
          <QuickCreateButton />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..." className="w-full rounded-md border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-xs text-gray-300 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50" />
      </div>

      {/* Section tabs */}
      <div className="flex gap-px px-3 pb-1">
        {([["notes", "Notes"], ["mocs", "MOCs"], ["signals", "Signals"], ["folders", "Tree"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSection(key)}
            className={`flex-1 rounded-md py-1 text-[10px] font-medium transition-colors ${
              section === key ? "bg-[#313244] text-[#cba6f7]" : "text-gray-600 hover:text-gray-400"
            }`}>
            {label}
            {key === "signals" && (observations.length + tensions.length > 0) && (
              <span className="ml-1 text-amber-400">{observations.length + tensions.length}</span>
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
                  <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [status]: !isCollapsed }))}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-500 hover:bg-white/5">
                    <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
                    <span className="flex-1 text-left font-medium">{STATUS_LABELS[status]}</span>
                    <span className="text-gray-600">{groupNotes.length}</span>
                    <svg className={`h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                  {!isCollapsed && (
                    <div className="ml-1 space-y-px">
                      {groupNotes.map((note) => (
                        <button key={note.id} type="button" onClick={() => setSelectedNode(note.id)}
                          className="group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5">
                          <span className="truncate text-xs font-medium text-gray-300 group-hover:text-[#cba6f7]">
                            {note.title ?? note.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {note.noteType && <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-gray-400">{note.noteType}</span>}
                            {note.topics.slice(0, 2).map((t) => (<span key={t.id} className="text-[10px] text-[#cba6f7]/60">#{t.name}</span>))}
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
              <p className="px-2 py-4 text-center text-xs text-gray-600">No MOCs yet</p>
            ) : (
              <>
                {(["HUB", "DOMAIN", "TOPIC"] as const).map((tier) => {
                  const tierMocs = mocs.filter((m) => m.tier === tier);
                  if (tierMocs.length === 0) return null;
                  return (
                    <div key={tier}>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{tier}</p>
                      {tierMocs.map((moc) => (
                        <button key={moc.id} type="button" onClick={() => setSelectedNode(moc.id)}
                          className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5">
                          <svg className="h-3.5 w-3.5 shrink-0 text-[#cba6f7]/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                          </svg>
                          <span className="truncate text-xs text-gray-300 group-hover:text-[#cba6f7]">{moc.title}</span>
                          <span className="ml-auto text-[10px] text-gray-600">{moc.noteCount}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {section === "signals" && (
          <div className="space-y-3">
            {observations.length > 0 && (
              <div>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  Observations ({observations.length})
                </p>
                {observations.map((obs) => (
                  <button key={obs.id} type="button" onClick={() => setSelectedNode(obs.id)}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                    <span className="truncate text-xs text-gray-300 group-hover:text-[#cba6f7]">{obs.title}</span>
                    {obs.category && <span className="rounded bg-[#313244] px-1 py-0.5 text-[10px] text-gray-500">{obs.category}</span>}
                  </button>
                ))}
              </div>
            )}
            {tensions.length > 0 && (
              <div>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  Tensions ({tensions.length})
                </p>
                {tensions.map((ten) => (
                  <button key={ten.id} type="button" onClick={() => setSelectedNode(ten.id)}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span className="truncate text-xs text-gray-300 group-hover:text-[#cba6f7]">{ten.title}</span>
                  </button>
                ))}
              </div>
            )}
            {observations.length === 0 && tensions.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-gray-600">No pending signals</p>
            )}
          </div>
        )}

        {section === "folders" && (
          <FolderTreeView nodes={allNodes ?? []} />
        )}
      </div>
    </div>
  );
}

function FolderTreeView({ nodes }: { nodes: Node[] }) {
  type TreeNode = { id: string; name: string; kind: string; children: TreeNode[]; docType?: string };

  const tree = useMemo(() => {
    function build(parentId: string | null): TreeNode[] {
      return nodes
        .filter((n) => (parentId == null ? n.parentFolder == null : n.parentFolder === parentId))
        .map((node): TreeNode => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          docType: node.kind === "file" ? (node as Node & { kind: "file"; documentType: string }).documentType : undefined,
          children: node.kind === "folder" ? build(node.id) : [],
        }))
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

function TreeItem({ node, depth }: { node: { id: string; name: string; kind: string; children: { id: string; name: string; kind: string; children: any[]; docType?: string }[]; docType?: string }; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isFolder = node.kind === "folder";
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button type="button"
        onClick={() => isFolder ? setExpanded(!expanded) : setSelectedNode(node.id)}
        className="group flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-white/5"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isFolder ? (
          <svg className={`h-3 w-3 shrink-0 text-gray-600 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        ) : (
          <span className="h-3 w-3" />
        )}
        {isFolder ? (
          <svg className="h-3.5 w-3.5 shrink-0 text-amber-400/70" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 shrink-0 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
          </svg>
        )}
        <span className={`truncate text-[11px] ${isFolder ? "font-medium text-gray-300" : "text-gray-400 group-hover:text-[#cba6f7]"}`}>
          {node.name}
        </span>
        {isFolder && hasChildren && (
          <span className="ml-auto text-[9px] text-gray-700">{node.children.length}</span>
        )}
      </button>
      {isFolder && expanded && node.children.map((child) => (
        <TreeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function QuickCreateButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setDialogOpen(true)}
        className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-[#cba6f7]" title="New note">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <CreateDocumentDialog
        open={dialogOpen}
        documentType="bai/knowledge-note"
        documentTypeLabel="Knowledge Note"
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
