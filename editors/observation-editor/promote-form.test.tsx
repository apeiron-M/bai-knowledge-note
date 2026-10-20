import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromoteForm, promotedRef } from "./promote-form.js";

const docs = [{ id: "n1", title: "Atomic notes give incoming links a target", documentType: "bai/knowledge-note", noteType: null }];

describe("promote form", () => {
  it("takes the note it was promoted to — trimmed, and nothing when empty", () => {
    expect(promotedRef("  note-123 ")).toBe("note-123");
    expect(promotedRef("   ")).toBeNull();
  });
  it("is an inline form that finds the note by title, with its own confirm and cancel, not a browser prompt", () => {
    const html = renderToStaticMarkup(<PromoteForm docs={docs} onSubmit={() => {}} onCancel={() => {}} />);
    expect(html).toContain("<form");
    expect(html).toContain("Promoted to note");
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*aria-label="Promoted to note"/);
    expect(html).toContain(">Promote<");
    expect(html).toContain(">Cancel<");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/); // nothing picked yet
  });
  it("says it is promoting while the write is in flight", () => {
    const html = renderToStaticMarkup(<PromoteForm docs={docs} busy onSubmit={() => {}} onCancel={() => {}} />);
    expect(html).toContain(">Promoting…<");
  });
});
