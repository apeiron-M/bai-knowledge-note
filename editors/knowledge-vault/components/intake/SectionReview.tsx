import { useState } from "react";
import {
  type IntakeFile,
  SECTION_TYPES,
  figuresLine,
  formatEstimate,
  isLikelyFurniture,
  selectedCount,
} from "../../lib/intake-model.js";
import { formatFileSize } from "../../lib/mime.js";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";
import { JourneyStrip } from "./JourneyStrip.js";
import { SectionReader } from "./SectionReader.js";

/**
 * Step 3 of 4: what this file would become.
 *
 * Every part ticked by default except furniture (the section rule already
 * folded the undersized and split the oversized), because this step exists so
 * the user can *disagree*, not so they must assemble the result by hand. Each
 * row opens to a fixed-height glimpse of the exact content that will be
 * written — the decision is made where the evidence is — and "Read the whole
 * part" is the one way to read all of it.
 */
export function SectionReview({
  file,
  publishing,
  canPublish,
  onToggle,
  onAll,
  onType,
  onFolderName,
  onPublish,
  onRunOcr,
}: {
  file: IntakeFile;
  publishing: boolean;
  canPublish: boolean;
  onToggle: (index: number) => void;
  onAll: (on: boolean) => void;
  onType: (type: string) => void;
  onFolderName: (name: string) => void;
  /** Re-read the file with OCR — offered when the text layer was read flat. */
  onRunOcr?: () => void;
  onPublish: () => void;
}) {
  const sections = file.converted?.sections ?? [];
  const plan = file.converted?.plan;
  const quality = file.converted?.quality ?? null;
  const figures = figuresLine(file.converted?.figureStats);
  const extractionLine = quality
    ? [
        quality.coverage != null
          ? `${(quality.coverage * 100).toFixed(1)}% of the file's text is here`
          : "text coverage not measurable (no text layer)",
        quality.formulas.total > 0
          ? `${quality.formulas.total - quality.formulas.decoded} of ${quality.formulas.total} formula${quality.formulas.total === 1 ? "" : "s"} not decoded`
          : null,
        quality.images > 0
          ? `${quality.images} figure${quality.images === 1 ? "" : "s"} not transcribed`
          : null,
      ]
        .filter(Boolean)
        .concat(figures ? [figures] : [])
        .join(" · ")
    : null;
  const chosen = selectedCount(file);
  const published = file.publishedIds !== undefined;
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [reader, setReader] = useState<number | null>(null);

  const toggleOpen = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <header
        className="px-4 py-3.5"
        style={{ borderBottom: "1px solid var(--bai-border)" }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--bai-accent)" }}
        >
          Step 3 of 4 · Review
        </div>
        <div className="mt-1 flex items-center gap-3">
          <strong
            className="min-w-0 flex-1 truncate text-sm"
            style={{ color: "var(--bai-text)" }}
            title={file.name}
          >
            {file.name}
          </strong>
          <JourneyStrip
            reached={published ? 4 : 2}
            now={published ? 3 : 2}
            size="lg"
          />
        </div>
        {extractionLine && (
          <p
            className="mt-1.5 text-[11px]"
            style={{
              color:
                quality && quality.coverage != null && quality.coverage < 0.95
                  ? "var(--bai-warn)"
                  : "var(--bai-text-tertiary)",
            }}
            title="Measured against the text pdf.js reads from the file: a floor on completeness, not a proof. Formulas and figures are what the converter itself reports as not carried over."
          >
            Extraction: {extractionLine}
          </p>
        )}
        {plan && (
          <p
            className="mt-1.5 text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            We read {sections.length} part{sections.length === 1 ? "" : "s"}
            {plan.mergedSections > 0
              ? ` (${plan.mergedSections} small ones folded into their neighbours)`
              : ""}
            . Each ticked part becomes one source.
            {file.converted?.ocr
              ? ` This file's own text was unreadable, so it was read by OCR (${file.converted.ocr === "tesseract" ? "Tesseract" : "docling"}) — check names and numbers.`
              : file.converted?.textSource === "pdfjs"
                ? " Read from the file's text layer (its fonts defeat the layout reader): headings were inferred from type size; tables and bullets are not available."
                : ""}{" "}
            <b
              className="font-medium"
              style={{ color: "var(--bai-text-secondary)" }}
            >
              Nothing is written until you click Add.
            </b>
            {file.converted?.textSource === "pdfjs" &&
              file.converted.ocrOffer &&
              onRunOcr && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onRunOcr}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
                    style={{ color: "var(--bai-accent)" }}
                    title="OCR gives the layout reader a clean text layer, so tables and lists come back — but OCR misreads digits (measured: 7.1 → 7], 10.1 → 101), so check every number. Heavy on the CPU while it runs."
                  >
                    Re-read with OCR (
                    {formatEstimate(file.converted.ocrOffer.estimateSeconds)})
                    to recover tables — numbers will need checking
                  </button>
                </>
              )}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <label
            className="inline-flex items-center gap-2 text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Source type
            <select
              value={file.sourceType}
              disabled={published}
              onChange={(e) => onType(e.target.value)}
              className="review-input rounded-md px-2 py-1 text-[11px]"
              style={{
                backgroundColor: "var(--bai-bg)",
                border: "1px solid var(--bai-border)",
                color: "var(--bai-text-secondary)",
              }}
            >
              {SECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label
            className="inline-flex items-center gap-2 text-[11px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Folder
            <span style={{ color: "var(--bai-text-faint)" }}>/sources/</span>
            <input
              value={file.folderName}
              disabled={published}
              onChange={(e) => onFolderName(e.target.value)}
              className="review-input w-56 rounded-md px-2 py-1 text-[11px]"
              style={{
                backgroundColor: "var(--bai-bg)",
                border: "1px solid var(--bai-border)",
                color: "var(--bai-text-secondary)",
              }}
            />
          </label>
          <span
            className="ml-auto text-[11px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {chosen} of {sections.length} ticked ·{" "}
            <button
              type="button"
              className="review-link"
              onClick={() => onAll(true)}
              style={{ color: "var(--bai-accent)" }}
              disabled={published}
            >
              all
            </button>{" "}
            ·{" "}
            <button
              type="button"
              className="review-link"
              onClick={() => onAll(false)}
              style={{ color: "var(--bai-accent)" }}
              disabled={published}
            >
              none
            </button>
          </span>
        </div>
      </header>

      <ul
        className="scrollbar-thin min-h-0 space-y-1 overflow-auto px-4 py-3"
        style={{ maxHeight: "52vh" }}
      >
        {sections.map((section, index) => {
          const on = file.selected[index] === true;
          const isOpen = open.has(index);
          const furniture = !on && isLikelyFurniture(section.title);
          return (
            <li
              key={index}
              className="review-row rounded-lg px-3 py-2"
              style={{
                backgroundColor: "var(--bai-bg)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={published}
                  onChange={() => onToggle(index)}
                  className="mt-0.5 accent-[var(--bai-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-xs font-medium"
                    style={{
                      color: on
                        ? "var(--bai-text-secondary)"
                        : "var(--bai-text-muted)",
                    }}
                  >
                    {section.title || `part ${index + 1}`}
                  </span>
                  <span
                    className="block truncate text-[10px]"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {section.content.length.toLocaleString()} chars
                    {section.markdownRange ? "" : " · from text"}
                    {furniture
                      ? " · looks like furniture — left unticked, tick to keep"
                      : ""}
                  </span>
                  {section.mergedFrom.length > 1 && (
                    <span
                      className="block truncate text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      contains:{" "}
                      {section.mergedFrom.map((p) => p.title).join(" · ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => toggleOpen(index)}
                  title={
                    isOpen
                      ? "Hide the preview"
                      : "Show what this source will contain"
                  }
                  aria-expanded={isOpen}
                  className="review-toggle inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium"
                  style={{
                    color: isOpen
                      ? "var(--bai-accent)"
                      : "var(--bai-text-tertiary)",
                    border: "1px solid var(--bai-border)",
                    backgroundColor: isOpen
                      ? "var(--bai-accent-soft)"
                      : "transparent",
                  }}
                >
                  {isOpen ? "Hide" : "Preview"}
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{
                      transform: isOpen ? "rotate(180deg)" : undefined,
                      transition: "transform 120ms",
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {isOpen && (
                <div
                  className="ml-7 mt-2 rounded-r-lg py-2 pl-3.5 pr-3"
                  style={{
                    borderLeft: "2px solid var(--bai-border)",
                    backgroundColor: "var(--bai-surface)",
                  }}
                >
                  <div className="review-glimpse relative max-h-56 overflow-hidden text-xs">
                    <MarkdownPreview content={section.content} />
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
                      style={{
                        background:
                          "linear-gradient(transparent, var(--bai-surface))",
                      }}
                    />
                  </div>
                  <div
                    className="mt-1.5 flex items-center gap-3 text-[10px]"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    <button
                      type="button"
                      className="review-link font-medium"
                      onClick={() => setReader(index)}
                      style={{ color: "var(--bai-accent)" }}
                    >
                      ⤢ Read the whole part
                    </button>
                    <span>·</span>
                    <span>
                      {on
                        ? "ticked — will become a source"
                        : "unticked — tick above to keep it"}
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer
        className="flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ borderTop: "1px solid var(--bai-border)" }}
      >
        <button
          type="button"
          disabled={published || chosen === 0 || publishing || !canPublish}
          onClick={onPublish}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          {publishing
            ? "Adding…"
            : published
              ? `Added ${file.publishedIds?.length ?? 0} source${file.publishedIds?.length === 1 ? "" : "s"}`
              : `Add ${chosen} source${chosen === 1 ? "" : "s"} to the vault`}
        </button>
        <span
          className="text-[11px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          {published ? (
            "Already in the vault — publishing again would create duplicates."
          ) : (
            <>
              They land in{" "}
              <b
                className="font-medium"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                /sources/{file.folderName}/
              </b>
              , queued for extraction, each with the original{" "}
              {formatFileSize(file.size)} file attached.
            </>
          )}
        </span>
      </footer>

      {reader !== null && (
        <SectionReader
          file={file}
          index={reader}
          onIndex={setReader}
          onToggle={onToggle}
          onClose={() => setReader(null)}
        />
      )}
      <style>{`
        .review-row:hover { background-color: var(--bai-hover) !important; }
        .review-link:hover:not(:disabled) { text-decoration: underline; }
        .review-toggle:hover { border-color: var(--bai-accent) !important; color: var(--bai-accent) !important; }
        .review-input:focus { border-color: var(--bai-accent) !important; outline: none; }
        .review-glimpse .md-preview { font-size: 12px; }
      `}</style>
    </section>
  );
}
