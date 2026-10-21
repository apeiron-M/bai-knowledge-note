import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";
import { sectionPieces } from "../../lib/intake-attachments.js";
import { isBrowserHost } from "../../../shared/host-config.js";
import { aiWorkLine } from "../../../shared/pipeline-words.js";
import {
  SECTION_TYPES,
  aboutEstimate,
  displayName,
  fileFacts,
  isLikelyFurniture,
  readingTime,
  reviewNotes,
  selectedCount,
  sourceTypeWords,
  withoutOwnHeading,
  type ConversionFigure,
  type IntakeFile,
  type Section,
} from "../../lib/intake-model.js";
import { formatFileSize } from "../../lib/mime.js";
import { ChevronIcon, InfoIcon, WarnIcon, XIcon } from "./intake-icons.js";
import { IntakeStyles } from "./intake-styles.js";
import { SectionStrip } from "./SectionStrip.js";

export type ReviewProps = {
  file: IntakeFile;
  /** The file being added right now, if any — one at a time. */
  publishingId: string | null;
  /** The vault can take sources (a drive is selected). */
  canPublish: boolean;
  onClose: () => void;
  onToggle: (index: number) => void;
  onAll: (on: boolean) => void;
  onType: (type: string) => void;
  onFolderName: (name: string) => void;
  onPublish: () => void;
  /** Read the file as a scan instead — offered when its layout could not be read. */
  onRunOcr?: () => void;
};

/**
 * Checking one file before it is added: a panel from the right, over the list,
 * that closes back to it (Esc, ×, or a click outside). Sections on the left,
 * the one clicked on the right, like a mail client; the file's bar on top as
 * a map with the section being read lit. Through a portal, so the Sources
 * list's own positioned elements never paint over it.
 */
export function ReviewPanel(props: ReviewProps) {
  return createPortal(<ReviewOverlay {...props} />, document.body);
}

function ReviewOverlay(props: ReviewProps) {
  const { onClose } = props;
  const sheetRef = useRef<HTMLDivElement>(null);

  // Into the panel when it opens; back to whatever opened it when it closes.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    sheetRef.current?.querySelector<HTMLElement>("h2")?.focus();
    return () => opener?.focus();
  }, []);

  // Esc closes; Tab stays inside the panel.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const sheet = sheetRef.current;
      if (e.key !== "Tab" || !sheet) return;
      const focusables = [
        ...sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled])',
        ),
      ];
      const first = focusables.at(0);
      const last = focusables.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (!sheet.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (
        e.shiftKey &&
        (active === first || active === sheet.querySelector("h2"))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="bai-intake ik-review">
      <IntakeStyles />
      <div className="ik-scrim" onClick={onClose} />
      <ReviewSheet {...props} sheetRef={sheetRef} />
    </div>
  );
}

const titleOf = (section: Section, index: number) =>
  section.title.trim() || `Section ${index + 1}, no heading`;

/** "A, B and C". */
const listOf = (items: readonly string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** The panel itself, without the portal and focus handling — what the tests render. */
export function ReviewSheet({
  file,
  publishingId,
  canPublish,
  onClose,
  onToggle,
  onAll,
  onType,
  onFolderName,
  onPublish,
  onRunOcr,
  sheetRef,
}: ReviewProps & { sheetRef?: Ref<HTMLDivElement> }) {
  const sections = file.converted?.sections ?? [];
  const figures = file.converted?.figures ?? [];
  // Opens on the first section that is kept: what will be added, first.
  const [current, setCurrent] = useState(() =>
    Math.max(0, file.selected.indexOf(true)),
  );
  const [editing, setEditing] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const index = Math.min(current, Math.max(0, sections.length - 1));
  const section = sections.at(index);
  const kept = selectedCount(file);
  const all = sections.length > 0 && kept === sections.length;
  const some = kept > 0 && !all;
  const notes = reviewNotes(file);
  const adding = publishingId === file.id;
  const folder = file.folderName.trim();
  const kind = sourceTypeWords(file.sourceType);
  const blocked = !canPublish
    ? "This vault can't take new sources right now."
    : kept === 0
      ? "Keep at least one section to add this file."
      : !folder
        ? "Give the folder a name."
        : null;

  // A section opens at its top.
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
  }, [index]);

  // "All sections" shows a dash when only some are kept.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);

  const go = (next: number) =>
    setCurrent(Math.min(sections.length - 1, Math.max(0, next)));

  // ↑ / ↓ walk the sections from anywhere in the list.
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = Math.min(
      sections.length - 1,
      Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)),
    );
    go(next);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>(".ik-sec-title")
      [next]?.focus();
  };

  return (
    <div
      ref={sheetRef}
      className="ik-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ik-review-title"
    >
      <header className="ik-shead">
        <div className="ik-shead-top">
          <h2 id="ik-review-title" tabIndex={-1}>
            {displayName(file.name)}
          </h2>
          <button
            type="button"
            className="ik-x"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <XIcon />
          </button>
        </div>
        <p className="ik-lead">
          {sections.length > 1
            ? `Split at its headings into ${sections.length} sections. Each section you keep becomes one source.`
            : "It has no headings to split at, so it stays whole: one section, one source."}
        </p>
        {isBrowserHost() && kept > 0 && <p className="ik-lead">{aiWorkLine(kept)}</p>}
        <p className="ik-meta">{fileFacts(file, formatFileSize(file.size))}</p>
        {notes.map((note) => (
          <div
            key={note.short}
            className="ik-callout"
            data-tone={note.tone}
            role="note"
          >
            {note.tone === "warn" ? <WarnIcon /> : <InfoIcon />}
            <span>
              {note.long}
              {file.converted?.textSource === "pdfjs" &&
                note.short === "Read without its layout" &&
                file.converted.ocrOffer &&
                onRunOcr && (
                  <button
                    type="button"
                    className="ik-link"
                    onClick={onRunOcr}
                    title="Reading the pages as images brings tables and lists back, but it can misread digits, so check every number."
                  >
                    Read it as a scan instead (
                    {aboutEstimate(file.converted.ocrOffer.estimateSeconds)})
                  </button>
                )}
            </span>
          </div>
        ))}
        {sections.length > 1 && (
          <SectionStrip
            weights={sections.map((s) => s.content.length)}
            kept={file.selected}
            size="map"
            here={index}
            onPick={go}
          />
        )}
      </header>

      <div className="ik-sbody">
        <div
          className="ik-slist scrollbar-thin"
          ref={listRef}
          onKeyDown={onListKey}
        >
          <label className="ik-all">
            <input
              ref={allRef}
              type="checkbox"
              checked={all}
              onChange={() => onAll(!all)}
            />
            <b>All sections</b>
            <span>{kept} kept</span>
          </label>
          {sections.map((s, i) => {
            const on = file.selected[i] === true;
            return (
              <div
                key={i}
                className="ik-sec"
                data-here={i === index ? "" : undefined}
                data-off={on ? undefined : ""}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(i)}
                  aria-label={`Keep ${titleOf(s, i)}`}
                />
                <button
                  type="button"
                  className="ik-sec-title"
                  onClick={() => go(i)}
                  aria-current={i === index ? "true" : undefined}
                >
                  {titleOf(s, i)}
                  {!on && file.alreadyIn?.[i] === true ? (
                    <span className="ik-why">
                      Already in the vault, so it starts left out
                    </span>
                  ) : (
                    !on &&
                    isLikelyFurniture(s.title) && (
                      <span className="ik-why">
                        Usually skipped, so it starts left out
                      </span>
                    )
                  )}
                </button>
                <span className="ik-sec-time">
                  {readingTime(s.content.length)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="ik-reader scrollbar-thin" ref={readerRef}>
          {section ? (
            <>
              <div className="ik-rtop">
                <h3>{titleOf(section, index)}</h3>
                <label className="ik-keep">
                  <input
                    type="checkbox"
                    checked={file.selected[index] === true}
                    onChange={() => onToggle(index)}
                  />
                  Keep
                </label>
                <div className="ik-stepper">
                  <button
                    type="button"
                    className="ik-x"
                    disabled={index === 0}
                    onClick={() => go(index - 1)}
                    aria-label="Previous section"
                  >
                    <ChevronIcon dir="left" />
                  </button>
                  {index + 1} of {sections.length}
                  <button
                    type="button"
                    className="ik-x"
                    disabled={index >= sections.length - 1}
                    onClick={() => go(index + 1)}
                    aria-label="Next section"
                  >
                    <ChevronIcon dir="right" />
                  </button>
                </div>
              </div>
              {section.mergedFrom.length > 1 && (
                <p className="ik-joined">
                  Joined from {section.mergedFrom.length} shorter sections:{" "}
                  {listOf(section.mergedFrom.map((p) => p.title))}.
                </p>
              )}
              <SectionContent section={section} figures={figures} />
            </>
          ) : (
            <p className="ik-joined">This file has nothing to read.</p>
          )}
        </div>
      </div>

      <footer className="ik-sfoot">
        <div className="ik-where">
          {editing ? (
            <div className="ik-dest">
              <label>
                Folder
                <input
                  type="text"
                  value={file.folderName}
                  onChange={(e) => onFolderName(e.target.value)}
                />
              </label>
              <label>
                Kind
                <select
                  value={file.sourceType}
                  onChange={(e) => onType(e.target.value)}
                >
                  {SECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {sourceTypeWords(type).one}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ik-link"
                onClick={() => setEditing(false)}
              >
                Done
              </button>
            </div>
          ) : (
            <div>
              Goes to{" "}
              <span className="ik-crumb">
                Sources › {folder || "(no name)"}
              </span>{" "}
              as {kind.many}.{" "}
              <button
                type="button"
                className="ik-link"
                onClick={() => setEditing(true)}
              >
                Change
              </button>
            </div>
          )}
          {file.publishError ? (
            <div className="ik-error" role="alert">
              Couldn't add it: {file.publishError}
            </div>
          ) : (
            <div>
              Nothing is added until you click Add. The original file stays
              attached to every source.
            </div>
          )}
        </div>
        <button
          type="button"
          className="ik-btn ik-btn-primary ik-btn-big"
          disabled={blocked !== null || publishingId !== null}
          onClick={onPublish}
          title={blocked ?? undefined}
        >
          {adding
            ? "Adding…"
            : kept === 0
              ? "Add"
              : `Add ${kept} source${kept === 1 ? "" : "s"}`}
        </button>
      </footer>
    </div>
  );
}

/**
 * One section as it will be written: its text, and its figures where the
 * source will carry them — the pictures themselves, not a note that one is
 * there.
 */
function SectionContent({
  section,
  figures,
}: {
  section: Section;
  figures: readonly ConversionFigure[];
}) {
  // The section's own heading is already the reader's title: shown once.
  const pieces = useMemo(
    () =>
      sectionPieces(
        {
          ...section,
          content: withoutOwnHeading(section.content, section.title),
        },
        figures,
      ),
    [section, figures],
  );
  return (
    <div className="ik-content">
      {pieces.map((piece, i) =>
        piece.kind === "text" ? (
          <MarkdownPreview key={i} content={piece.markdown} />
        ) : (
          <figure key={i} className="ik-figure" data-kind={piece.figure.kind}>
            <img
              src={`data:${piece.figure.mimeType};base64,${piece.figure.bytesBase64}`}
              alt={
                piece.figure.alt ||
                (piece.figure.kind === "formula" ? "Formula" : "Figure")
              }
              loading="lazy"
              draggable={false}
            />
            {piece.figure.kind === "picture" && (
              <figcaption>Kept as an image</figcaption>
            )}
          </figure>
        ),
      )}
    </div>
  );
}
