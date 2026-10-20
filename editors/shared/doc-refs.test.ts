import { describe, expect, it } from "vitest";
import { docToken, linkDocRefs } from "./doc-refs.js";
import { renderMarkdown } from "./markdown-preview.js";

const titles: Record<string, string> = {
  "4fQoC8lXU9anIKtm5aN5brKpwqaatkmstRhuq9f0qW0": "Reducing buyback and staking rewards temporarily builds protocol reserves without foreclosing full distributions later",
  "8WSuwpbZ9WaGDq--48sdRlrBCfFk2DUDqaoiJembYag": "Deposits migrate from a legacy savings product to a newer one when the newer pays a higher rate",
};
const titleOf = (id: string) => titles[id];
const A = "4fQoC8lXU9anIKtm5aN5brKpwqaatkmstRhuq9f0qW0";
const B = "8WSuwpbZ9WaGDq--48sdRlrBCfFk2DUDqaoiJembYag";

describe("linkDocRefs", () => {
  it("turns a contradiction's “title — `id`” claims into one link each, with no id left to read", () => {
    const md = `## Involved claims\n\n- ${titles[A]} — \`${A}\`\n- ${titles[B]} — \`${B}\``;
    expect(linkDocRefs(md, titleOf)).toBe(`## Involved claims\n\n- ${docToken(A, titles[A])}\n- ${docToken(B, titles[B])}`);
  });
  it("names a note by its current title when it was renamed since the analysis was written", () => {
    expect(linkDocRefs(`- An older wording — \`${A}\``, titleOf)).toBe(`- An older wording — ${docToken(A, titles[A])}`);
  });
  it("links a bare id in running text", () => {
    expect(linkDocRefs(`See \`${B}\` for the rate.`, titleOf)).toBe(`See ${docToken(B, titles[B])} for the rate.`);
  });
  it("leaves ids the vault does not know, and ordinary code, as they are", () => {
    const md = "A `CONTRADICTS` link to `unknownUnknownUnknown123`.";
    expect(linkDocRefs(md, titleOf)).toBe(md);
  });
  it("draws as the note's title in a link that carries the id", () => {
    const html = renderMarkdown(linkDocRefs(`- ${titles[A]} — \`${A}\``, titleOf));
    expect(html).toContain(`<button type="button" class="md-doc" data-doc-id="${A}" title="Open this note">${titles[A]}</button>`);
    expect(html).not.toContain(`<code class="md-inline-code">${A}`);
  });
  it("keeps a title with HTML in it as text", () => {
    const html = renderMarkdown(linkDocRefs(`\`${A}\``, () => "Fees <b>rise</b> & fall"));
    expect(html).toContain(">Fees &lt;b&gt;rise&lt;/b&gt; &amp; fall</button>");
  });
});
