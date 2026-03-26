import { useState, useMemo, useRef, useEffect } from "react";
import { generateId } from "document-model/core";
import { useKnowledgeNoteDocumentsInSelectedDrive } from "knowledge-note/document-models/knowledge-note";
import type { NoteLink, LinkType } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type LinksSectionProps = {
  links: NoteLink[];
  currentDocId: string;
  onAddLink: (id: string, targetDocumentId: string, targetTitle: string, linkType: LinkType) => void;
  onRemoveLink: (id: string) => void;
  onUpdateLinkType: (id: string, linkType: LinkType) => void;
};

const LINK_TYPES: LinkType[] = ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM"];
const LINK_TYPE_LABELS: Record<LinkType, string> = {
  RELATES_TO: "Relates to", BUILDS_ON: "Builds on", CONTRADICTS: "Contradicts",
  SUPERSEDES: "Supersedes", DERIVED_FROM: "Derived from",
};
const LINK_TYPE_COLORS: Record<LinkType, string> = {
  RELATES_TO: "bg-slate-500/20 text-slate-300", BUILDS_ON: "bg-sky-500/20 text-sky-300",
  CONTRADICTS: "bg-red-500/20 text-red-300", SUPERSEDES: "bg-purple-500/20 text-purple-300",
  DERIVED_FROM: "bg-amber-500/20 text-amber-300",
};

type DocOption = { id: string; title: string };

export function LinksSection({ links, currentDocId, onAddLink, onRemoveLink, onUpdateLinkType }: LinksSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  const allDocs = useKnowledgeNoteDocumentsInSelectedDrive();

  const docOptions: DocOption[] = useMemo(() => {
    const linkedIds = new Set(links.map((l) => l.targetDocumentId));
    return (allDocs ?? [])
      .filter((d) => d.header.id !== currentDocId && !linkedIds.has(d.header.id))
      .map((d) => ({
        id: d.header.id,
        title: d.state.global.title ?? d.header.name ?? d.header.id,
      }));
  }, [allDocs, currentDocId, links]);

  const allDocOptions: DocOption[] = useMemo(() => {
    return (allDocs ?? [])
      .filter((d) => d.header.id !== currentDocId)
      .map((d) => ({
        id: d.header.id,
        title: d.state.global.title ?? d.header.name ?? d.header.id,
      }));
  }, [allDocs, currentDocId]);

  function handleAdd(targetId: string, targetTitle: string, linkType: LinkType) {
    onAddLink(generateId(), targetId, targetTitle, linkType);
    setIsAdding(false);
  }

  if (links.length === 0 && !isAdding) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-4 text-center">
        <p className="mb-2 text-sm text-gray-500">No linked notes yet</p>
        <button type="button" onClick={() => setIsAdding(true)}
          className="text-sm font-medium text-[#cba6f7] hover:text-[#cba6f7]/80">+ Add link</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          isEditing={editingLinkId === link.id}
          allDocOptions={allDocOptions}
          onStartEdit={() => setEditingLinkId(link.id)}
          onCancelEdit={() => setEditingLinkId(null)}
          onUpdateLinkType={onUpdateLinkType}
          onRemoveLink={onRemoveLink}
          onChangeTarget={(targetId, targetTitle) => {
            // Remove old link and add new one with updated target
            onRemoveLink(link.id);
            onAddLink(generateId(), targetId, targetTitle, link.linkType ?? "RELATES_TO");
            setEditingLinkId(null);
          }}
        />
      ))}

      {isAdding ? (
        <AddLinkForm
          docOptions={docOptions}
          onAdd={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setIsAdding(true)}
          className="w-full rounded-lg border border-dashed border-white/10 py-1.5 text-xs text-gray-500 hover:border-[#cba6f7]/30 hover:text-[#cba6f7]">
          + Add link
        </button>
      )}
    </div>
  );
}

function LinkCard({
  link,
  isEditing,
  allDocOptions,
  onStartEdit,
  onCancelEdit,
  onUpdateLinkType,
  onRemoveLink,
  onChangeTarget,
}: {
  link: NoteLink;
  isEditing: boolean;
  allDocOptions: DocOption[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdateLinkType: (id: string, linkType: LinkType) => void;
  onRemoveLink: (id: string) => void;
  onChangeTarget: (targetId: string, targetTitle: string) => void;
}) {
  if (isEditing) {
    return (
      <div className="rounded-lg border border-[#cba6f7]/20 bg-[#cba6f7]/5 p-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase text-gray-500">Change target document</p>
        <DocumentSearch
          options={allDocOptions}
          onSelect={(doc) => onChangeTarget(doc.id, doc.title)}
          onCancel={onCancelEdit}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-white/5 bg-[#1e1e2e] px-3 py-2">
      <select value={link.linkType ?? "RELATES_TO"}
        onChange={(e) => onUpdateLinkType(link.id, e.target.value as LinkType)}
        className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${LINK_TYPE_COLORS[link.linkType ?? "RELATES_TO"]} bg-transparent`}>
        {LINK_TYPES.map((lt) => (<option key={lt} value={lt}>{LINK_TYPE_LABELS[lt]}</option>))}
      </select>
      <button type="button" onClick={onStartEdit}
        className="flex-1 truncate text-left text-sm text-gray-300 hover:text-[#cba6f7]"
        title="Click to change target document">
        {link.targetTitle || link.targetDocumentId || "Untitled"}
      </button>
      {link.targetDocumentId && (
        <span className="hidden text-[10px] font-mono text-gray-600 group-hover:inline" title={link.targetDocumentId}>
          {link.targetDocumentId.slice(0, 8)}
        </span>
      )}
      <button type="button" onClick={() => onRemoveLink(link.id)}
        className="text-gray-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        aria-label="Remove link">&times;</button>
    </div>
  );
}

function AddLinkForm({
  docOptions,
  onAdd,
  onCancel,
}: {
  docOptions: DocOption[];
  onAdd: (targetId: string, targetTitle: string, linkType: LinkType) => void;
  onCancel: () => void;
}) {
  const [selectedDoc, setSelectedDoc] = useState<DocOption | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualId, setManualId] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("RELATES_TO");
  const [mode, setMode] = useState<"search" | "manual">("search");

  function handleSubmit() {
    if (mode === "search" && selectedDoc) {
      onAdd(selectedDoc.id, selectedDoc.title, linkType);
    } else if (mode === "manual" && manualTitle.trim()) {
      onAdd(manualId.trim(), manualTitle.trim(), linkType);
    }
  }

  const hasValue = mode === "search" ? !!selectedDoc : !!manualTitle.trim();

  return (
    <div className="space-y-2 rounded-lg border border-[#cba6f7]/20 bg-[#cba6f7]/5 p-3">
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button type="button" onClick={() => setMode("search")}
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${mode === "search" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500"}`}>
          Search drive
        </button>
        <button type="button" onClick={() => setMode("manual")}
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${mode === "manual" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500"}`}>
          Manual entry
        </button>
      </div>

      {mode === "search" ? (
        <div>
          {selectedDoc ? (
            <div className="flex items-center gap-2 rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5">
              <span className="flex-1 truncate text-sm text-gray-300">{selectedDoc.title}</span>
              <span className="text-[10px] font-mono text-gray-600">{selectedDoc.id.slice(0, 8)}</span>
              <button type="button" onClick={() => setSelectedDoc(null)}
                className="text-gray-500 hover:text-red-400">&times;</button>
            </div>
          ) : (
            <DocumentSearch
              options={docOptions}
              onSelect={setSelectedDoc}
              onCancel={onCancel}
              autoFocus
            />
          )}
        </div>
      ) : (
        <>
          <input type="text" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Link title..." autoFocus
            className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
          <input type="text" value={manualId} onChange={(e) => setManualId(e.target.value)}
            placeholder="Document PHID (optional)"
            className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm font-mono text-gray-400 outline-none focus:border-[#cba6f7]/50" />
        </>
      )}

      <div className="flex items-center gap-2">
        <select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}
          className="rounded border border-white/10 bg-[#1e1e2e] px-2 py-1.5 text-sm text-gray-300">
          {LINK_TYPES.map((lt) => (<option key={lt} value={lt}>{LINK_TYPE_LABELS[lt]}</option>))}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-gray-500 hover:bg-white/5">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={!hasValue}
          className="rounded bg-[#cba6f7] px-3 py-1 text-xs font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

function DocumentSearch({
  options,
  onSelect,
  onCancel,
  autoFocus,
}: {
  options: DocOption[];
  onSelect: (doc: DocOption) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 20);
    const q = query.toLowerCase();
    return options.filter(
      (d) => d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [options, query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        placeholder="Search notes by title..."
        className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50"
      />

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#181825] shadow-xl">
          {filtered.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => { onSelect(doc); setIsOpen(false); setQuery(""); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#313244]"
            >
              <span className="flex-1 truncate text-sm text-gray-300">{doc.title}</span>
              <span className="shrink-0 text-[10px] font-mono text-gray-600">{doc.id.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-[#181825] px-3 py-2 shadow-xl">
          <p className="text-xs text-gray-500">No matching notes found</p>
        </div>
      )}
    </div>
  );
}
