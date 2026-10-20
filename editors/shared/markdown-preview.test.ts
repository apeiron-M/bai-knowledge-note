import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown-preview.js";

describe("renderMarkdown citation chips", () => {
  it("renders a [[cite:n:k]] token as a chip button carrying its number and position", () => {
    expect(renderMarkdown("Stored in PGlite [[cite:2:5]].")).toBe(
      '<p class="md-p">Stored in PGlite <button type="button" class="md-cite" data-cite="2" data-occurrence="5" aria-label="Source 2">2</button>.</p>',
    );
  });

  it("leaves ordinary wikilinks and bracketed prose as before", () => {
    expect(renderMarkdown("See [[Some note]] and [1].")).toBe(
      '<p class="md-p">See <span class="md-wikilink">Some note</span> and [1].</p>',
    );
  });

  it("does not let a token be mistaken for a link or emphasis", () => {
    expect(renderMarkdown("*emph* [[cite:1:0]](x) `code`")).toContain(
      'data-cite="1" data-occurrence="0" aria-label="Source 1">1</button>(x)',
    );
  });
});

describe("renderMarkdown images", () => {
  const ref =
    "attachment://v1:6ef3575bf327de945c7003cfb710f271cdb0df370f917698f98a2084023f3e36";

  it("renders an attachment ref as an <img> without a src, for the preview to resolve", () => {
    const html = renderMarkdown(
      `before\n\n![formula 12, page 7 — not decoded](${ref})\n\nafter`,
    );
    expect(html).toContain(
      `<img class="md-img" data-attachment-ref="${ref}" alt="formula 12, page 7 — not decoded" loading="lazy" draggable="false">`,
    );
    expect(html).not.toContain(`src="${ref}"`);
  });

  it("lets an https image through and nothing else", () => {
    expect(renderMarkdown("![chart](https://example.org/c.png)")).toContain(
      'src="https://example.org/c.png"',
    );
    for (const src of [
      "http://example.org/c.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "./local.png",
      "attachment://v1:short",
    ]) {
      const html = renderMarkdown(`![the alt](${src})`);
      expect(html).not.toContain("<img");
      expect(html).toContain("the alt");
    }
  });

  it("does not mistake an image for a link", () => {
    const html = renderMarkdown(
      `![fig](${ref}) and [a link](https://example.org)`,
    );
    expect(html).toContain("data-attachment-ref");
    expect(html).toContain('<a class="md-link" href="https://example.org"');
  });
});

describe("renderMarkdown placeholders", () => {
  it("shows docling's not-decoded / not-transcribed markers as a quiet note, not a raw comment", () => {
    const html = renderMarkdown(
      "before\n\n<!-- formula-not-decoded -->\n\n<!-- image -->\n\nafter",
    );
    expect(html).toContain(
      '<span class="md-placeholder">formula — not decoded</span>',
    );
    expect(html).toContain(
      '<span class="md-placeholder">figure — not transcribed</span>',
    );
    expect(html).not.toContain("&lt;!--");
  });
});
