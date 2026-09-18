import { useState, type ReactNode } from "react";
import type { IntakeBatch } from "../../hooks/use-intake-batch.js";
import {
  canPublish,
  isReviewReady,
  needsOcrDecision,
  type IntakeFile,
} from "../../lib/intake-model.js";
import { CompletionCard } from "./CompletionCard.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DropZone } from "./DropZone.js";
import { FileRow } from "./FileRow.js";
import { SectionReview } from "./SectionReview.js";

/**
 * The intake, inside the Sources view: a goal header with the batch bar and
 * the N+1 drop zone, the files grouped by what they need from the user, and
 * the review pane beside the list — never instead of it. When every file is in
 * the vault the whole thing collapses to the completion card.
 */
export function IntakePanel({
  batch,
  formats,
  configured,
  onOpenFolder,
}: {
  batch: IntakeBatch;
  formats: string[];
  configured: boolean;
  onOpenFolder?: (folderName: string) => void;
}) {
  const { files } = batch;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const done = files.filter((f) => f.publishedIds !== undefined);
  const review = files.filter(isReviewReady);
  const pendingOcr = files.filter(needsOcrDecision);
  const failed = files.filter((f) => f.state === "failed");
  const working = files.filter(
    (f) => f.state === "queued" || f.state === "converting",
  );
  const sourcesIn = done.reduce((n, f) => n + (f.publishedIds?.length ?? 0), 0);
  const open = files.find((f) => f.id === batch.openId) ?? null;
  const queuedPosition = new Map<string, string>();
  working.forEach((f, i) =>
    queuedPosition.set(
      f.id,
      `file ${done.length + review.length + failed.length + i + 1} of ${files.length}`,
    ),
  );

  // One card for the whole intake, visibly distinct from the folder list below
  // it: darker ground, an accent-tinted hairline, and its own rounded frame.
  const frame = (children: ReactNode) => (
    <section
      aria-label="Adding sources"
      className="rounded-2xl"
      style={{
        backgroundColor: "var(--bai-deep)",
        border:
          "1px solid color-mix(in srgb, var(--bai-accent) 35%, var(--bai-border))",
        boxShadow: "0 0 0 4px var(--bai-accent-soft)",
        padding: 16,
      }}
    >
      {children}
    </section>
  );

  if (batch.isComplete) {
    return frame(
      <CompletionCard
        files={files}
        onFinish={batch.reset}
        onAddMore={batch.open}
        onOpenSources={
          onOpenFolder && files[0]
            ? () => onOpenFolder(files[0].folderName)
            : undefined
        }
      />,
    );
  }

  const pct = (n: number) => `${files.length ? (n / files.length) * 100 : 0}%`;
  const group = (title: string, items: IntakeFile[]) =>
    items.length === 0 ? null : (
      <div key={title}>
        <div
          className="mb-1.5 mt-3.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {title} · {items.length}
        </div>
        <div className="space-y-1">
          {items.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              selected={f.id === batch.openId}
              position={queuedPosition.get(f.id)}
              onOpen={() => batch.setOpenId(f.id)}
              onRetry={() => batch.onRetry(f.id)}
              onRunOcr={() => batch.onRunOcr(f.id)}
              onRetryAttach={() => void batch.onRetryAttach(f.id)}
              onRemove={() => batch.onRemove(f.id)}
              onOpenSources={
                onOpenFolder ? () => onOpenFolder(f.folderName) : undefined
              }
            />
          ))}
        </div>
      </div>
    );

  return frame(
    <div className="space-y-3">
      {/* Goal header: where the batch is on the way to "in the vault", and the door for file N+1. */}
      <div
        className="rounded-xl px-4 py-3.5"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--bai-text)" }}
            >
              {files.length === 0 ? "Add sources" : "Adding sources"}
            </h3>
            {files.length > 0 && (
              <span className="ml-auto flex items-center gap-3">
                <button
                  type="button"
                  onClick={batch.close}
                  className="text-[11px]"
                  style={{ color: "var(--bai-text-faint)" }}
                  title="Hide the panel — the batch keeps running"
                >
                  hide
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="rounded-md px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    color: "var(--bai-text-tertiary)",
                    border: "1px solid var(--bai-border)",
                  }}
                  title={
                    done.length > 0
                      ? "Discard the files that are not in the vault"
                      : "Discard the batch — nothing has been written"
                  }
                >
                  Cancel
                </button>
              </span>
            )}
            {files.length === 0 && (
              <button
                type="button"
                onClick={batch.close}
                className="ml-auto text-[11px]"
                style={{ color: "var(--bai-text-faint)" }}
              >
                close
              </button>
            )}
          </div>
          {files.length > 0 ? (
            <>
              <p
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                <b className="font-medium" style={{ color: "var(--bai-ok)" }}>
                  {sourcesIn} source{sourcesIn === 1 ? "" : "s"} in the vault
                </b>{" "}
                from {done.length} of {files.length} file
                {files.length === 1 ? "" : "s"}
                {review.length + pendingOcr.length > 0 && (
                  <>
                    {" · "}
                    <b
                      className="font-medium"
                      style={{ color: "var(--bai-warn)" }}
                    >
                      {review.length + pendingOcr.length} waiting for you
                    </b>
                  </>
                )}
                {working.length > 0 && ` · ${working.length} converting`}
                {failed.length > 0 && (
                  <>
                    {" · "}
                    <b
                      className="font-medium"
                      style={{ color: "var(--bai-danger)" }}
                    >
                      {failed.length} failed
                    </b>
                  </>
                )}
              </p>
              <div
                className="mt-2 flex h-1.5 overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--bai-hover)" }}
              >
                <span
                  style={{
                    width: pct(done.length),
                    backgroundColor: "var(--bai-ok)",
                  }}
                />
                <span
                  style={{
                    width: pct(review.length + pendingOcr.length),
                    backgroundColor: "var(--bai-warn)",
                  }}
                />
                <span
                  style={{
                    width: pct(working.length),
                    backgroundColor: "var(--bai-accent)",
                  }}
                />
                <span
                  style={{
                    width: pct(failed.length),
                    backgroundColor: "var(--bai-danger)",
                  }}
                />
              </div>
            </>
          ) : (
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              Drop a file or several. Each is converted, you review the parts it
              would become, and nothing is written until you approve.
            </p>
          )}
          {batch.notice && (
            <p
              className="mt-2 text-[11px]"
              style={{
                color:
                  batch.notice.kind === "ok"
                    ? "var(--bai-ok)"
                    : "var(--bai-danger)",
              }}
            >
              {batch.notice.text}
            </p>
          )}
        </div>
        <DropZone
          formats={formats}
          onFiles={batch.onFiles}
          variant={files.length === 0 ? "hero" : "compact"}
          disabled={!configured}
        />
      </div>

      {files.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ width: 420, flex: "none", maxWidth: "100%" }}>
            {group("Needs you", [...review, ...pendingOcr, ...failed])}
            {group("Converting", working)}
            {group("In the vault", done)}
            {working.length > 0 && (
              <p
                className="mt-3 text-[11px]"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Keep this tab open while files convert — the work lives here
                until it is in the vault. Switching to Chat or Notes and back is
                fine.
              </p>
            )}
          </div>
          <div
            style={{
              flex: "1 1 420px",
              minWidth: 0,
              position: "sticky",
              top: 0,
            }}
          >
            {open ? (
              <SectionReview
                file={open}
                publishing={batch.publishing}
                canPublish={Boolean(batch.driveId) && canPublish([open])}
                onToggle={(i) => batch.onToggle(open.id, i)}
                onAll={(on) => batch.onAll(open.id, on)}
                onType={(t) => batch.onType(open.id, t)}
                onFolderName={(n) => batch.onFolderName(open.id, n)}
                onPublish={() => void batch.onPublish(open.id)}
                onRunOcr={() => batch.onRunOcr(open.id)}
              />
            ) : (
              <div
                className="rounded-xl px-6 py-10 text-center text-xs"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  border: "1px solid var(--bai-border)",
                  color: "var(--bai-text-tertiary)",
                }}
              >
                Nothing waiting for you
                {working.length > 0
                  ? ` — ${working.length} file${working.length === 1 ? "" : "s"} still converting. The next one that finishes opens here.`
                  : "."}{" "}
                When every file is in the vault, this panel becomes a summary
                with a Finish button.
              </div>
            )}
          </div>
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title={done.length > 0 ? "Stop here?" : "Discard this batch?"}
          body={
            done.length > 0
              ? `${sourcesIn} source${sourcesIn === 1 ? "" : "s"} from ${done.length} file${done.length === 1 ? " is" : "s are"} already in the vault and will stay. The remaining ${files.length - done.length} file${files.length - done.length === 1 ? "" : "s"} will be discarded — nothing from them has been written.`
              : `${files.length} file${files.length === 1 ? "" : "s"} will be discarded. Nothing has been written to the vault${working.length > 0 ? "; the conversion in progress is abandoned" : ""}.`
          }
          confirmLabel={done.length > 0 ? "Discard the rest" : "Discard"}
          danger
          onConfirm={() => {
            setConfirmCancel(false);
            batch.cancel();
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </div>,
  );
}
