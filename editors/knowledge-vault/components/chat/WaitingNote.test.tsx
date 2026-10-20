import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LONG_WAIT_MS, WaitingNote } from "./WaitingNote.js";

describe("waiting for the model", () => {
  it("says only Thinking… at first", () => {
    const html = renderToStaticMarkup(<WaitingNote />);
    expect(html).toContain("<p>Thinking…</p>");
    expect(html).not.toContain("Still waiting");
  });

  it("says what a long wait usually means once it has gone on", () => {
    const html = renderToStaticMarkup(<WaitingNote since={Date.now() - LONG_WAIT_MS - 1000} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Still waiting for the AI model. A model on this computer may be loading, or busy with a processing step");
    expect(html).toContain("You can stop and ask again.");
  });
});
