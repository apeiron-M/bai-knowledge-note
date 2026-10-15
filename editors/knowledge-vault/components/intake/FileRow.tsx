import { useEffect, useState, type ReactNode } from "react";
import {
  displayName,
  formatBadge,
  aboutEstimate,
  formatElapsed,
  isReviewReady,
  knownLine,
  needsOcrDecision,
  progressBar,
  progressLabel,
  reviewNotes,
  selectedCount,
  type IntakeFile,
} from "../../lib/intake-model.js";
import { formatFileSize } from "../../lib/mime.js";
import { FileIcon, XIcon } from "./intake-icons.js";
import { ReadingTrack, SectionStrip } from "./SectionStrip.js";

/**
 * Re-render once a second while `active`, so a reading row's time moves. The
 * row ticks itself: the batch lives outside React and only changes when
 * something happens.
 */
function useSecondTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One file, one row, three states a person tells apart at a glance — Reading,
 * Ready, Added — plus the two that need them: a scan to read on request, and a
 * file that could not be read. One plain line says where it is, and at most one
 * action is filled: the one that moves this file on. Remove (×) is on every
 * file not yet added.
 *
 * The bar is the file. While it is read, a progress track; once ready, a tile
 * per section; once added, the same tiles in green.
 */
export function FileRow({
  file,
  waiting,
  publishingId,
  progress,
  onReview,
  onAdd,
  onRetry,
  onRunOcr,
  onRetryAttach,
  onRemove,
  onOpenSources,
  onAddAgain,
}: {
  file: IntakeFile;
  /** For a waiting file: what it waits for. */
  waiting?: string;
  /** The file being added right now — one at a time, so every other Add waits. */
  publishingId: string | null;
  /** How far the file being added is: sources in the vault, of how many. */
  progress?: { done: number; total: number } | null;
  onReview: () => void;
  onAdd: () => void;
  onRetry: () => void;
  /** Accept the time a scan takes to read, which the service would not spend unasked. */
  onRunOcr: () => void;
  /** Attach the original again after a publish whose original did not land. */
  onRetryAttach?: () => void;
  onRemove: () => void;
  onOpenSources?: () => void;
  /** Read and add a file the vault already holds, as a second copy. */
  onAddAgain?: () => void;
}) {
  useSecondTick(file.state === "converting");

  // The moment a file becomes ready its bar splits into sections — only when
  // that change happens in front of the person, not every time a row mounts.
  const [seenState, setSeenState] = useState(file.state);
  const [split, setSplit] = useState(false);
  if (seenState !== file.state) {
    setSeenState(file.state);
    setSplit(seenState === "converting" && file.state === "converted");
  }

  const name = displayName(file.name);
  const sections = file.converted?.sections ?? [];
  const weights = sections.map((s) => s.content.length);
  const added = file.publishedIds !== undefined;
  const adding = publishingId === file.id;
  const busy = publishingId !== null;

  let visual: ReactNode = null;
  let caption: ReactNode;
  let actions: ReactNode = null;
  let removeTitle: string | null = "Remove it. Nothing from it has been added.";

  if (added) {
    const n = file.publishedIds?.length ?? 0;
    visual = (
      <SectionStrip weights={weights} kept={file.selected} tone="added" />
    );
    removeTitle = null;
    if (file.attachError === "attaching…") {
      caption = <span className="ik-cap">Attaching the original file…</span>;
    } else if (file.attachError) {
      caption = (
        <span className="ik-cap ik-cap-warn" title={file.attachError}>
          Added as {plural(n, "source")}, but the original file couldn't be
          attached
        </span>
      );
    } else if (file.publishError) {
      caption = (
        <span className="ik-cap ik-cap-warn" title={file.publishError}>
          {file.publishError}
        </span>
      );
    } else {
      caption = (
        <span className="ik-cap ik-cap-ok">Added as {plural(n, "source")}</span>
      );
    }
    actions = (
      <>
        {file.attachError && onRetryAttach && (
          <button
            type="button"
            className="ik-btn ik-btn-secondary"
            disabled={file.attachError === "attaching…"}
            onClick={onRetryAttach}
          >
            Attach again
          </button>
        )}
        {onOpenSources && (
          <button
            type="button"
            className="ik-btn ik-btn-quiet ik-btn-accent"
            onClick={onOpenSources}
            title="Open the folder these sources are in"
          >
            Open
          </button>
        )}
      </>
    );
  } else if (needsOcrDecision(file)) {
    const pages = file.converted?.pages;
    const estimate = aboutEstimate(
      file.converted?.needsOcr?.estimateSeconds ?? 0,
    );
    caption = (
      <span className="ik-cap">
        This is a scan. Reading the text from its{" "}
        {pages ? `${pages} page images` : "page images"} takes {estimate}.
      </span>
    );
    actions = (
      <button
        type="button"
        className="ik-btn ik-btn-primary"
        onClick={onRunOcr}
        title="Recognise the text on every page. It keeps the computer busy while it runs."
      >
        Read the scan
      </button>
    );
  } else if (file.state === "duplicate" && file.known) {
    // Held, unread: the vault (or this batch) already has this exact file.
    const line = knownLine(file.known);
    caption = (
      <span className="ik-cap" title={`${line.lead} ${line.detail}`}>
        <span className="ik-cap-warn">{line.lead}</span> {line.detail}
      </span>
    );
    actions = (
      <>
        {onOpenSources && (
          <button
            type="button"
            className="ik-btn ik-btn-quiet ik-btn-accent"
            onClick={onOpenSources}
            title="Open the folder the earlier copy is in"
          >
            Open
          </button>
        )}
        {onAddAgain && (
          <button
            type="button"
            className="ik-btn ik-btn-secondary"
            onClick={onAddAgain}
            title="Read it again: sections already in the vault start left out, and the rest goes beside them"
          >
            Add again
          </button>
        )}
      </>
    );
    removeTitle = "Remove it. Nothing from it will be added.";
  } else if (isReviewReady(file)) {
    const kept = selectedCount(file);
    const present = file.alreadyIn?.filter(Boolean).length ?? 0;
    const left = sections.length - kept - present;
    const notes = reviewNotes(file);
    const warning = notes.find((n) => n.tone === "warn");
    // A warning leads; otherwise what is worth knowing (a folder of its own).
    const note = warning ?? notes.at(0);
    visual = (
      <SectionStrip weights={weights} kept={file.selected} present={file.alreadyIn} split={split} />
    );
    caption = adding && progress ? (
      <span className="ik-cap">
        Adding {progress.done} of {plural(progress.total, "source")}…
      </span>
    ) : (
      <span className="ik-cap">
        {plural(sections.length, "section")}
        {present > 0 ? `, ${present} already in the vault` : ""}
        {kept === 0
          ? present === sections.length
            ? ""
            : ", none kept"
          : left > 0
            ? `, ${left} left out`
            : ""}
        {file.publishError ? (
          <>
            <span className="ik-sep" />
            <span className="ik-cap-danger" title={file.publishError}>
              Couldn't add it: {file.publishError}
            </span>
          </>
        ) : note ? (
          <>
            <span className="ik-sep" />
            <span
              className={note.tone === "warn" ? "ik-cap-warn" : undefined}
              title={note.long}
            >
              {note.short}
            </span>
          </>
        ) : null}
      </span>
    );
    const addLabel = `Add ${plural(kept, "source")}`;
    if (adding) {
      actions = (
        <button type="button" className="ik-btn ik-btn-primary" disabled>
          Adding…
        </button>
      );
    } else if (kept === 0) {
      actions = (
        <button
          type="button"
          className="ik-btn ik-btn-primary"
          onClick={onReview}
        >
          Review
        </button>
      );
    } else if (warning) {
      // A reason to look first: Review leads, adding as it is stays one click.
      actions = (
        <>
          <button
            type="button"
            className="ik-btn ik-btn-quiet"
            onClick={onAdd}
            disabled={busy}
            title={`${addLabel} without opening it`}
          >
            Add
          </button>
          <button
            type="button"
            className="ik-btn ik-btn-primary"
            onClick={onReview}
          >
            Review
          </button>
        </>
      );
    } else {
      actions = (
        <>
          <button
            type="button"
            className="ik-btn ik-btn-quiet"
            onClick={onReview}
          >
            Review
          </button>
          <button
            type="button"
            className="ik-btn ik-btn-primary"
            onClick={onAdd}
            disabled={busy}
          >
            {addLabel}
          </button>
        </>
      );
    }
    if (adding) removeTitle = null;
  } else if (file.state === "failed") {
    caption = (
      <span className="ik-cap" title={file.error}>
        <span className="ik-cap-danger">Couldn't read this file.</span>
        {file.error ? ` ${file.error}` : ""}
      </span>
    );
    actions = (
      <button
        type="button"
        className="ik-btn ik-btn-secondary"
        onClick={onRetry}
      >
        Try again
      </button>
    );
    removeTitle = "Remove it";
  } else if (file.state === "converting") {
    const label = progressLabel(file.progress);
    visual = <ReadingTrack bar={progressBar(file.progress)} label={label} />;
    caption = <span className="ik-cap">{label}</span>;
    actions = file.startedAt ? (
      <span className="ik-time">
        {formatElapsed(Date.now() - file.startedAt)}
      </span>
    ) : null;
    removeTitle = "Stop reading it and remove it";
  } else {
    caption = (
      <span className="ik-cap" title={waiting ?? undefined}>
        {waiting ?? "Waiting."}
      </span>
    );
  }

  return (
    <li
      className="ik-row"
      data-state={added ? "added" : file.state}
      data-done={added ? "" : undefined}
    >
      <FileIcon label={formatBadge(file.name)} />
      <div className="ik-row-main">
        <div
          className="ik-name"
          title={`${file.name}, ${formatFileSize(file.size)}`}
        >
          {name}
        </div>
        <div className="ik-sub">
          {visual}
          {caption}
        </div>
      </div>
      <div className="ik-right">{actions}</div>
      {removeTitle ? (
        <button
          type="button"
          className="ik-x"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          title={removeTitle}
        >
          <XIcon />
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}
