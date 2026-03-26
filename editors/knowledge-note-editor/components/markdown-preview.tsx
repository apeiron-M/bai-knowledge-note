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

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let codeBuffer: string[] = [];

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
        if (inList) { html.push("</ul>"); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Close list if line isn't a list item
    if (inList && !line.match(/^[-*]\s/)) {
      html.push("</ul>");
      inList = false;
    }

    // Empty line
    if (line.trim() === "") {
      if (inList) { html.push("</ul>"); inList = false; }
      continue;
    }

    // Headers
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      html.push(`<h${level} class="md-h${level}">${inlineFormat(h[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      html.push(`<blockquote class="md-blockquote">${inlineFormat(line.slice(2))}</blockquote>`);
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
      if (!inList) { html.push('<ul class="md-list">'); inList = true; }
      html.push(`<li>${inlineFormat(li[1])}</li>`);
      continue;
    }

    // Paragraph
    html.push(`<p class="md-p">${inlineFormat(line)}</p>`);
  }

  if (inCodeBlock) {
    html.push(`<pre class="md-code-block"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }
  if (inList) html.push("</ul>");

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
        .md-preview h1.md-h1 { font-size: 1.5rem; font-weight: 700; color: #cdd6f4; margin: 1rem 0 0.5rem; }
        .md-preview h2.md-h2 { font-size: 1.25rem; font-weight: 600; color: #cdd6f4; margin: 1rem 0 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.25rem; }
        .md-preview h3.md-h3 { font-size: 1.1rem; font-weight: 600; color: #bac2de; margin: 0.75rem 0 0.25rem; }
        .md-preview h4.md-h4, .md-preview h5.md-h5, .md-preview h6.md-h6 { font-size: 1rem; font-weight: 600; color: #a6adc8; margin: 0.5rem 0 0.25rem; }
        .md-preview .md-p { color: #a6adc8; line-height: 1.7; margin: 0.4rem 0; }
        .md-preview .md-blockquote { border-left: 3px solid #cba6f7; padding-left: 1rem; color: #7f849c; font-style: italic; margin: 0.5rem 0; }
        .md-preview .md-list { padding-left: 1.5rem; color: #a6adc8; margin: 0.4rem 0; }
        .md-preview .md-list li { margin: 0.2rem 0; line-height: 1.6; }
        .md-preview .md-code-block { background: #11111b; border-radius: 0.5rem; padding: 0.75rem 1rem; overflow-x: auto; margin: 0.5rem 0; }
        .md-preview .md-code-block code { color: #a6e3a1; font-size: 0.8rem; font-family: monospace; }
        .md-preview .md-inline-code { background: rgba(203,166,247,0.1); color: #cba6f7; padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; font-family: monospace; }
        .md-preview .md-link { color: #89b4fa; text-decoration: underline; }
        .md-preview .md-wikilink { color: #cba6f7; font-weight: 500; }
        .md-preview .md-hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 1rem 0; }
        .md-preview strong { color: #cdd6f4; }
        .md-preview em { color: #bac2de; }
      `}</style>
      <div
        className="md-preview text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
