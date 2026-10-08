import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromoteForm, promotedRef } from "./promote-form.js";

describe("promote form", () => {
  it("takes the note it was promoted to — trimmed, and nothing when empty", () => {
    expect(promotedRef("  note-123 ")).toBe("note-123");
    expect(promotedRef("   ")).toBeNull();
  });
  it("is an inline field with its own confirm and cancel, not a browser prompt", () => {
    const html = renderToStaticMarkup(<PromoteForm value="" onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />);
    expect(html).toContain("<form");
    expect(html).toContain("Promoted to note");
    expect(html).toMatch(/<input[^>]*aria-label="Promoted to note ID"/);
    expect(html).toContain(">Promote<");
    expect(html).toContain(">Cancel<");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/); // nothing to submit yet
  });
});
