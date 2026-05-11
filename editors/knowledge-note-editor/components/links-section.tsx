import { useState, useMemo, useRef, useEffect } from "react";
import { generateId } from "document-model/core";
import {
  setSelectedNode,
  useDocumentsInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import type {
  NoteLink,
  LinkType,
} from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type LinksSectionProps = {
  links: NoteLink[];
  currentDocId: string;
  onAddLink: (
    id: string,
    targetDocumentId: string,
    targetTitle: string,
    linkType: LinkType,
  ) => void;
  onRemoveLink: (id: string) => void;
  onUpdateLinkType: (id: string, linkType: LinkType) => void;
};

const LINK_TYPES: LinkType[] = [
  "RELATES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "SUPERSEDES",
  "DERIVED_FROM",
];
const LINK_TYPE_LABELS: Record<LinkType, string> = {
  RELATES_TO: "Relates to",
  BUILDS_ON: "Builds on",
  CONTRADICTS: "Contradicts",
  SUPERSEDES: "Supersedes",
  DERIVED_FROM: "Derived from",
};
const LINK_TYPE_COLORS: Record<LinkType, string> = {
  RELATES_TO: "bg-slate-500/20 text-slate-300",
  BUILDS_ON: "bg-sky-500/20 text-sky-300",
  CONTRADICTS: "bg-red-500/20 text-red-300",
  SUPERSEDES: "bg-purple-500/20 text-purple-300",
  DERIVED_FROM: "bg-amber-500/20 text-amber-300",
};

type DocOption = { id: string; title: string };

export function LinksSection({
  links,
  currentDocId,
  onAddLink,
  onRemoveLink,
  onUpdateLinkType,
}: LinksSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  // reactor-browser dev.239+ — useDocumentsInSelectedDrive is now
  // tolerant of per-doc fetch failures (orphan ids no longer reject
  // the whole promise). Filter to knowledge-notes client-side.
  const allDriveDocs = useDocumentsInSelectedDrive();
  const allDocs = useMemo(
    () =>
      (allDriveDocs ?? []).filter(
        (d) => d.header.documentType === "bai/knowledge-note",
      ),
    [allDriveDocs],
  );

  const docOptions: DocOption[] = useMemo(() => {
    const linkedIds = new Set(links.map((l) => l.targetDocumentId));
    return allDocs
      .filter(
        (d) => d.header.id !== currentDocId && !linkedIds.has(d.header.id),
      )
      .map((d) => ({
        id: d.header.id,
        title:
          (d.state as unknown as { global?: { title?: string } }).global
            ?.title ??
          d.header.name ??
          d.header.id,
      }));
  }, [allDocs, currentDocId, links]);

  const allDocOptions: DocOption[] = useMemo(() => {
    return allDocs
      .filter((d) => d.header.id !== currentDocId)
      .map((d) => ({
        id: d.header.id,
        title:
          (d.state as unknown as { global?: { title?: string } }).global
            ?.title ??
          d.header.name ??
          d.header.id,
      }));
  }, [allDocs, currentDocId]);

  function handleAdd(
    targetId: string,
    targetTitle: string,
    linkType: LinkType,
  ) {
    onAddLink(generateId(), targetId, targetTitle, linkType);
    setIsAdding(false);
  }

  if (links.length === 0 && !isAdding) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-4 text-center">
        <p className="mb-2 text-sm text-gray-500">No linked notes yet</p>
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="text-sm font-medium text-[#cba6f7] hover:text-[#cba6f7]/80"
        >
          + Add link
        </button>
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
            onAddLink(
              generateId(),
              targetId,
              targetTitle,
              link.linkType ?? "RELATES_TO",
            );
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
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="w-full rounded-lg border border-dashed border-white/10 py-1.5 text-xs text-gray-500 hover:border-[#cba6f7]/30 hover:text-[#cba6f7]"
        >
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
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    function handleClickOutside(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        onCancelEdit();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, onCancelEdit]);

  if (isEditing) {
    return (
      <div
        ref={editRef}
        className="rounded-lg border border-[#cba6f7]/20 bg-[#cba6f7]/5 p-2"
      >
        <p className="mb-1.5 text-[10px] font-medium uppercase text-gray-500">
          Change target document
        </p>
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
      <select
        value={link.linkType ?? "RELATES_TO"}
        onChange={(e) => onUpdateLinkType(link.id, e.target.value as LinkType)}
        className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${LINK_TYPE_COLORS[link.linkType ?? "RELATES_TO"]} bg-transparent`}
      >
        {LINK_TYPES.map((lt) => (
          <option key={lt} value={lt}>
            {LINK_TYPE_LABELS[lt]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (link.targetDocumentId) setSelectedNode(link.targetDocumentId);
        }}
        className="flex-1 truncate text-left text-sm text-gray-300 hover:text-[#cba6f7] hover:underline"
        title={`Open: ${link.targetTitle || link.targetDocumentId || "Untitled"}`}
      >
        {link.targetTitle || link.targetDocumentId || "Untitled"}
        <svg
          className="ml-1 inline-block h-3 w-3 opacity-0 group-hover:opacity-50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onStartEdit}
        className="text-gray-600 opacity-0 transition-opacity hover:text-[#cba6f7] group-hover:opacity-100"
        aria-label="Change target"
        title="Change target document"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onRemoveLink(link.id)}
        className="text-gray-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        aria-label="Remove link"
      >
        &times;
      </button>
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
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${mode === "search" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500"}`}
        >
          Search drive
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`rounded px-2 py-0.5 text-[10px] font-medium ${mode === "manual" ? "bg-[#313244] text-[#cba6f7]" : "text-gray-500"}`}
        >
          Manual entry
        </button>
      </div>

      {mode === "search" ? (
        <div>
          {selectedDoc ? (
            <div className="flex items-center gap-2 rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5">
              <span className="flex-1 truncate text-sm text-gray-300">
                {selectedDoc.title}
              </span>
              <span className="text-[10px] font-mono text-gray-600">
                {selectedDoc.id.slice(0, 8)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                className="text-gray-500 hover:text-red-400"
              >
                &times;
              </button>
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
          <input
            type="text"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Link title..."
            autoFocus
            className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50"
          />
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Document PHID (optional)"
            className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm font-mono text-gray-400 outline-none focus:border-[#cba6f7]/50"
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <select
          value={linkType}
          onChange={(e) => setLinkType(e.target.value as LinkType)}
          className="rounded border border-white/10 bg-[#1e1e2e] px-2 py-1.5 text-sm text-gray-300"
        >
          {LINK_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {LINK_TYPE_LABELS[lt]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-gray-500 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasValue}
          className="rounded bg-[#cba6f7] px-3 py-1 text-xs font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80 disabled:opacity-40"
        >
          Add
        </button>
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
    return options
      .filter(
        (d) =>
          d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [options, query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Search notes by title..."
        className="w-full rounded border border-white/10 bg-[#1e1e2e] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50"
      />

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#181825] shadow-xl">
          {filtered.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => {
                onSelect(doc);
                setIsOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#313244]"
            >
              <span className="flex-1 truncate text-sm text-gray-300">
                {doc.title}
              </span>
              <span className="shrink-0 text-[10px] font-mono text-gray-600">
                {doc.id.slice(0, 8)}
              </span>
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
