import { useCallback, useState } from "react";

const SEEN_KEY = "bai.intake.split-explained";

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the user has already been told how a file becomes several sources.
 * Remembered per browser: the explanation opens by itself once, at the first
 * review, and stays one click away after that.
 */
export function useSplitExplainer() {
  const [open, setOpen] = useState(() => !readSeen());
  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode: it simply opens again next time.
    }
  }, []);
  return { open, show: useCallback(() => setOpen(true), []), dismiss };
}

/** Up to five part tiles, then "+N": the shape of the split, not an inventory. */
const MAX_TILES = 5;

/**
 * One file in, several sources out — said once, in plain words, at the moment
 * the user first sees their file in pieces and wonders why.
 *
 * Every claim here is what the converter and the pipeline actually do: the
 * cut follows the file's own headings; a piece under about a page folds into
 * its neighbour and a very long one is cut again; each source is turned into
 * notes on its own; the original is attached to every source; and the parts
 * land together in `/sources/<folder>/`.
 */
export function SplitExplainer({
  fileName,
  parts,
  folderName,
  onDismiss,
}: {
  fileName: string;
  parts: number;
  folderName: string;
  onDismiss: () => void;
}) {
  const tiles = Math.min(parts, MAX_TILES);
  const more = parts - tiles;
  return (
    <aside
      aria-label="How one file becomes several sources"
      className="mt-3 rounded-lg px-3.5 py-3"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bai-accent) 7%, var(--bai-bg))",
        border:
          "1px solid color-mix(in srgb, var(--bai-accent) 30%, var(--bai-border))",
      }}
    >
      <div className="flex items-start gap-3">
        <h4
          className="min-w-0 flex-1 text-xs font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {parts > 1
            ? `Why one file becomes ${parts} sources`
            : "How a file becomes sources"}
        </h4>
        <button
          type="button"
          onClick={onDismiss}
          className="split-ok shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium"
          style={{
            color: "var(--bai-accent)",
            border:
              "1px solid color-mix(in srgb, var(--bai-accent) 45%, var(--bai-border))",
          }}
        >
          Got it
        </button>
      </div>

      {/* The split, drawn: this file, its parts, the folder they land in. */}
      <div
        className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]"
        aria-hidden="true"
      >
        <span
          className="max-w-[12rem] truncate rounded-md px-2 py-1 font-medium"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
            color: "var(--bai-text-secondary)",
          }}
          title={fileName}
        >
          {fileName}
        </span>
        <span style={{ color: "var(--bai-text-tertiary)" }}>→</span>
        <span className="flex items-center gap-1">
          {Array.from({ length: tiles }, (_, i) => (
            <span
              key={i}
              className="block h-5 w-4 rounded-sm"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--bai-accent) 35%, var(--bai-surface))",
                border:
                  "1px solid color-mix(in srgb, var(--bai-accent) 55%, transparent)",
              }}
            />
          ))}
          {more > 0 && (
            <span
              className="pl-0.5 font-medium"
              style={{ color: "var(--bai-text-secondary)" }}
            >
              +{more}
            </span>
          )}
        </span>
        <span style={{ color: "var(--bai-text-tertiary)" }}>→</span>
        <span
          className="max-w-[14rem] truncate font-medium"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          /sources/{folderName}/
        </span>
      </div>

      <p
        className="mt-2.5 text-[12px] leading-relaxed"
        style={{ color: "var(--bai-text-secondary)" }}
      >
        {parts > 1
          ? `We cut the file where its own chapters and headings begin. Each part you keep becomes one source.`
          : `This file has no chapters to cut at, so it stays whole: one part, one source. A longer file is cut where its chapters begin, and each part becomes its own source.`}
      </p>
      <ul
        className="mt-1.5 space-y-1 text-[12px] leading-relaxed"
        style={{ color: "var(--bai-text-tertiary)" }}
      >
        <li>
          <b
            className="font-medium"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Better notes.
          </b>{" "}
          The vault makes notes from one source at a time. A chapter can be read
          closely; a whole book at once cannot.
        </li>
        <li>
          <b
            className="font-medium"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Easier to find.
          </b>{" "}
          Every note points back to the part it came from, so you land on the
          right chapter instead of page one of a book.
        </li>
        <li>
          <b
            className="font-medium"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Your choice.
          </b>{" "}
          Untick anything not worth keeping. Contents pages, indexes and
          acknowledgements start unticked. Pieces shorter than about a page are
          joined to the part next to them.
        </li>
        <li>
          <b
            className="font-medium"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Nothing is lost.
          </b>{" "}
          The original file is attached to every source, and all the parts stay
          together in one folder named after the file.
        </li>
      </ul>
      <style>{`
        .split-ok { transition: background-color 120ms ease; }
        .split-ok:hover { background-color: color-mix(in srgb, var(--bai-accent) 14%, transparent); }
        .split-ok:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
      `}</style>
    </aside>
  );
}
