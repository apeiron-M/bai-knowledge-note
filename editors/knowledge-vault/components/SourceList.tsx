import { useState, useMemo, useCallback } from "react";
import {
  setSelectedNode,
  useSelectedDriveId,
  deleteNode,
} from "@powerhousedao/reactor-browser";
import { useDocumentsSafe } from "../hooks/use-documents-safe.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";

type DeleteTarget = { id: string; title: string } | null;

function DeleteModal({
  target,
  driveId,
  onClose,
}: {
  target: DeleteTarget;
  driveId: string | undefined;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  if (!target) return null;

  async function handleDelete() {
    if (!driveId || !target) return;
    setDeleting(true);
    try {
      await deleteNode(driveId, target.id);
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
  const documents = useDocumentsSafe();
  const driveId = useSelectedDriveId();

  const sources = useMemo(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/source")
      .map((d) => {
        const state = (
          d.state as unknown as { global: Record<string, unknown> }
        ).global;
        return {
          id: d.header.id,
          name: d.header.name,
          title: (state.title as string) ?? d.header.name,
          sourceType: (state.sourceType as string) ?? null,
          status: (state.status as string) ?? "INBOX",
          claimCount: ((state.extractedClaims as string[]) ?? []).length,
          createdBy: (state.createdBy as string) ?? null,
        };
      });
  }, [documents]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof sources> = {
      INBOX: [],
      EXTRACTING: [],
      EXTRACTED: [],
      ARCHIVED: [],
    };
    for (const s of sources) {
      const bucket = groups[s.status] ?? groups.INBOX;
      bucket.push(s);
    }
    return groups;
  }, [sources]);

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

      {sources.length === 0 ? (
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
      ) : (
        <>
          {(["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"] as const).map(
            (status) => {
              const items = grouped[status];
              if (items.length === 0) return null;
              return (
                <div key={status}>
                  <h3
                    className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status]?.split(" ")[0]}`}
                    />
                    {status.replace("_", " ")} ({items.length})
                  </h3>
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
      />
    </div>
  );
}
