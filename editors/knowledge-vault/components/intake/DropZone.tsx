import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { dragCarriesFiles, droppedFiles } from "./drop-files.js";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  formatUploadLimit,
} from "../../lib/intake-model.js";
import { FileIcon, PlusIcon } from "./intake-icons.js";
import { SectionStrip } from "./SectionStrip.js";

/**
 * The system file picker, for any button that adds files. Several at once is
 * always allowed; `accept` is what the converter reads.
 */
export function useFilePicker(
  accept: readonly string[],
  onFiles: (files: File[]) => void,
): { open: () => void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      accept={accept.map((f) => `.${f}`).join(",")}
      onChange={(e) => {
        // Copied before the input is cleared: clearing empties its FileList.
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) onFiles(files);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

/** Drag-over state and handlers for a target that takes files itself. */
function useDropTarget(disabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        if (!disabled) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!dragCarriesFiles(e.dataTransfer)) return;
        // Handled here: the vault-wide drop target leaves a prevented drop alone.
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        void droppedFiles(e.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      },
    },
  };
}

/** The drawing in the drop area: a file, and the sections it becomes — one left out. */
const DEMO_WEIGHTS = [3, 9, 7, 12, 8, 6, 10];
const DEMO_KEPT = [false, true, true, true, true, true, true];

/**
 * Where files come in. `hero` is the drop area of an empty Sources view and an
 * empty panel: a drawing of a file becoming sections, the drop line, the
 * picker and the limit. `row` is the last line of the file list — the door for
 * file N+1 — saying what is also true: a drop anywhere in the vault works.
 *
 * It only hands over `File`s. Checking them and reading their bytes happen in
 * the batch, so a pick of twenty files shows twenty rows at once.
 */
export function DropZone({
  accept,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  onFiles,
  variant,
  disabled = false,
}: {
  /** Extensions the converter reads (no dots). */
  accept: readonly string[];
  /** This vault's cap for one file (`convert/health`). */
  maxUploadBytes?: number;
  onFiles: (files: File[]) => void;
  variant: "hero" | "row";
  disabled?: boolean;
}) {
  const picker = useFilePicker(accept, onFiles);
  const drop = useDropTarget(disabled, onFiles);

  if (variant === "row") {
    return (
      <div
        className="ik-addrow"
        data-over={drop.over ? "" : undefined}
        {...drop.props}
      >
        <span className="ik-plus" aria-hidden="true">
          <PlusIcon />
        </span>
        <span>
          <button
            type="button"
            className="ik-link"
            onClick={picker.open}
            disabled={disabled}
          >
            Add more files
          </button>
          , or drop them anywhere in the vault
        </span>
        {picker.input}
      </div>
    );
  }

  return (
    <div
      className="ik-drop"
      data-over={drop.over ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      {...drop.props}
    >
      <div className="ik-drop-demo" aria-hidden="true">
        <FileIcon label="PDF" size="hero" />
        <span className="ik-drop-arrow" />
        <SectionStrip weights={DEMO_WEIGHTS} kept={DEMO_KEPT} />
      </div>
      <div className="ik-drop-title">Drop files here</div>
      <button
        type="button"
        className="ik-btn ik-btn-primary ik-btn-big"
        onClick={picker.open}
        disabled={disabled}
      >
        Choose files
      </button>
      <div className="ik-drop-small">
        Up to {formatUploadLimit(maxUploadBytes)} each. Several at once is fine.
      </div>
      {picker.input}
    </div>
  );
}
