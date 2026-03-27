import { useMemo } from "react";

type MarkdownPreviewProps = {
  content: string;
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

function renderMarkdown(md: string): string {
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

function inlineFormat(text: string): string {
  let out = escapeHtml(text);
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Links
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a class="md-link" href="$2">$1</a>',
  );
  // Wikilinks
  out = out.replace(/\[\[([^\]]+)\]\]/g, '<span class="md-wikilink">$1</span>');
  return out;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

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
        .md-preview .md-hr { border: none; border-top: 1px solid var(--bai-border); margin: 1rem 0; }
        .md-preview strong { color: var(--bai-text); }
        .md-preview em { color: var(--bai-text-secondary); }
        .md-preview .md-table-wrap { overflow-x: auto; margin: 0.75rem 0; }
        .md-preview .md-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .md-preview .md-table th { color: var(--bai-text); font-weight: 600; text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--bai-border); white-space: nowrap; }
        .md-preview .md-table td { color: var(--bai-text-secondary); padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--bai-border); }
        .md-preview .md-table tbody tr:hover { background: color-mix(in srgb, var(--bai-text) 3%, transparent); }
      `}</style>
      <div
        className="md-preview text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
