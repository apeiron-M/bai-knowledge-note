import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { IntakeFile } from "../../lib/intake-model.js";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";

/**
 * The whole of one part, full screen — the one way to read all of it.
 *
 * The app's modal pattern: a fixed, dimmed click-catcher and a surface panel.
 * The tick sits in the header so the decision can be made while reading; ← / →
 * walk to the neighbouring parts so a book reads straight through; Esc, ✕,
 * "Back to review" or a click outside return to the review exactly as it was —
 * an overlay never touches the view behind it.
 *
 * Rendered through a portal onto `document.body`: inside the review pane it
 * would sit in the Sources list's stacking context, and the list's own
 * positioned elements (the filter bar) painted over it.
 */
export function SectionReader({
  file,
  index,
  onIndex,
  onToggle,
  onClose,
}: {
  file: IntakeFile;
  index: number;
  onIndex: (next: number) => void;
  onToggle: (index: number) => void;
  onClose: () => void;
}) {
  const sections = file.converted?.sections ?? [];
  // `index` comes from the caller and may run past the end after a re-render.
  const section = sections.at(index);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < sections.length - 1)
        onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, sections.length, onClose, onIndex]);

  if (!section) return null;
  const ticked = file.selected[index] === true;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 100 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 flex flex-col rounded-2xl shadow-2xl"
        style={{
          height: "min(88vh, 1000px)",
          width: "min(960px, 92vw)",
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <header
          className="flex items-start gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--bai-border)" }}
        >
          <div className="min-w-0 flex-1">
            <h3
              className="truncate text-base font-semibold"
              style={{ color: "var(--bai-text)" }}
            >
              {section.title || `part ${index + 1}`}
            </h3>
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--bai-text-faint)" }}
            >
              {file.folderName} ›{" "}
              <b
                className="font-medium"
                style={{ color: "var(--bai-text-muted)" }}
              >
                {section.title || `part ${index + 1}`}
              </b>
              {" · "}part {index + 1} of {sections.length} ·{" "}
              {section.content.length.toLocaleString()} chars
              {section.mergedFrom.length > 1
                ? ` · contains: ${section.mergedFrom.map((p) => p.title).join(" · ")}`
                : ""}
            </p>
          </div>
          <label
            className="inline-flex shrink-0 items-center gap-2 text-xs"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            <input
              type="checkbox"
              checked={ticked}
              onChange={() => onToggle(index)}
              className="accent-[var(--bai-accent)]"
            />
            becomes a source
          </label>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="reader-x shrink-0 rounded-md px-1.5 text-base"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            ✕
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="text-sm leading-relaxed" style={{ maxWidth: "72ch" }}>
            <MarkdownPreview content={section.content} />
          </div>
        </div>
        <footer
          className="flex items-center gap-3 px-5 py-3 text-[11px]"
          style={{
            borderTop: "1px solid var(--bai-border)",
            color: "var(--bai-text-muted)",
          }}
        >
          <span>
            This is the source's content exactly as it will be written — tables
            intact.
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
              className="reader-btn rounded-lg px-2.5 py-1 disabled:opacity-40"
              style={{
                color: "var(--bai-accent)",
                border: "1px solid var(--bai-border)",
              }}
            >
              ← previous part
            </button>
            <button
              type="button"
              disabled={index >= sections.length - 1}
              onClick={() => onIndex(index + 1)}
              className="reader-btn rounded-lg px-2.5 py-1 disabled:opacity-40"
              style={{
                color: "var(--bai-accent)",
                border: "1px solid var(--bai-border)",
              }}
            >
              next part →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="reader-btn rounded-lg px-2.5 py-1"
              style={{
                backgroundColor: "var(--bai-hover)",
                color: "var(--bai-accent)",
                border: "1px solid var(--bai-border)",
              }}
            >
              Back to review
            </button>
          </div>
        </footer>
        <style>{`
          .reader-x:hover { background-color: var(--bai-hover); }
          .reader-btn:hover:not(:disabled) { border-color: var(--bai-accent) !important; }
        `}</style>
      </div>
    </div>,
    document.body,
  );
}
