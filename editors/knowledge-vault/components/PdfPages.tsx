import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

/** Pages drawn at once; a longer document says how many more there are (Download has them all). */
const MAX_PAGES = 50;

type Status = { kind: "loading" } | { kind: "ready"; pages: number; shown: number } | { kind: "failed"; message: string };

/**
 * A PDF drawn page by page with pdf.js, for browsers with no PDF viewer of their own
 * (the desktop app's WebKitGTK window). Each page is a canvas at the panel's width,
 * sharp on high-DPI screens. pdf.js's worker code runs in the page: a separate worker
 * file cannot be located reliably from inside a library bundle.
 */
export function PdfPages({ url, name }: { url: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setStatus({ kind: "loading" });
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) await import("pdfjs-dist/build/pdf.worker.min.mjs");
      task = pdfjs.getDocument({ url });
      const doc = await task.promise;
      const container = box.current;
      if (cancelled || !container) return;
      container.replaceChildren();
      const width = Math.max(320, container.clientWidth - 24);
      const ratio = window.devicePixelRatio || 1;
      const shown = Math.min(doc.numPages, MAX_PAGES);
      for (let n = 1; n <= shown; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto 12px";
        canvas.style.background = "#fff";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${name}, page ${n} of ${doc.numPages}`);
        container.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
      if (!cancelled) setStatus({ kind: "ready", pages: doc.numPages, shown });
    })().catch((error: unknown) => {
      if (!cancelled) setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, name]);

  return (
    <div className="w-full rounded" style={{ height: "70vh", overflow: "auto", padding: 12, background: "var(--bai-surface-2, rgba(0,0,0,0.25))" }}>
      <div ref={box} />
      {status.kind === "loading" && (
        <p className="text-[12.5px]" style={{ color: "var(--bai-text-faint)" }}>
          Drawing the pages…
        </p>
      )}
      {status.kind === "ready" && status.shown < status.pages && (
        <p className="text-[12.5px] text-center" style={{ color: "var(--bai-text-faint)" }}>
          Showing the first {status.shown} of {status.pages} pages — Download has the whole document.
        </p>
      )}
      {status.kind === "failed" && (
        <p className="text-[12.5px]" style={{ color: "var(--bai-text-muted)" }}>
          This PDF could not be drawn here: {status.message}. Download it to open it.
        </p>
      )}
    </div>
  );
}
