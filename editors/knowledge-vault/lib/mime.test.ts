import { describe, expect, it } from "vitest";
import { formatFileSize, isBrowserRenderable } from "./mime.js";

describe("isBrowserRenderable", () => {
  it("previews the document types a browser genuinely renders", () => {
    expect(isBrowserRenderable("application/pdf")).toBe(true);
    expect(isBrowserRenderable("text/plain")).toBe(true);
    expect(isBrowserRenderable("text/markdown")).toBe(true);
  });

  it("previews media", () => {
    expect(isBrowserRenderable("image/png")).toBe(true);
    expect(isBrowserRenderable("audio/mpeg")).toBe(true);
    expect(isBrowserRenderable("video/mp4")).toBe(true);
  });

  it("downloads html and svg on purpose, not by omission", () => {
    // Rendering untrusted markup injects it into the editor's origin.
    expect(isBrowserRenderable("text/html")).toBe(false);
    expect(isBrowserRenderable("image/svg+xml")).toBe(false);
  });

  it("downloads what the browser cannot render", () => {
    expect(
      isBrowserRenderable(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
    expect(isBrowserRenderable("application/epub+zip")).toBe(false);
    expect(isBrowserRenderable("text/csv")).toBe(false);
  });

  it("reads through a parameter and any casing", () => {
    expect(isBrowserRenderable("text/plain; charset=utf-8")).toBe(true);
    expect(isBrowserRenderable("APPLICATION/PDF")).toBe(true);
  });

  it("treats a missing type as not renderable", () => {
    expect(isBrowserRenderable(null)).toBe(false);
    expect(isBrowserRenderable(undefined)).toBe(false);
    expect(isBrowserRenderable("")).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("shows one decimal of a kilobyte and of a megabyte", () => {
    expect(formatFileSize(47_688)).toBe("46.6 KB");
    expect(formatFileSize(17_400_000)).toBe("16.6 MB");
  });

  it("says nothing rather than 'NaN' when the size is unknown", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });
});
