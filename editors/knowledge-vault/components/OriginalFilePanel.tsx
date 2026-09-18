import { useRef, useEffect, useState } from "react";
import { formatFileSize, isBrowserRenderable } from "../lib/mime.js";

type OriginalSource = {
  originalFile?: string | null;
  originalFileName?: string | null;
  originalMimeType?: string | null;
  originalSizeBytes?: number | null;
  convertedBy?: string | null;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string; mimeType: string }
  | { kind: "failed"; message: string };

/**
 * The document a source was made from.
 *
 * Four states, all different to the user: no original (an older, pasted
 * source — renders nothing), renderable (PDF, text, markdown, image, audio,
 * video — inline), not renderable (a card with name, size, type and Download —
 * honest about what a browser can do), and failed (an explicit failure with
 * Retry — an original that cannot be fetched must never look like one that
 * is absent). `convertedBy` is shown because a reader is entitled to know what
 * produced the text they are reading. The original is not fetched until the
 * reader clicks "View original": a source editor opens to read the source, and
 * a 17 MB PDF should not ride along uninvited.
 *
 * A source with no original still gets a control, not silence: the intake's
 * publish step degrades gracefully when the attachment step fails (a source
 * with no original is a supported state — spec §12.1), which without this
 * would leave a converted source with no way to ever get one. `onAttach`
 * makes that state fixable rather than a dead end — mirrors
 * `SourceDocumentCard`'s no-document branch in the production-ledger editor.
 */
export function OriginalFilePanel({
  source,
  load,
  onAttach,
  attaching,
  attachError,
}: {
  source: OriginalSource;
  /** Resolves a ref to an object URL; the panel revokes it. */
  load: (ref: string) => Promise<{ url: string; mimeType: string }>;
  /** Present only when the caller can attach one — absent means read-only. */
  onAttach?: (file: File) => void;
  attaching?: boolean;
  attachError?: string;
}) {
  const ref = source.originalFile ?? null;
  const mime = source.originalMimeType ?? "application/octet-stream";
  const name = source.originalFileName ?? "original";
  const renderable = isBrowserRenderable(mime);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  // Closed by default: the card names the original; "View original" fetches
  // it through the attachment service and shows it. Bytes are only requested
  // when the user asks for them.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ref || !renderable || !open) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setState({ kind: "loading" });
    load(ref)
      .then((result) => {
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        url = result.url;
        setState({ kind: "ready", ...result });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ref, renderable, load, attempt, open]);

  const fileInput = useRef<HTMLInputElement>(null);

  if (!ref) {
    if (!onAttach) return null;
    return (
      <section
        className="rounded-xl p-3"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px dashed var(--bai-border)",
        }}
      >
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAttach(file);
            e.target.value = ""; // allow re-picking the same file after a failure
          }}
        />
        <div className="flex items-center gap-3">
          <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v5h5" />
          </svg>
          <span
            className="min-w-0 flex-1 text-xs"
            style={{ color: "var(--bai-text-muted)" }}
          >
            No original file attached — a source pasted as text has none; one
            that lost its attachment during conversion can get it back here.
          </span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={attaching}
            className="original-link shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            {attaching ? "Attaching…" : "Attach original file"}
          </button>
        </div>
        {attachError && (
          <p
            className="mt-2 text-[11px]"
            style={{ color: "var(--bai-danger)" }}
          >
            Could not attach it: {attachError}
          </p>
        )}
        <style>{`
          .original-link:hover { text-decoration: underline; }
        `}</style>
      </section>
    );
  }

  const download = () => {
    void load(ref)
      .then(({ url }) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        // Give the browser a beat to start the download before revoking.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch((error: unknown) =>
        setState({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  };

  return (
    <section
      className="rounded-xl p-3"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <header className="flex items-center gap-2">
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5M9 13h7M9 17h5" />
        </svg>
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{ color: "var(--bai-text-secondary)" }}
          title={name}
        >
          {name}
        </span>
        <span
          className="shrink-0 text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {mime}
          {source.originalSizeBytes
            ? ` · ${formatFileSize(source.originalSizeBytes)}`
            : ""}
          {source.convertedBy ? ` · converted by ${source.convertedBy}` : ""}
        </span>
        {renderable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium"
            style={{
              backgroundColor: open ? "var(--bai-hover)" : "var(--bai-accent)",
              color: open ? "var(--bai-accent)" : "var(--bai-accent-text)",
              border: open
                ? "1px solid var(--bai-border)"
                : "1px solid transparent",
            }}
            aria-expanded={open}
          >
            {open ? "Hide original" : "View original"}
          </button>
        )}
        <button
          type="button"
          onClick={download}
          className="original-link shrink-0 text-[11px] font-medium"
          style={{ color: "var(--bai-accent)" }}
        >
          Download
        </button>
      </header>

      {renderable && open && state.kind === "loading" && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          Loading the original…
        </p>
      )}
      {state.kind === "failed" && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          The original could not be fetched: {state.message}{" "}
          <button
            type="button"
            className="original-link font-medium"
            style={{ color: "var(--bai-accent)" }}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {renderable &&
        open &&
        state.kind === "ready" &&
        state.mimeType.includes("pdf") && (
          <iframe
            title={name}
            src={state.url}
            className="mt-2 w-full rounded"
            style={{ height: 520 }}
          />
        )}
      {renderable &&
        open &&
        state.kind === "ready" &&
        state.mimeType.startsWith("image/") && (
          <img
            alt={name}
            src={state.url}
            className="mt-2 rounded"
            style={{ maxHeight: 520 }}
          />
        )}
      {renderable &&
        open &&
        state.kind === "ready" &&
        !state.mimeType.includes("pdf") &&
        !state.mimeType.startsWith("image/") && (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="original-link mt-2 block text-[11px]"
            style={{ color: "var(--bai-accent)" }}
          >
            Open the original in a new tab
          </a>
        )}
      {!renderable && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          The browser cannot show this type inline — download it to open it.
        </p>
      )}
      <style>{`
        .original-link:hover { text-decoration: underline; }
      `}</style>
    </section>
  );
}
