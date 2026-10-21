import { useEffect, useRef, useState } from "react";
import { isBrowserHost } from "../../../shared/host-config.js";
import { aiWorkLine } from "../../../shared/pipeline-words.js";
import type { IntakeBatch } from "../../hooks/use-intake-batch.js";
import {
  batchSummary,
  isReviewReady,
  selectedCount,
  waitingLine,
  type IntakeFile,
  type SummaryPart,
} from "../../lib/intake-model.js";
import { backgroundNote } from "./background-note.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DropZone, useFilePicker } from "./DropZone.js";
import { CarryRow } from "./CarryRow.js";
import { FileRow } from "./FileRow.js";
import {
  BatchMark,
  CheckIcon,
  MoreIcon,
  WarnIcon,
  XIcon,
} from "./intake-icons.js";
import { IntakeStyles } from "./intake-styles.js";
import { ReviewPanel } from "./ReviewPanel.js";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "2 ready for you, 2 reading and 1 added." — the parts that ask for the person in colour. */
function Summary({ parts }: { parts: readonly SummaryPart[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={part.text}>
          {part.tone ? (
            <span className={part.tone === "ready" ? "ik-ready" : "ik-look"}>
              {part.text}
            </span>
          ) : (
            part.text
          )}
          {i < parts.length - 2 ? ", " : i === parts.length - 2 ? " and " : "."}
        </span>
      ))}
    </>
  );
}

/** "⋯": the one thing rarely needed — removing every file not yet added. */
function MoreMenu({
  canDiscard,
  onDiscard,
}: {
  canDiscard: boolean;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="ik-x"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="ik-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={!canDiscard}
            onClick={() => {
              setOpen(false);
              onDiscard();
            }}
          >
            Remove the files not added yet
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Adding sources, inside the Sources view. One list of the files in the order
 * they were added — rows never move under the pointer — each in one of three
 * states (Reading, Ready, Added) with at most one action filled. A sentence on
 * top says where the batch is; with several files ready, one button adds them
 * all. Checking a file opens the review from the right, only when asked.
 *
 * Hide folds it to one line rather than making it vanish, so the batch is
 * visibly still there; when every file is added, the same list says so and
 * Done closes it.
 */
export function IntakePanel({
  batch,
  maxUploadBytes,
  configured,
  onOpenFolder,
}: {
  batch: IntakeBatch;
  /** This vault's cap for one file (`convert/health`). */
  maxUploadBytes?: number;
  configured: boolean;
  onOpenFolder?: (folderName: string) => void;
}) {
  const { files } = batch;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A held duplicate opens the folder its earlier copy is in; anything else, its own.
  const openFolderOf = (f: IntakeFile) => {
    const folder = f.state === "duplicate" ? f.known?.folderName : f.folderName;
    return onOpenFolder && folder ? () => onOpenFolder(folder) : undefined;
  };
  const picker = useFilePicker(batch.accepts, batch.onFiles);

  const open = files.find((f) => f.id === batch.openId) ?? null;
  const ready = files.filter((f) => isReviewReady(f) && selectedCount(f) > 0);
  const added = files.filter((f) => f.publishedIds !== undefined);
  const notAdded = files.length - added.length;
  const sources = added.reduce((n, f) => n + (f.publishedIds?.length ?? 0), 0);
  const readySources = ready.reduce((n, f) => n + selectedCount(f), 0);
  const parts = batchSummary(files);
  const complete = batch.isComplete;
  const doneTitle =
    files.length === 1 ? "1 file added" : `All ${files.length} files added`;
  // In the browser vault the visitor's AI does it, one source after another.
  const doneLine = isBrowserHost() ? aiWorkLine(sources) : `${plural(sources, "new source")}, queued to become notes.`;

  // Adds from an earlier visit, carried on: above the files, in either state of the panel.
  const carryRows = batch.carrying.map((c) => (
    <CarryRow
      key={c.id}
      carry={c}
      onCarryOn={() => batch.onCarryOn(c.id)}
      onForget={() => batch.onForgetCarried(c.id)}
      onOpenSources={onOpenFolder ? () => onOpenFolder(c.folderName) : undefined}
    />
  ));

  if (batch.collapsed && files.length > 0) {
    return (
      <section aria-label="Adding sources" className="bai-intake ik-folded">
        <IntakeStyles />
        {complete ? (
          <span className="ik-tick">
            <CheckIcon />
          </span>
        ) : (
          <BatchMark working={batch.working} />
        )}
        <span>
          {complete ? (
            <>
              <b>{doneTitle}.</b> {doneLine}
            </>
          ) : (
            <>
              <b>Adding {plural(files.length, "file")}.</b>{" "}
              <Summary parts={parts} />
            </>
          )}
        </span>
        <span className="ik-folded-tools">
          <button
            type="button"
            className="ik-btn ik-btn-secondary"
            onClick={batch.expand}
          >
            Show
          </button>
          {complete && (
            <button
              type="button"
              className="ik-btn ik-btn-primary"
              onClick={batch.reset}
            >
              Done
            </button>
          )}
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Adding sources" className="bai-intake ik-panel">
      <IntakeStyles />
      {picker.input}
      <div className="ik-head">
        {files.length === 0 ? (
          <>
            <div className="ik-head-what">
              <h3>Add sources</h3>
              <p>
                Drop files or choose them. Nothing is added until you say so.
              </p>
            </div>
            <div className="ik-head-tools">
              <button
                type="button"
                className="ik-x"
                onClick={batch.close}
                aria-label="Close"
                title="Close"
              >
                <XIcon />
              </button>
            </div>
          </>
        ) : complete ? (
          <>
            <div className="ik-head-what">
              <h3>
                <span className="ik-tick">
                  <CheckIcon />
                </span>
                {doneTitle}
              </h3>
              <p>{doneLine}</p>
            </div>
            <div className="ik-head-tools">
              <button
                type="button"
                className="ik-btn ik-btn-quiet"
                onClick={picker.open}
                disabled={!configured}
              >
                Add more files
              </button>
              <button
                type="button"
                className="ik-btn ik-btn-primary"
                onClick={batch.reset}
                title="Close this list. The sources are already in the vault."
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ik-head-what">
              <h3>Adding {plural(files.length, "file")}</h3>
              <p>
                <Summary parts={parts} />
              </p>
            </div>
            <div className="ik-head-tools">
              {ready.length >= 2 && (
                <button
                  type="button"
                  className="ik-btn ik-btn-secondary"
                  onClick={() => void batch.onPublishAll()}
                  disabled={batch.publishing}
                  title={`Add ${plural(readySources, "source")} from ${ready.length} files, with the sections each one already has chosen.`}
                >
                  Add {ready.length} ready files
                </button>
              )}
              <button
                type="button"
                className="ik-btn ik-btn-quiet"
                onClick={batch.collapse}
                title="Fold this to one line. Reading carries on."
              >
                Hide
              </button>
              <MoreMenu
                canDiscard={notAdded > 0}
                onDiscard={() => setConfirmDiscard(true)}
              />
            </div>
          </>
        )}
      </div>

      {batch.refused.length > 0 && (
        <div className="ik-notice" role="status">
          <WarnIcon />
          <div>
            {batch.refused.length === 1
              ? "1 file wasn't added:"
              : `${batch.refused.length} files weren't added:`}
            <ul>
              {batch.refused.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="ik-x"
            onClick={batch.dismissRefused}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <XIcon />
          </button>
        </div>
      )}

      {files.length === 0 ? (
        <>
          {/* An add carried on from an earlier visit shows even before anything new is dropped. */}
          {carryRows.length > 0 && <ul className="ik-rows">{carryRows}</ul>}
          <div style={{ padding: "0 18px 18px" }}>
            <DropZone
              accept={batch.accepts}
              maxUploadBytes={maxUploadBytes}
              onFiles={batch.onFiles}
              variant="hero"
              disabled={!configured}
            />
          </div>
        </>
      ) : (
        <>
          <ul className="ik-rows">
            {carryRows}
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                waiting={
                  f.state === "queued"
                    ? waitingLine(f, files, batch.laneOf, batch.checking)
                    : undefined
                }
                publishingId={batch.publishingId}
                progress={batch.progress}
                onReview={() => batch.setOpenId(f.id)}
                onAdd={() => void batch.onPublish(f.id)}
                onRetry={() => batch.onRetry(f.id)}
                onRunOcr={() => batch.onRunOcr(f.id)}
                onRetryAttach={() => void batch.onRetryAttach(f.id)}
                onRemove={() => batch.onRemove(f.id)}
                onAddAgain={() => batch.addAgain(f.id)}
                onOpenSources={openFolderOf(f)}
              />
            ))}
          </ul>
          {!complete && (
            <DropZone
              accept={batch.accepts}
              maxUploadBytes={maxUploadBytes}
              onFiles={batch.onFiles}
              variant="row"
              disabled={!configured}
            />
          )}
          {batch.working && <p className="ik-note">{backgroundNote()}</p>}
        </>
      )}

      {open && (
        <ReviewPanel
          file={open}
          publishingId={batch.publishingId}
          canPublish={Boolean(batch.driveId)}
          onClose={() => batch.setOpenId(null)}
          onToggle={(i) => batch.onToggle(open.id, i)}
          onAll={(on) => batch.onAll(open.id, on)}
          onType={(t) => batch.onType(open.id, t)}
          onFolderName={(n) => batch.onFolderName(open.id, n)}
          onPublish={() => void batch.onPublish(open.id)}
          onRunOcr={() => batch.onRunOcr(open.id)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title={
            added.length > 0
              ? "Remove the files not added yet?"
              : "Remove all these files?"
          }
          body={
            added.length > 0
              ? `${plural(sources, "source")} from ${plural(added.length, "file")} ${sources === 1 ? "is" : "are"} in the vault and stay there. The other ${plural(notAdded, "file")} ${notAdded === 1 ? "is" : "are"} removed; nothing from ${notAdded === 1 ? "it" : "them"} has been added.`
              : `${plural(files.length, "file")} ${files.length === 1 ? "is" : "are"} removed${batch.working ? " and reading stops" : ""}. Nothing from ${files.length === 1 ? "it" : "them"} has been added to the vault.`
          }
          confirmLabel="Remove them"
          cancelLabel="Keep them"
          danger
          onConfirm={() => {
            setConfirmDiscard(false);
            batch.cancel();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </section>
  );
}
