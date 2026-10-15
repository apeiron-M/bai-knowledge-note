import { memo, useMemo, useState } from "react";
import { LoadingPanel } from "./LoadingStates.js";
import { setSelectedNode, useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { createDocumentRemote, deleteDocumentRemote } from "../lib/remote-reactor.js";
import { writeErrorText } from "../../shared/use-doc-write.js";
import { TrashIcon, TypeToConfirmDialog } from "./TypeToConfirmDialog.js";
import { triggerVaultPull } from "../hooks/use-remote-first.js";
import { useFolderMap } from "../hooks/use-drive-init.js";
import { formatLastModified } from "../lib/format-time.js";

/**
 * The Scope tab: every scope-of-work document in the drive. A SoW is the
 * stakeholder-facing plan — priced deliverables, budget envelopes, milestones,
 * roadmaps — and there can be one per team, programme or client. Clicking a
 * card opens its editor full-width: the SoW brings its own left rail, so the
 * vault sidebar steps aside (EDITORS_WITH_OWN_SIDEBAR in DriveExplorer).
 *
 * Each card can delete its scope of work — the whole document, so the person
 * types its title to confirm (TypeToConfirmDialog). The work breakdowns of its
 * projects are documents of their own and stay; the dialog says so.
 */

// A scope of work carries its own lifecycle, unrelated to ProjectStatus.
const SOW_STATUS_META: Record<string, { label: string; fg: string; bg: string }> =
  {
    DRAFT: { label: "Draft", fg: "rgba(252, 211, 77, 1)", bg: "rgba(245, 158, 11, 0.15)" },
    SUBMITTED: { label: "Submitted", fg: "rgba(147, 197, 253, 1)", bg: "rgba(59, 130, 246, 0.15)" },
    IN_PROGRESS: { label: "In progress", fg: "rgba(147, 197, 253, 1)", bg: "rgba(59, 130, 246, 0.15)" },
    APPROVED: { label: "Approved", fg: "rgba(110, 231, 183, 1)", bg: "rgba(52, 211, 153, 0.15)" },
    DELIVERED: { label: "Delivered", fg: "var(--bai-accent)", bg: "var(--bai-accent-soft)" },
    REJECTED: { label: "Rejected", fg: "rgb(248, 113, 113)", bg: "rgba(248, 113, 113, 0.15)" },
    CANCELED: { label: "Canceled", fg: "var(--bai-text-muted)", bg: "rgba(107, 114, 128, 0.15)" },
  };

type SowRow = {
  id: string;
  title: string;
  status: string;
  projects: number;
  deliverables: number;
  delivered: number;
  milestones: number;
  contributors: number;
  /** Projects linked to a work breakdown — breakdowns that stay when the scope goes. */
  breakdowns: number;
  lastModified: string;
};


const SowCard = memo(function SowCard({ sow, onDelete }: { sow: SowRow; onDelete: (sow: SowRow) => void }) {
  const meta = SOW_STATUS_META[sow.status] ?? {
    label: sow.status,
    fg: "var(--bai-text-muted)",
    bg: "rgba(107, 114, 128, 0.15)",
  };
  const pct =
    sow.deliverables > 0
      ? Math.round((sow.delivered / sow.deliverables) * 100)
      : 0;
  return (
    // Two buttons side by side, not one inside the other: opening and deleting are separate acts.
    <div className="group relative">
    <button
      type="button"
      onClick={() => setSelectedNode(sow.id)}
      className="w-full rounded-xl border border-[var(--bai-border)] bg-[var(--bai-surface)] py-3 pl-4 pr-12 text-left transition-colors hover:border-[var(--bai-accent)] hover:bg-[var(--bai-hover)]"
    >
      <div className="flex items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {sow.title}
        </p>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ color: meta.fg, backgroundColor: meta.bg }}
        >
          {meta.label}
        </span>
      </div>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
        style={{ color: "var(--bai-text-muted)" }}
      >
        <span>
          {sow.projects} {sow.projects === 1 ? "envelope" : "envelopes"}
        </span>
        <span>
          {sow.deliverables}{" "}
          {sow.deliverables === 1 ? "deliverable" : "deliverables"}
        </span>
        {sow.milestones > 0 && <span>{sow.milestones} milestones</span>}
        {sow.contributors > 0 && <span>{sow.contributors} contributors</span>}
        <span style={{ color: "var(--bai-text-faint)" }}>
          {formatLastModified(sow.lastModified)}
        </span>
      </div>
      {sow.deliverables > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bai-hover)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: "var(--bai-accent)",
              }}
            />
          </div>
          <span
            className="text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            {sow.delivered}/{sow.deliverables} delivered
          </span>
        </div>
      )}
    </button>
    <button
      type="button"
      onClick={() => onDelete(sow)}
      aria-label={`Delete scope of work “${sow.title}”`}
      title="Delete scope of work"
      className="absolute right-2 top-2.5 rounded-md p-1.5 opacity-60 transition-colors hover:bg-[var(--bai-danger-soft)] hover:text-[var(--bai-danger)] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-danger)] group-hover:opacity-100"
      style={{ color: "var(--bai-text-muted)" }}
    >
      <TrashIcon />
    </button>
    </div>
  );
});

/** What goes with a scope of work, and what stays — the dialog's body. */
function DeleteScopeBody({ sow }: { sow: SowRow }) {
  return (
    <>
      <p>
        This deletes the whole scope of work — its envelopes, deliverables,
        milestones and contributors. It cannot be undone.
      </p>
      {sow.breakdowns > 0 && (
        <p style={{ color: "var(--bai-text-muted)" }}>
          {sow.breakdowns === 1
            ? "Its project's work breakdown stays, as a document of its own."
            : `The work breakdowns of its ${sow.breakdowns} projects stay, as documents of their own.`}
        </p>
      )}
    </>
  );
}


function NewScopeDialog({
  open,
  driveId,
  projectsFolderId,
  onClose,
}: {
  open: boolean;
  driveId: string | undefined;
  projectsFolderId: string | undefined;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  if (!open) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveId || !name.trim() || loading) return;
    setLoading(true);
    try {
      // Same folder and remote-first discipline as projects and WBS: the
      // document must exist on the server before anything links to it.
      const newId = await createDocumentRemote({
        documentType: "powerhouse/scopeofwork",
        name: name.trim(),
        driveId,
        parentFolderId: projectsFolderId,
        targetFolderPath: "projects",
      });
      triggerVaultPull();
      onClose();
      setSelectedNode(newId);
    } catch (err) {
      console.error("[ScopeOfWorkView] Failed to create scope of work:", err);
      setLoading(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl p-4"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--bai-text)" }}>
          New scope of work
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--bai-text-muted)" }}>
          One per team, programme or client. Envelopes, deliverables and
          milestones are added inside the editor.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Paperless × Powerhouse — client demo"
          className="mt-3 w-full rounded-md px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: "var(--bai-deep)",
            border: "1px solid var(--bai-border)",
            color: "var(--bai-text)",
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ScopeOfWorkView() {
  const [createOpen, setCreateOpen] = useState(false);
  // The scope being deleted, while the dialog is open; and the ones gone, kept out of the list until the tree catches up.
  const [deleting, setDeleting] = useState<SowRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const driveId = useSelectedDriveId();
  const projectsFolderId = useFolderMap().get("projects");
  const { serverFileNodes, isLoading: treeLoading } = useKnowledgeNotes();
  const specs = useMemo<ReactorDocSpec[]>(
    () =>
      serverFileNodes
        .filter((n) => n.documentType === "powerhouse/scopeofwork")
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [serverFileNodes],
  );
  const { docs, isLoading: docsLoading } = useReactorDocsWithRefetch(specs, {
    pollMs: 30_000,
    retainKey: "scope-view",
  });
  const isLoading = (treeLoading && specs.length === 0) || docsLoading;

  const sows = useMemo<SowRow[]>(() => {
    return docs
      .filter((d) => d.header.documentType === "powerhouse/scopeofwork")
      .map((d) => {
        const g = (d.state as unknown as { global: Record<string, unknown> }).global;
        const deliverables = (g.deliverables as { status?: string }[] | undefined) ?? [];
        const roadmaps = (g.roadmaps as { milestones?: unknown[] }[] | undefined) ?? [];
        return {
          id: d.header.id,
          title: (g.title as string | undefined) || d.header.name,
          status: (g.status as string | undefined) ?? "DRAFT",
          projects: ((g.projects as unknown[] | undefined) ?? []).length,
          deliverables: deliverables.length,
          delivered: deliverables.filter((x) => x.status === "DELIVERED").length,
          milestones: roadmaps.reduce((n, r) => n + (r.milestones?.length ?? 0), 0),
          contributors: ((g.contributors as unknown[] | undefined) ?? []).length,
          breakdowns: ((g.projects as { wbsRef?: string | null }[] | undefined) ?? []).filter((p) => p.wbsRef).length,
          lastModified: d.header.lastModifiedAtUtcIso,
        };
      })
      .filter((row) => !gone.has(row.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [docs, gone]);

  const confirmDelete = async () => {
    if (!deleting || !driveId || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDocumentRemote(deleting.id, driveId);
      const id = deleting.id;
      setGone((prev) => new Set(prev).add(id));
      setDeleting(null);
      triggerVaultPull();
    } catch (err) {
      setDeleteError(writeErrorText([err]));
    } finally {
      setDeleteBusy(false);
    }
  };

  const newButton = (
    <button
      type="button"
      onClick={() => setCreateOpen(true)}
      className="rounded-md px-3 py-1.5 text-xs font-semibold"
      style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
    >
      + New scope of work
    </button>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--bai-text-tertiary)" }}>
          Scope of work ({sows.length})
        </h2>
        {newButton}
      </div>

      {isLoading && sows.length === 0 ? (
        <LoadingPanel label="Loading scopes…" />
      ) : sows.length === 0 ? (
        <div
          className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl"
          style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
        >
          <div className="text-center">
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              No scope of work yet
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--bai-text-faint)" }}>
              A scope prices and schedules the work the Projects tab tracks
            </p>
          </div>
          {newButton}
        </div>
      ) : (
        <div className="space-y-1">
          {sows.map((sow) => (
            <SowCard
              key={sow.id}
              sow={sow}
              onDelete={(row) => {
                setDeleteError(null);
                setDeleting(row);
              }}
            />
          ))}
        </div>
      )}

      <NewScopeDialog
        open={createOpen}
        driveId={driveId}
        projectsFolderId={projectsFolderId}
        onClose={() => setCreateOpen(false)}
      />

      {deleting && (
        <TypeToConfirmDialog
          title={`Delete “${deleting.title}”?`}
          name={deleting.title}
          nameLabel="the scope's title"
          confirmLabel="Delete scope of work"
          busyLabel="Deleting…"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        >
          <DeleteScopeBody sow={deleting} />
        </TypeToConfirmDialog>
      )}
    </div>
  );
}
