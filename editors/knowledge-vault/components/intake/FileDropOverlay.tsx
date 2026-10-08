import { useEffect, useRef, useState, type DragEvent } from "react";
import { dragCarriesFiles, droppedFiles } from "./drop-files.js";

/**
 * Drop files anywhere in the vault: the whole window becomes the drop target
 * the moment a file is dragged in, and says where the file will go before it
 * is let go.
 *
 * `data-accepts-files` on the vault's root is Connect's opt-out: without it,
 * Connect's own drop handler — which imports `.phd`/`.zip` documents — claims
 * every file dragged over the editor, and ours never sees the drop. A nested
 * element that carries the same attribute (a hosted editor with its own file
 * drop) is left alone.
 */

const hasFiles = (e: DragEvent) => dragCarriesFiles(e.dataTransfer);

/** The drag is over someone else's file drop — a hosted editor that takes files itself. */
function ownedElsewhere(e: DragEvent): boolean {
  const target = e.target;
  if (!(target instanceof Element)) return false;
  const zone = target.closest("[data-accepts-files]");
  return (
    zone !== null &&
    zone !== e.currentTarget &&
    !zone.hasAttribute("data-vault-drop")
  );
}

/**
 * Some platforms miss the final `dragleave` (a drag cancelled outside the
 * window); `dragover` repeats every few hundred milliseconds while a drag is
 * over the page, so its silence means the drag is gone.
 */
const STALE_DRAG_MS = 1500;

export function useVaultFileDrop({
  ready,
  onDrop,
}: {
  /** The converter can take files; otherwise the drop is refused and the overlay says why. */
  ready: boolean;
  onDrop: (files: File[]) => void;
}) {
  const [active, setActive] = useState(false);
  const stale = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (stale.current) clearTimeout(stale.current);
    },
    [],
  );

  function hold() {
    if (stale.current) clearTimeout(stale.current);
    stale.current = setTimeout(() => setActive(false), STALE_DRAG_MS);
  }
  function end() {
    if (stale.current) clearTimeout(stale.current);
    stale.current = null;
    setActive(false);
  }

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e) || ownedElsewhere(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = ready ? "copy" : "none";
    setActive(true);
    hold();
  }

  return {
    active,
    rootProps: {
      "data-accepts-files": "",
      onDragEnter: onDragOver,
      onDragOver,
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e) || e.defaultPrevented || ownedElsewhere(e)) return;
        e.preventDefault();
        end();
        if (ready)
          void droppedFiles(e.dataTransfer).then((files) => {
            if (files.length > 0) onDrop(files);
          });
      },
    },
    /** For the overlay: it is the only hit target while shown, so leaving it is leaving the window. */
    onLeave: (e: DragEvent) => {
      if (e.target === e.currentTarget) end();
    },
  };
}

/** The extensions people recognise first, in that order; the rest are counted. */
const FAMILIAR = ["pdf", "docx", "html", "md", "epub", "pptx", "txt"];

function formatsLine(formats: readonly string[]): string {
  const known = new Set(formats.map((f) => f.toLowerCase()));
  const named = FAMILIAR.filter((f) => known.has(f)).slice(0, 4);
  const rest = known.size - named.length;
  const list = named.map((f) => f.toUpperCase()).join(", ");
  if (named.length === 0) return `${known.size} formats, up to 30 MB a file.`;
  return rest > 0
    ? `${list} and ${rest} more format${rest === 1 ? "" : "s"}, up to 30 MB a file.`
    : `${list}, up to 30 MB a file.`;
}

export function FileDropOverlay({
  ready,
  settled,
  formats,
  inBatch,
  onLeave,
}: {
  ready: boolean;
  settled: boolean;
  formats: readonly string[];
  /** Files already in the batch and not yet in the vault. */
  inBatch: number;
  onLeave: (e: DragEvent) => void;
}) {
  const headline = ready
    ? "Drop to add sources"
    : settled
      ? "This vault can't convert files yet"
      : "Checking what this vault can convert…";
  const body = ready
    ? inBatch > 0
      ? `Dropped files join the ${inBatch} already in the batch and convert in turn, in the background.`
      : "Each file converts in the background. You choose which parts become sources; nothing is written before you approve."
    : settled
      ? "Conversion isn't set up for this vault. You can still paste text from Sources."
      : "One moment — then drop again.";

  return (
    <div
      data-vault-drop=""
      data-accepts-files=""
      onDragLeave={onLeave}
      className="vault-drop-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        padding: 16,
        backgroundColor: "color-mix(in srgb, var(--bai-bg) 80%, transparent)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        className="vault-drop-frame"
        style={{
          pointerEvents: "none",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          borderRadius: 20,
          border: `2px dashed ${ready ? "var(--bai-accent)" : "var(--bai-border)"}`,
          backgroundColor: ready
            ? "color-mix(in srgb, var(--bai-accent) 7%, transparent)"
            : "transparent",
          textAlign: "center",
        }}
      >
        <svg
          aria-hidden="true"
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: ready ? "var(--bai-accent)" : "var(--bai-text-faint)",
          }}
        >
          <path d="M12 3v11" />
          <path d="M7.5 9.5L12 14l4.5-4.5" />
          <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
        </svg>
        <p
          role="status"
          className="text-xl font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {headline}
        </p>
        <p
          className="text-sm"
          style={{ color: "var(--bai-text-tertiary)", maxWidth: "26rem" }}
        >
          {body}
        </p>
        {ready && formats.length > 0 && (
          <p className="text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
            {formatsLine(formats)}
          </p>
        )}
      </div>
      <style>{`
        .vault-drop-frame { animation: vault-drop-in 140ms ease-out; }
        @keyframes vault-drop-in {
          from { opacity: 0; transform: scale(0.985); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vault-drop-frame { animation: none; }
        }
      `}</style>
    </div>
  );
}
