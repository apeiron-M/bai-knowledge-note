/**
 * Whether the browser draws a PDF inside a frame by itself. Chrome, Firefox and Safari do
 * and say so (`navigator.pdfViewerEnabled`); WebKitGTK — the desktop app's window on Linux —
 * has no PDF viewer and leaves the frame blank, so the vault draws the pages with pdf.js.
 */
export function browserShowsPdfInline(nav: { pdfViewerEnabled?: boolean } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return nav?.pdfViewerEnabled === true;
}

export type OriginalKind = "pdf-frame" | "pdf-pages" | "image" | "audio" | "video" | "markdown" | "text" | "none";

/**
 * How the source viewer shows an original, inline in every case it can: a PDF through the
 * browser's own viewer where there is one, else drawn by pdf.js; images, audio and video
 * with their elements; text and markdown read and shown in the panel (a new tab of a blob
 * opens nowhere in the desktop app, and was an awkward detour on the web).
 */
export function originalKind(mimeType: string, pdfInline: boolean = browserShowsPdfInline()): OriginalKind {
  const type = (mimeType.toLowerCase().split(";")[0] ?? "").trim();
  if (type.includes("pdf")) return pdfInline ? "pdf-frame" : "pdf-pages";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/markdown" || type === "text/x-markdown") return "markdown";
  if (type === "text/plain") return "text";
  return "none";
}
