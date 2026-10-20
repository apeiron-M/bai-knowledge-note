import { describe, expect, it } from "vitest";
import { browserShowsPdfInline, originalKind } from "./pdf-inline.js";

describe("browserShowsPdfInline", () => {
  it("trusts a browser that says it has a PDF viewer (Chrome, Firefox, Safari)", () => {
    expect(browserShowsPdfInline({ pdfViewerEnabled: true })).toBe(true);
  });
  it("draws the pages itself when the browser has none, or does not say (WebKitGTK in the desktop app)", () => {
    expect(browserShowsPdfInline({ pdfViewerEnabled: false })).toBe(false);
    expect(browserShowsPdfInline({})).toBe(false);
    expect(browserShowsPdfInline(undefined)).toBe(false);
  });
});



describe("originalKind (how the source viewer shows an original)", () => {
  it("shows every viewable type inline, a PDF by the browser's own viewer only where there is one", () => {
    expect(originalKind("application/pdf", true)).toBe("pdf-frame");
    expect(originalKind("application/pdf", false)).toBe("pdf-pages");
    expect(originalKind("image/png", false)).toBe("image");
    expect(originalKind("audio/mpeg", false)).toBe("audio");
    expect(originalKind("video/mp4", false)).toBe("video");
    expect(originalKind("text/markdown", false)).toBe("markdown");
    expect(originalKind("text/x-markdown; charset=utf-8", false)).toBe("markdown");
    expect(originalKind("text/plain", false)).toBe("text");
  });
  it("has no inline view for anything else", () => {
    expect(originalKind("application/zip", false)).toBe("none");
  });
});
