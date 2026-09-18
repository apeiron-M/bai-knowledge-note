import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  attachmentFailure,
  cachedAttachmentDataUrl,
  fetchAttachmentDataUrl,
  getAttachmentsVersion,
  subscribeAttachments,
} from "../knowledge-vault/lib/attachments.js";
import { safeUrl } from "./sanitize-url.js";

/** A content-addressed attachment ref, the only local image source the preview accepts. */
const ATTACHMENT_REF = /^attachment:\/\/v\d+:[0-9a-f]{16,}$/i;

type MarkdownPreviewProps = {
  content: string;
  /**
   * `compact` is the vault's inline scale (cards, panels, chat). `reading` is
   * the source editor's page: 16px/1.72 with headings, tables and figures
   * sized to be read rather than scanned.
   */
  scale?: "compact" | "reading";
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isTableRow(line: string): boolean {
  return line.trimStart().startsWith("|") && line.trimEnd().endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:-]+(\|[\s:-]+)*\|$/.test(line.trim());
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTableAlignments(
  line: string,
): ("left" | "center" | "right" | null)[] {
  return parseTableCells(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function renderTable(tableLines: string[]): string {
  if (tableLines.length < 2)
    return tableLines
      .map((l) => `<p class="md-p">${inlineFormat(l)}</p>`)
      .join("\n");

  const headerCells = parseTableCells(tableLines[0]);
  const alignments = isTableSeparator(tableLines[1])
    ? parseTableAlignments(tableLines[1])
    : [];
  const bodyStart = isTableSeparator(tableLines[1]) ? 2 : 1;

  const alignAttr = (i: number) => {
    const a = alignments[i];
    return a ? ` style="text-align:${a}"` : "";
  };

  let out = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
  headerCells.forEach((cell, i) => {
    out += `<th${alignAttr(i)}>${inlineFormat(cell)}</th>`;
  });
  out += "</tr></thead><tbody>";

  for (let r = bodyStart; r < tableLines.length; r++) {
    const cells = parseTableCells(tableLines[r]);
    out += "<tr>";
    cells.forEach((cell, i) => {
      out += `<td${alignAttr(i)}>${inlineFormat(cell)}</td>`;
    });
    out += "</tr>";
  }

  out += "</tbody></table></div>";
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let inTable = false;
  let codeBuffer: string[] = [];
  let tableBuffer: string[] = [];

  for (const line of lines) {
    // Fenced code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html.push(
          `<pre class="md-code-block"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        if (inList) {
          html.push("</ul>");
          inList = false;
        }
        if (inTable) {
          html.push(renderTable(tableBuffer));
          tableBuffer = [];
          inTable = false;
        }
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Table rows
    if (isTableRow(line) || (inTable && isTableSeparator(line))) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      inTable = true;
      tableBuffer.push(line);
      continue;
    }
    if (inTable) {
      html.push(renderTable(tableBuffer));
      tableBuffer = [];
      inTable = false;
    }

    // Close list if line isn't a list item
    if (inList && !line.match(/^[-*]\s/)) {
      html.push("</ul>");
      inList = false;
    }

    // Empty line
    if (line.trim() === "") {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }

    // Headers
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      html.push(
        `<h${level} class="md-h${level}">${inlineFormat(h[2])}</h${level}>`,
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      html.push(
        `<blockquote class="md-blockquote">${inlineFormat(line.slice(2))}</blockquote>`,
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
      html.push('<hr class="md-hr" />');
      continue;
    }

    // Unordered list
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) {
      if (!inList) {
        html.push('<ul class="md-list">');
        inList = true;
      }
      html.push(`<li>${inlineFormat(li[1])}</li>`);
      continue;
    }

    // Paragraph
    html.push(`<p class="md-p">${inlineFormat(line)}</p>`);
  }

  if (inCodeBlock) {
    html.push(
      `<pre class="md-code-block"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
    );
  }
  if (inList) html.push("</ul>");
  if (inTable) html.push(renderTable(tableBuffer));

  return html.join("\n");
}

/** docling's markers for what it saw but did not carry over — shown as a quiet note, not as a raw comment. */
const PLACEHOLDER_NOTES: Record<string, string> = {
  "<!-- formula-not-decoded -->": "formula — not decoded",
  "<!-- image -->": "figure — not transcribed",
};

function inlineFormat(text: string): string {
  const note = PLACEHOLDER_NOTES[text.trim()];
  if (note) return `<span class="md-placeholder">${note}</span>`;
  let out = escapeHtml(text);
  // Inline citation chips. `[[cite:n:k]]` is emitted by the chat's numbering
  // pass (n = source number, k = marker position) and rendered as a button
  // the chat drives through delegated events — see ChatMessage. Digits only,
  // so nothing here needs escaping; matched first so no other rule can see
  // the brackets.
  out = out.replace(
    /\[\[cite:(\d+):(\d+)\]\]/g,
    '<button type="button" class="md-cite" data-cite="$1" data-occurrence="$2" aria-label="Source $1">$1</button>',
  );
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Images — before links, because the syntax contains one. An attachment
  // ref renders as an <img> without a src; MarkdownPreview resolves it through
  // the attachment service (the bytes need the bearer, so no URL can be
  // written here). An https image is allowed through as is; anything else —
  // data:, javascript:, a relative path — renders as its alt text, so a
  // poisoned note cannot make the vault fetch from an origin of its choosing.
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_match: string, alt: string, src: string) => {
      if (ATTACHMENT_REF.test(src)) {
        // Already fetched on this page: the bytes go straight into the HTML, so
        // a remount (the editor is re-created on every live-feed update) shows
        // the picture without an effect having to run first.
        const cached = cachedAttachmentDataUrl(src);
        if (cached) {
          return `<img class="md-img" data-attachment-ref="${src}" src="${cached}" alt="${alt}" loading="lazy" draggable="false">`;
        }
        // A known failure is written as the note at once: the mount that hit
        // it may be gone before its promise settles.
        const failure = attachmentFailure(src);
        if (failure) {
          return `<span class="md-img-unavailable">${alt} — image unavailable: ${escapeHtml(failure)}</span>`;
        }
        // `draggable="false"`: a dragged <img> starts a native drag that
        // Connect's drop zone answers with "drop your documents here".
        return `<img class="md-img" data-attachment-ref="${src}" alt="${alt}" loading="lazy" draggable="false">`;
      }
      const safe = safeUrl(src);
      return safe !== null && /^https:/i.test(safe)
        ? `<img class="md-img" src="${safe}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" draggable="false">`
        : alt;
    },
  );
  // Links — the href is untrusted, so a rejected scheme renders as plain
  // text rather than a dead link, keeping the label visible.
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match: string, label: string, href: string) => {
      const safe = safeUrl(href);
      return safe === null
        ? label
        : `<a class="md-link" href="${safe}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    },
  );
  // Wikilinks
  out = out.replace(/\[\[([^\]]+)\]\]/g, '<span class="md-wikilink">$1</span>');
  return out;
}

export function MarkdownPreview({
  content,
  scale = "compact",
}: MarkdownPreviewProps) {
  // Re-render whenever an attachment arrives or fails anywhere on the page:
  // the renderer then writes the picture (or the reason) into the HTML.
  const attachmentsVersion = useSyncExternalStore(
    subscribeAttachments,
    getAttachmentsVersion,
    getAttachmentsVersion,
  );
  const html = useMemo(
    () => renderMarkdown(content),
    // attachmentsVersion is the cache's clock: a bump means the same content renders differently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content, attachmentsVersion],
  );
  const root = useRef<HTMLDivElement>(null);

  // Start the fetch for every image that has no bytes yet. Nothing here
  // touches the DOM afterwards: the resolution re-renders the preview (above),
  // and the renderer puts `src` — or the failure note — into the HTML itself.
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    for (const img of container.querySelectorAll<HTMLImageElement>(
      "img[data-attachment-ref]:not([src])",
    )) {
      const ref = img.dataset.attachmentRef;
      if (!ref) continue;
      img.classList.add("md-img-loading");
      fetchAttachmentDataUrl(ref).catch((error: unknown) => {
        console.warn(
          "[preview] attachment unavailable:",
          ref,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }, [html]);

  return (
    <>
      <style>{`
        .md-preview h1.md-h1 { font-size: 1.5rem; font-weight: 700; color: var(--bai-text); margin: 1rem 0 0.5rem; }
        .md-preview h2.md-h2 { font-size: 1.25rem; font-weight: 600; color: var(--bai-text); margin: 1rem 0 0.5rem; border-bottom: 1px solid var(--bai-border); padding-bottom: 0.25rem; }
        .md-preview h3.md-h3 { font-size: 1.1rem; font-weight: 600; color: var(--bai-text-secondary); margin: 0.75rem 0 0.25rem; }
        .md-preview h4.md-h4, .md-preview h5.md-h5, .md-preview h6.md-h6 { font-size: 1rem; font-weight: 600; color: var(--bai-text-secondary); margin: 0.5rem 0 0.25rem; }
        .md-preview .md-p { color: var(--bai-text-secondary); line-height: 1.7; margin: 0.4rem 0; }
        .md-preview .md-blockquote { border-left: 3px solid var(--bai-accent); padding-left: 1rem; color: var(--bai-text-tertiary); font-style: italic; margin: 0.5rem 0; }
        .md-preview .md-list { padding-left: 1.5rem; color: var(--bai-text-secondary); margin: 0.4rem 0; }
        .md-preview .md-list li { margin: 0.2rem 0; line-height: 1.6; }
        .md-preview .md-code-block { background: var(--bai-deep); border-radius: 0.5rem; padding: 0.75rem 1rem; overflow-x: auto; margin: 0.5rem 0; }
        .md-preview .md-code-block code { color: #a6e3a1; font-size: 0.8rem; font-family: monospace; }
        .md-preview .md-inline-code { background: var(--bai-accent-soft); color: var(--bai-accent); padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; font-family: monospace; }
        .md-preview .md-link { color: #89b4fa; text-decoration: underline; }
        .md-preview .md-wikilink { color: var(--bai-accent); font-weight: 500; }
        .md-preview .md-cite { display: inline-flex; align-items: center; justify-content: center; min-width: 1.15rem; height: 1.15rem; padding: 0 0.3rem; margin-left: 0.15rem; border-radius: 9999px; border: 1px solid var(--bai-border); background: var(--bai-accent-soft); color: var(--bai-accent); font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; vertical-align: 0.2em; cursor: pointer; }
        .md-preview .md-cite:hover, .md-preview .md-cite:focus-visible { background: var(--bai-accent); color: var(--bai-accent-text); border-color: var(--bai-accent); outline: none; }
        .md-preview .md-img { display: block; max-width: 100%; height: auto; margin: 0.75rem auto; border-radius: 0.375rem; background: var(--bai-surface); }
        .md-preview .md-img-loading { min-height: 2.5rem; min-width: 8rem; border: 1px dashed var(--bai-border); color: var(--bai-text-faint); font-size: 0.75rem; }
        .md-preview .md-img-unavailable { display: block; border: 1px dashed var(--bai-warn); border-radius: 0.375rem; color: var(--bai-text-tertiary); font-size: 0.75rem; padding: 0.5rem; margin: 0.75rem 0; word-break: break-word; }
        .md-preview .md-placeholder { display: inline-block; padding: 0.15rem 0.5rem; border: 1px dashed var(--bai-border); border-radius: 0.25rem; color: var(--bai-text-faint); font-size: 0.75rem; }
        .md-preview .md-hr { border: none; border-top: 1px solid var(--bai-border); margin: 1rem 0; }
        .md-preview strong { color: var(--bai-text); }
        .md-preview em { color: var(--bai-text-secondary); }
        .md-preview .md-table-wrap { overflow-x: auto; margin: 0.75rem 0; }
        .md-preview .md-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .md-preview .md-table th { color: var(--bai-text); font-weight: 600; text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--bai-border); white-space: nowrap; }
        .md-preview .md-table td { color: var(--bai-text-secondary); padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--bai-border); }
        .md-preview .md-table tbody tr:hover { background: color-mix(in srgb, var(--bai-text) 3%, transparent); }
        .md-preview.md-reading { font-size: 14.5px; line-height: 1.7; color: var(--bai-text-secondary); }
        .md-preview.md-reading h1.md-h1 { font-size: 21px; margin: 0 0 6px; }
        .md-preview.md-reading h2.md-h2 { font-size: 17px; margin: 32px 0 10px; border-bottom: 0; padding-bottom: 0; }
        .md-preview.md-reading h3.md-h3 { font-size: 14.8px; color: var(--bai-text); margin: 22px 0 7px; }
        .md-preview.md-reading h4.md-h4, .md-preview.md-reading h5.md-h5, .md-preview.md-reading h6.md-h6 { font-size: 14px; margin: 18px 0 6px; }
        .md-preview.md-reading .md-p { margin: 0 0 14px; line-height: 1.7; }
        .md-preview.md-reading .md-list { margin: 0 0 16px; padding-left: 22px; }
        .md-preview.md-reading .md-list li { margin: 4px 0; line-height: 1.7; }
        .md-preview.md-reading .md-blockquote { margin: 22px 0; padding: 2px 0 2px 18px; border-left: 2px solid var(--bai-border); }
        .md-preview.md-reading .md-table-wrap { margin: 22px 0; }
        .md-preview.md-reading .md-table { font-size: 13px; }
        .md-preview.md-reading .md-table th { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; }
        .md-preview.md-reading .md-table td { padding: 8px 12px 8px 0; }
        .md-preview.md-reading .md-img { margin: 24px auto; }
        .md-preview.md-reading .md-hr { margin: 28px 0; }
      `}</style>
      <div
        ref={root}
        className={
          scale === "reading"
            ? "md-preview md-reading"
            : "md-preview text-sm leading-relaxed"
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
