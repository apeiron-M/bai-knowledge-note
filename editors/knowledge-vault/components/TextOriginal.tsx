import { useEffect, useState } from "react";
import { MarkdownPreview } from "../../shared/markdown-preview.js";

/** Characters shown inline; a longer file says so (Download has all of it). */
const MAX_CHARS = 2_000_000;

/** A text or markdown original, read from its object URL and shown in the panel. */
export function TextOriginal({ url, markdown }: { url: string; markdown: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error)
    return (
      <p className="text-[12.5px]" style={{ color: "var(--bai-text-muted)" }}>
        This file could not be read here: {error}. Download it to open it.
      </p>
    );
  if (text === null)
    return (
      <p className="text-[12.5px]" style={{ color: "var(--bai-text-faint)" }}>
        Reading the file…
      </p>
    );
  const shown = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  return (
    <div className="w-full rounded" style={{ maxHeight: "70vh", overflow: "auto", padding: 16, background: "var(--bai-surface-2, rgba(0,0,0,0.25))" }}>
      {markdown ? (
        <MarkdownPreview content={shown} />
      ) : (
        <pre className="text-[13px]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "var(--bai-text)" }}>
          {shown}
        </pre>
      )}
      {shown.length < text.length && (
        <p className="text-[12.5px] text-center" style={{ color: "var(--bai-text-faint)" }}>
          Showing the first part of a long file — Download has all of it.
        </p>
      )}
    </div>
  );
}
