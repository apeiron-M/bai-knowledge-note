/**
 * Render-or-download is a rule, not a display preference.
 *
 * docling accepts 29 formats, so a source may hold anything at all. A browser
 * can genuinely render PDFs, plain text, markdown and media; it must NOT be
 * given html or svg, because rendering untrusted markup injects it into the
 * editor's origin. Everything else downloads, so the panel is honest about what
 * the browser can do rather than showing an empty pane.
 */
const RENDERABLE = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

const RENDERABLE_PREFIXES = ["image/", "audio/", "video/"];

const DENIED = new Set(["text/html", "image/svg+xml"]);

export function isBrowserRenderable(
  mimeType: string | null | undefined,
): boolean {
  if (!mimeType) return false;
  const [rawType] = mimeType.toLowerCase().split(";");
  const type = rawType.trim();
  if (!type) return false;
  if (DENIED.has(type)) return false;
  if (RENDERABLE.has(type)) return true;
  return RENDERABLE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
