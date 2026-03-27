import { useState } from "react";
import { generateId } from "document-model/core";
import type { NoteStatus } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type StatusBarProps = {
  status: NoteStatus | null;
  provenanceAuthor: string | null;
  hasProvenance: boolean;
  onSubmitForReview: (
    id: string,
    actor: string,
    timestamp: string,
    comment?: string,
  ) => void;
  onApprove: (
    id: string,
    actor: string,
    timestamp: string,
    comment?: string,
  ) => void;
  onReject: (
    id: string,
    actor: string,
    timestamp: string,
    comment: string,
  ) => void;
  onArchive: (
    id: string,
    actor: string,
    timestamp: string,
    comment: string,
  ) => void;
  onRestore: (
    id: string,
    actor: string,
    timestamp: string,
    comment?: string,
  ) => void;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  IN_REVIEW: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  CANONICAL: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  CANONICAL: "Canonical",
  ARCHIVED: "Archived",
};

const FLOW_HINT: Record<string, string> = {
  DRAFT: "Draft \u2192 In Review \u2192 Canonical",
  IN_REVIEW: "In Review \u2192 Canonical or \u2192 Draft",
  CANONICAL: "Canonical \u2192 Archived",
  ARCHIVED: "Archived \u2192 Draft",
};

type ActionFormState = {
  action: "submit" | "approve" | "reject" | "archive" | "restore";
  actor: string;
  comment: string;
} | null;

export function StatusBar({
  status,
  provenanceAuthor,
  hasProvenance,
  onSubmitForReview,
  onApprove,
  onReject,
  onArchive,
  onRestore,
}: StatusBarProps) {
  const [form, setForm] = useState<ActionFormState>(null);
  const currentStatus = status ?? "DRAFT";
  const style = STATUS_STYLES[currentStatus] ?? STATUS_STYLES.DRAFT;
  const label = STATUS_LABELS[currentStatus] ?? currentStatus;

  function openForm(
    action: "submit" | "approve" | "reject" | "archive" | "restore",
  ) {
    const defaultActor =
      action === "approve" || action === "reject"
        ? ""
        : (provenanceAuthor ?? "");
    setForm({ action, actor: defaultActor, comment: "" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const actor = form.actor.trim();
    if (!actor) return;
    const id = generateId();
    const ts = new Date().toISOString();
    const comment = form.comment.trim();

    switch (form.action) {
      case "submit":
        onSubmitForReview(id, actor, ts, comment || undefined);
        break;
      case "approve":
        onApprove(id, actor, ts, comment || undefined);
        break;
      case "reject":
        if (!comment) return; // comment required
        onReject(id, actor, ts, comment);
        break;
      case "archive":
        if (!comment) return; // comment required
        onArchive(id, actor, ts, comment);
        break;
      case "restore":
        onRestore(id, actor, ts, comment || undefined);
        break;
    }
    setForm(null);
  }

  const needsComment = form?.action === "reject" || form?.action === "archive";
  const needsReviewer = form?.action === "approve" || form?.action === "reject";

  const ACTION_LABELS: Record<string, string> = {
    submit: "Submit for Review",
    approve: "Approve",
    reject: "Reject",
    archive: "Archive",
    restore: "Restore to Draft",
  };

  const ACTION_COLORS: Record<string, string> = {
    submit: "bg-blue-600 hover:bg-blue-700",
    approve: "bg-emerald-600 hover:bg-emerald-700",
    reject: "bg-red-600 hover:bg-red-700",
    archive: "bg-gray-600 hover:bg-gray-700",
    restore: "bg-amber-600 hover:bg-amber-700",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${style}`}
        >
          {label}
        </span>

        {!hasProvenance && currentStatus === "DRAFT" && (
          <span className="text-[10px] text-amber-400/70">
            Set provenance first \u2192
          </span>
        )}

        {hasProvenance && currentStatus === "DRAFT" && !form && (
          <button
            type="button"
            onClick={() => openForm("submit")}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            Submit for Review
          </button>
        )}

        {currentStatus === "IN_REVIEW" && !form && (
          <>
            <button
              type="button"
              onClick={() => openForm("approve")}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => openForm("reject")}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Reject
            </button>
          </>
        )}

        {currentStatus === "CANONICAL" && !form && (
          <button
            type="button"
            onClick={() => openForm("archive")}
            className="rounded bg-gray-600 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
          >
            Archive
          </button>
        )}

        {currentStatus === "ARCHIVED" && !form && (
          <button
            type="button"
            onClick={() => openForm("restore")}
            className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            Restore to Draft
          </button>
        )}

        <span className="ml-auto text-[10px] text-gray-600">
          {FLOW_HINT[currentStatus]}
        </span>
      </div>

      {form && (
        <form
          onSubmit={handleSubmit}
          className="space-y-2 rounded-lg border border-white/10 bg-[#1e1e2e] p-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">
              {ACTION_LABELS[form.action]}
            </span>
            {needsReviewer && provenanceAuthor && (
              <span className="text-[10px] text-amber-400/70">
                (must differ from author: {provenanceAuthor})
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <input
                type="text"
                value={form.actor}
                onChange={(e) => setForm({ ...form, actor: e.target.value })}
                placeholder={
                  needsReviewer ? "Reviewer name..." : "Actor name..."
                }
                autoFocus
                className="w-full rounded border border-white/10 bg-[#11111b] px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50"
              />

              {(needsComment || form.comment) && (
                <input
                  type="text"
                  value={form.comment}
                  onChange={(e) =>
                    setForm({ ...form, comment: e.target.value })
                  }
                  placeholder={
                    needsComment
                      ? "Reason (required)..."
                      : "Comment (optional)..."
                  }
                  className="w-full rounded border border-white/10 bg-[#11111b] px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded px-2.5 py-1 text-xs text-gray-500 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                !form.actor.trim() || (needsComment && !form.comment.trim())
              }
              className={`rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-40 ${ACTION_COLORS[form.action]}`}
            >
              {ACTION_LABELS[form.action]}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
