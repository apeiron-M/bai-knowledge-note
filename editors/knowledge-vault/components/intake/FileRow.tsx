import type { IntakeFile } from "../../lib/intake-model.js";
import {
  isReviewReady,
  formatEstimate,
  needsOcrDecision,
  selectedCount,
} from "../../lib/intake-model.js";
import { formatFileSize } from "../../lib/mime.js";
import { Spinner } from "../LoadingStates.js";
import { JourneyStrip } from "./JourneyStrip.js";

const elapsed = (from: number | undefined, to: number | undefined) => {
  if (!from) return "";
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return s < 60
    ? `${s} s`
    : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
};

/** Where a row sits on the journey strip. */
function journeyOf(file: IntakeFile): {
  reached: number;
  now: number;
  halted: boolean;
} {
  if (file.publishedIds) return { reached: 4, now: 3, halted: false };
  switch (file.state) {
    case "queued":
    case "converting":
      return { reached: 1, now: 1, halted: false };
    case "failed":
      return { reached: 1, now: 1, halted: true };
    case "converted":
      return { reached: 2, now: 2, halted: false };
  }
}

/**
 * One file, one row: its name, its journey strip, one line saying what is
 * happening in the vault's words, and at most one action — Review, Retry,
 * Remove, or Open. Elapsed time, never a percentage: nothing here is measured
 * that would justify one.
 */
export function FileRow({
  file,
  selected,
  position,
  onOpen,
  onRetry,
  onRunOcr,
  onRetryAttach,
  onRemove,
  onOpenSources,
}: {
  file: IntakeFile;
  selected: boolean;
  /** "file 3 of 5" for a queued row. */
  position?: string;
  onOpen: () => void;
  /** Accept the OCR cost the service would not spend unasked. */
  onRunOcr?: () => void;
  /** Re-run only the attach step after a publish whose original did not land. */
  onRetryAttach?: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onOpenSources?: () => void;
}) {
  const j = journeyOf(file);
  const ready = isReviewReady(file);
  const pendingOcr = needsOcrDecision(file);
  const estimate = file.converted?.needsOcr?.estimateSeconds ?? 0;
  const estimateText = formatEstimate(estimate);
  const dot = file.publishedIds
    ? "var(--bai-ok)"
    : file.state === "failed"
      ? "var(--bai-danger)"
      : file.state === "converted"
        ? "var(--bai-warn)"
        : file.state === "converting"
          ? "var(--bai-accent)"
          : "var(--bai-text-faint)";

  let line: React.ReactNode;
  if (file.publishedIds) {
    const n = file.publishedIds.length;
    line = file.attachError ? (
      <span style={{ color: "var(--bai-warn)" }} title={file.attachError}>
        ✓ {n} source{n === 1 ? "" : "s"} in /sources/{file.folderName}/ ·
        original not attached: {file.attachError}
      </span>
    ) : (
      <span style={{ color: "var(--bai-ok)" }}>
        ✓ {n} source{n === 1 ? "" : "s"} in /sources/{file.folderName}/ · queued
        for extraction · original attached
      </span>
    );
  } else if (pendingOcr) {
    line = (
      <span style={{ color: "var(--bai-warn)" }}>
        Its text can't be read as it is — OCR would take {estimateText}
        {file.converted?.pages ? ` for ${file.converted.pages} pages` : ""}
      </span>
    );
  } else if (file.state === "converted") {
    const parts = file.converted?.sections.length ?? 0;
    line = (
      <span style={{ color: "var(--bai-warn)" }}>
        Ready — {parts} part{parts === 1 ? "" : "s"}, {selectedCount(file)}{" "}
        {file.converted?.quality?.coverage != null
          ? `· ${Math.round(file.converted.quality.coverage * 100)}% of the text `
          : ""}
        ticked
      </span>
    );
  } else if (file.state === "converting") {
    const p = file.progress;
    const phase =
      p?.phase === "reading" && p.pages
        ? `reading page ${Math.max(1, p.pagesDone)} of ${p.pages}`
        : p?.phase === "structuring"
          ? "structuring the text"
          : p?.phase === "text-layer"
            ? "reading the text layer"
            : p?.phase === "ocr"
              ? "recognising text (OCR)"
              : p?.phase === "figures"
                ? `cutting out figures${p.pagesDone ? ` · ${p.pagesDone}` : ""}`
                : "converting";
    line = (
      <span
        className="inline-flex items-center gap-1.5"
        style={{ color: "var(--bai-text-faint)" }}
      >
        <Spinner className="h-3 w-3" /> {phase} ·{" "}
        {elapsed(file.startedAt, undefined)} · keep this tab open
      </span>
    );
  } else if (file.state === "queued") {
    line = (
      <span style={{ color: "var(--bai-text-faint)" }}>
        Waiting{position ? ` · ${position}` : ""}
      </span>
    );
  } else {
    line = (
      <span style={{ color: "var(--bai-danger)" }}>
        {file.error ?? "Failed"}
      </span>
    );
  }

  return (
    <div
      className="intake-row flex flex-col gap-1.5 rounded-lg px-3 py-2.5"
      style={{
        backgroundColor: "var(--bai-bg)",
        // Longhands only: React warns when `border` and `borderLeft` are mixed.
        borderStyle: "solid",
        borderWidth:
          ready || file.state === "failed" ? "1px 1px 1px 3px" : "1px",
        borderColor: (() => {
          const base = selected ? "var(--bai-accent)" : "var(--bai-border)";
          return ready || file.state === "failed"
            ? `${base} ${base} ${base} var(--bai-warn)`
            : base;
        })(),
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{
            color: file.publishedIds
              ? "var(--bai-text-tertiary)"
              : "var(--bai-text-secondary)",
          }}
          title={`${file.name} · ${formatFileSize(file.size)}`}
        >
          {file.name}
        </span>
        {pendingOcr && onRunOcr && (
          <button
            type="button"
            onClick={onRunOcr}
            className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
            title="Read every page with OCR — heavy on the CPU while it runs"
          >
            Run OCR ({estimateText})
          </button>
        )}
        {ready && (
          <button
            type="button"
            onClick={onOpen}
            className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium"
            style={
              selected
                ? {
                    backgroundColor: "var(--bai-hover)",
                    color: "var(--bai-accent)",
                    border: "1px solid var(--bai-border)",
                  }
                : {
                    backgroundColor: "var(--bai-accent)",
                    color: "var(--bai-accent-text)",
                  }
            }
          >
            Review
          </button>
        )}
        {ready && (
          <button
            type="button"
            onClick={onRemove}
            className="intake-link shrink-0 text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
            title="Drop this file — nothing from it has been written"
          >
            Remove
          </button>
        )}
        {file.state === "failed" && (
          <>
            <button
              type="button"
              onClick={onRetry}
              className="intake-link shrink-0 text-[11px] font-medium"
              style={{ color: "var(--bai-accent)" }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="intake-link shrink-0 text-[11px]"
              style={{ color: "var(--bai-text-muted)" }}
            >
              Remove
            </button>
          </>
        )}
        {file.state === "queued" && (
          <button
            type="button"
            onClick={onRemove}
            className="intake-link shrink-0 text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Remove
          </button>
        )}
        {file.publishedIds && file.attachError && onRetryAttach && (
          <button
            type="button"
            onClick={onRetryAttach}
            disabled={file.attachError === "attaching…"}
            className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            Retry attach
          </button>
        )}
        {file.publishedIds && onOpenSources && (
          <button
            type="button"
            onClick={onOpenSources}
            className="intake-link shrink-0 text-[11px] font-medium"
            style={{ color: "var(--bai-accent)" }}
          >
            Open in Sources
          </button>
        )}
      </div>
      {/* The status line wraps under the strip when the row is narrow rather
          than being clipped beside it: "structuring the text · 12s" must read whole. */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        style={{ paddingLeft: 18 }}
      >
        <JourneyStrip reached={j.reached} now={j.now} halted={j.halted} />
        <span className="min-w-[16rem] flex-1 truncate text-right text-[11px]">
          {line}
        </span>
      </div>
      {file.state === "converting" &&
      file.progress?.phase === "reading" &&
      file.progress.pages ? (
        // Measured: pages finished over pages in the file. The chunking phase
        // that follows has no page signal, so the bar stops at full and the
        // line says "structuring" rather than inventing a second bar.
        <div
          className="ml-[18px] h-1 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--bai-hover)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, (file.progress.pagesDone / file.progress.pages) * 100)}%`,
              backgroundColor: "var(--bai-accent)",
            }}
          />
        </div>
      ) : null}
      <style>{`
        .intake-row:hover { background-color: var(--bai-hover) !important; }
        .intake-link:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
