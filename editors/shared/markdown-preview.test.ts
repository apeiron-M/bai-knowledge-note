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
