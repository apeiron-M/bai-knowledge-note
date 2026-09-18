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

const LINK_STYLE = `
  .original-link:hover { text-decoration: underline; }
`;

/**
 * The document a source was made from, as one row in the source's header.
 *
 * Four states, all different to the user: **no original** (an older, pasted
 * source, or a conversion whose attachment step failed — an Attach control,
 * never silence), **renderable** (PDF, text, markdown, image, audio, video —
 * `onView` opens it), **not renderable** (name, size, type and Download —
 * honest about what a browser can do), and **failed** (an explicit failure
 * with Retry, because an original that cannot be fetched must never look like
 * one that is absent). `convertedBy` is shown because a reader is entitled to
 * know what produced the text they are reading.
 *
 * The bytes are not fetched here: a source editor opens to read the source,
 * and a 17 MB PDF should not ride along uninvited. `onView` hands that to
 * whoever hosts the viewer — in the source editor, an overlay over the page,
 * so the original never pushes the text down.
 */
export function OriginalFileRow({
  source,
  load,
  onView,
  onAttach,
  attaching,
  attachError,
}: {
  source: OriginalSource;
  /** Resolves a ref to an object URL; used for Download, which revokes it. */
  load: (ref: string) => Promise<{ url: string; mimeType: string }>;
  /** Opens the viewer. Absent means the row offers Download only. */
  onView?: () => void;
  /** Present only when the caller can attach one — absent means read-only. */
  onAttach?: (file: File) => void;
  attaching?: boolean;
  attachError?: string;
}) {
  const ref = source.originalFile ?? null;
  const mime = source.originalMimeType ?? "application/octet-stream";
  const name = source.originalFileName ?? "original";
  const renderable = isBrowserRenderable(mime);
  const fileInput = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rowStyle = {
    backgroundColor: "var(--bai-deep)",
    border: `1px ${ref ? "solid" : "dashed"} var(--bai-border)`,
  };

  if (!ref) {
    if (!onAttach) return null;
    return (
      <div className="mt-4 rounded-[10px] px-4 py-3" style={rowStyle}>
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
          <FileIcon />
          <span
            className="min-w-0 flex-1 text-[12.5px]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            No original attached — an older pasted source, or a conversion whose
            attachment step failed.
          </span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={attaching}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            {attaching ? "Attaching…" : "Attach file…"}
          </button>
        </div>
        {attachError && (
          <p
            className="mt-2 text-[11.5px]"
            style={{ color: "var(--bai-danger)" }}
          >
            Could not attach it: {attachError}
          </p>
        )}
      </div>
    );
  }

  const download = () => {
    setFailure(null);
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
        setFailure(error instanceof Error ? error.message : String(error)),
      );
  };

  return (
    <div className="mt-4 rounded-[10px] px-4 py-3" style={rowStyle}>
      <div className="flex items-center gap-3">
        <FileIcon />
        <span
          className="min-w-0 shrink truncate text-[13px]"
          style={{ color: "var(--bai-text-secondary)" }}
          title={name}
        >
          {name}
        </span>
        <span
          className="min-w-0 shrink truncate text-[11.5px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {mime}
          {source.originalSizeBytes
            ? ` · ${formatFileSize(source.originalSizeBytes)}`
            : ""}
          {source.convertedBy ? ` · converted by ${source.convertedBy}` : ""}
        </span>
        <span className="flex-1" />
        {renderable && onView && (
          <button
            type="button"
            onClick={onView}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            View original
          </button>
        )}
        <button
          type="button"
          onClick={download}
          className="original-link shrink-0 rounded-lg px-3 py-1.5 text-[12.5px]"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Download
        </button>
      </div>
      {!renderable && (
        <p
          className="mt-2 text-[11.5px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          The browser cannot show this type inline — download it to open it.
        </p>
      )}
      {failure && (
        <p
          className="mt-2 text-[11.5px]"
          style={{ color: "var(--bai-text-muted)" }}
        >
          The original could not be fetched: {failure}
        </p>
      )}
      <style>{LINK_STYLE}</style>
    </div>
  );
}

/**
 * The original itself. Fetches on mount — it is only mounted once the reader
 * has asked for it — and revokes the object URL when it goes away.
 */
export function OriginalFileViewer({
  source,
  load,
}: {
  source: OriginalSource;
  load: (ref: string) => Promise<{ url: string; mimeType: string }>;
}) {
  const ref = source.originalFile ?? null;
  const mime = source.originalMimeType ?? "application/octet-stream";
  const name = source.originalFileName ?? "original";
  const renderable = isBrowserRenderable(mime);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ref || !renderable) {
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
  }, [ref, renderable, load, attempt]);

  if (!ref) return null;
  if (!renderable)
    return (
      <p className="text-[12.5px]" style={{ color: "var(--bai-text-faint)" }}>
        The browser cannot show {mime} inline — download it to open it.
      </p>
    );
  if (state.kind === "loading" || state.kind === "idle")
    return (
      <p className="text-[12.5px]" style={{ color: "var(--bai-text-faint)" }}>
        Loading the original…
      </p>
    );
  if (state.kind === "failed")
    return (
      <p className="text-[12.5px]" style={{ color: "var(--bai-text-muted)" }}>
        The original could not be fetched: {state.message}{" "}
        <button
          type="button"
          className="original-link font-medium"
          style={{ color: "var(--bai-accent)" }}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Retry
        </button>
        <style>{LINK_STYLE}</style>
      </p>
    );
  if (state.mimeType.includes("pdf"))
    return (
      <iframe
        title={name}
        src={state.url}
        className="w-full rounded"
        style={{ height: "70vh", border: 0 }}
      />
    );
  if (state.mimeType.startsWith("image/"))
    return (
      <img
        alt={name}
        src={state.url}
        className="mx-auto rounded"
        style={{ maxHeight: "70vh" }}
      />
    );
  return (
    <a
      href={state.url}
      target="_blank"
      rel="noreferrer"
      className="original-link block text-[12.5px]"
      style={{ color: "var(--bai-accent)" }}
    >
      Open the original in a new tab
      <style>{LINK_STYLE}</style>
    </a>
  );
}

function FileIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--bai-text-muted)" }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
