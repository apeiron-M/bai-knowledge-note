import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  setSelectedNode,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { deleteDocumentRemote } from "../lib/remote-reactor.js";
import { prefetchOnHover } from "../lib/prefetch.js";
import { triggerVaultPull } from "../hooks/use-remote-first.js";
import { filterSources } from "../lib/source-search.js";

type DeleteTarget = { id: string; title: string } | null;

function DeleteModal({
  target,
  driveId,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget;
  driveId: string | undefined;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  if (!target) return null;

  async function handleDelete() {
    if (!driveId || !target) return;
    setDeleting(true);
    try {
      // Server-side delete removes the document AND its drive node in
      // one call; the scoped sync channel delivers the tree change.
      await deleteDocumentRemote(target.id, driveId);
      triggerVaultPull();
      onDeleted();
    } finally {
      setDeleting(false);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 w-[400px] rounded-2xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <svg
              className="h-5 w-5 text-red-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--bai-text)" }}
            >
              Delete Source
            </h3>
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              Are you sure you want to delete{" "}
              <span
                className="font-medium"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {target.title}
              </span>
              ? This will remove the source and its history from the vault.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-400 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/30 disabled:opacity-40"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  INBOX: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  EXTRACTING: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  EXTRACTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export function SourceList() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" focuses the filter from anywhere in the list, like GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Work queues start open (small, actionable); the ever-growing terminal
  // groups start collapsed to a one-line header with the count.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    INBOX: true,
    EXTRACTING: true,
    EXTRACTED: false,
    ARCHIVED: false,
  });
  const toggleGroup = useCallback(
    (status: string) =>
      setOpenGroups((prev) => ({ ...prev, [status]: !prev[status] })),
    [],
  );
  const driveId = useSelectedDriveId();
  // Source ids come from the authoritative server tree; the doc states
  // come from the reactor directly. Polls because agents move sources
  // through the extraction lifecycle server-side.
  const { serverFileNodes, isLoading: treeLoading } = useKnowledgeNotes();
  const sourceSpecs = useMemo<ReactorDocSpec[]>(
    () =>
      serverFileNodes
        .filter((n) => n.documentType === "bai/source")
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [serverFileNodes],
  );
  const {
    docs: documents,
    isLoading: docsLoading,
    refetch,
  } = useReactorDocsWithRefetch(sourceSpecs, {
    pollMs: 20_000,
    // Switching tabs unmounts this view. `retainKey` lets the hook paint
    // the source documents it already holds while the drive tree reloads,
    // so coming back shows the list immediately and refreshes behind it.
    retainKey: "source-list",
  });
  // The tab badge counts tree nodes (instant); the list needs the doc
  // states (async). Show a loading panel instead of a false "empty" —
  // but only when we have NOTHING to show: under stale-while-revalidate
  // `docsLoading` stays true while a partially cached list is already on
  // screen, and a spinner over real content would be a regression.
  const isLoading = (treeLoading && sourceSpecs.length === 0) || docsLoading;

  const sources = useMemo(() => {
    return documents
      .filter((d) => d.header.documentType === "bai/source")
      .map((d) => {
        const state = (
          d.state as unknown as { global: Record<string, unknown> }
        ).global;
        return {
          id: d.header.id,
          name: d.header.name,
          title: (state.title as string) ?? d.header.name,
          description: (state.description as string) ?? null,
          author: (state.author as string) ?? null,
          url: (state.url as string) ?? null,
          sourceType: (state.sourceType as string) ?? null,
          status: (state.status as string) ?? "INBOX",
          claimCount: ((state.extractedClaims as string[]) ?? []).length,
          createdBy: (state.createdBy as string) ?? null,
        };
      });
  }, [documents]);

  // The filter narrows what the groups show; an active query also opens
  // every group, because a match hidden behind a collapsed header is a
  // search that looks broken.
  const searching = query.trim().length > 0;
  const visible = useMemo(() => filterSources(sources, query), [sources, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof sources> = {
      INBOX: [],
      EXTRACTING: [],
      EXTRACTED: [],
      ARCHIVED: [],
    };
    for (const s of visible) {
      const bucket = groups[s.status] ?? groups.INBOX;
      bucket.push(s);
    }
    return groups;
  }, [visible]);

  return (
    <div className="p-4 space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Sources ({sources.length})
        </h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Ingest Source
        </button>
      </div>

      {/* Filter */}
      {sources.length > 0 && (
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--bai-text-faint)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Filter sources by title, author, URL, type…  ( / )"
            aria-label="Filter sources"
            className="w-full rounded-lg py-2 pl-9 pr-20 text-sm outline-none placeholder:opacity-50 focus:border-[#cba6f7]/50"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text)",
              border: "1px solid var(--bai-border)",
            }}
          />
          {searching && (
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
              <span
                className="text-[10px]"
                style={{ color: "var(--bai-text-faint)" }}
              >
                {visible.length} of {sources.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="rounded p-0.5 text-xs hover:bg-white/10"
                style={{ color: "var(--bai-text-muted)" }}
                aria-label="Clear filter"
                title="Clear (Esc)"
              >
                &times;
              </button>
            </div>
          )}
        </div>
      )}

      {isLoading && sources.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-xl"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--bai-text-muted)" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              Loading sources…
            </p>
          </div>
        </div>
      ) : sources.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-xl"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <div className="text-center">
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              No sources yet
            </p>
            <p
              className="mt-1 text-xs"
              style={{ color: "var(--bai-text-faint)" }}
            >
              Ingest source material to start the extraction pipeline
            </p>
          </div>
        </div>
      ) : searching && visible.length === 0 ? (
        <div
          className="flex h-32 items-center justify-center rounded-xl"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
            No sources match “{query.trim()}”
          </p>
        </div>
      ) : (
        <>
          {(["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"] as const).map(
            (status) => {
              const items = grouped[status];
              if (items.length === 0) return null;
              const isOpen = searching || (openGroups[status] ?? false);
              return (
                <div key={status}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(status)}
                    aria-expanded={isOpen}
                    className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-white/5"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    <svg
                      className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status]?.split(" ")[0]}`}
                    />
                    {status.replace("_", " ")} ({items.length})
                  </button>
                  {isOpen && (
                  <div className="space-y-1">
                    {items.map((source) => (
                      <div
                        key={source.id}
                        className="group flex items-center gap-3 rounded-lg px-4 py-3"
                        style={{
                          backgroundColor: "var(--bai-bg)",
                          border: "1px solid var(--bai-border)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedNode(source.id)}
                          {...prefetchOnHover(source.id)}
                          className="flex flex-1 items-center gap-3 text-left min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: "var(--bai-text-secondary)" }}
                            >
                              {source.title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {source.sourceType && (
                                <span
                                  className="rounded px-1.5 py-0.5 text-[10px]"
                                  style={{
                                    backgroundColor: "var(--bai-hover)",
                                    color: "var(--bai-text-muted)",
                                  }}
                                >
                                  {source.sourceType}
                                </span>
                              )}
                              {source.createdBy && (
                                <span
                                  className="text-[10px]"
                                  style={{ color: "var(--bai-text-faint)" }}
                                >
                                  by {source.createdBy}
                                </span>
                              )}
                            </div>
                          </div>
                          {source.claimCount > 0 && (
                            <span
                              className="text-[10px]"
                              style={{ color: "var(--bai-text-faint)" }}
                            >
                              {source.claimCount} claims
                            </span>
                          )}
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[source.status]}`}
                          >
                            {source.status}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              id: source.id,
                              title: source.title,
                            });
                          }}
                          className="shrink-0 rounded p-1.5 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                          style={{ color: "var(--bai-text-faint)" }}
                          title="Delete source"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              );
            },
          )}
        </>
      )}

      <CreateDocumentDialog
        open={createOpen}
        documentType="bai/source"
        documentTypeLabel="Source"
        onClose={() => setCreateOpen(false)}
      />
      <DeleteModal
        target={deleteTarget}
        driveId={driveId}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refetch}
      />
    </div>
  );
}
