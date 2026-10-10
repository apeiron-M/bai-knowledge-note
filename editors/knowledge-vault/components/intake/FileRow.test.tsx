import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversionProgress, IntakeFile } from "../../lib/intake-model.js";
import { FileRow } from "./FileRow.js";

const converting = (progress?: ConversionProgress): IntakeFile => ({
  id: "f1",
  name: "Book.pdf",
  size: 1024,
  mimeType: "application/pdf",
  state: "converting",
  sourceType: "ARTICLE",
  folderName: "Book",
  selected: [],
  startedAt: Date.now(),
  progress,
});

const reading = (pages: number, pagesDone: number): ConversionProgress => ({
  phase: "reading",
  pages,
  pagesDone,
  elapsedMs: 1000,
});

const row = (file: IntakeFile) =>
  renderToStaticMarkup(
    <FileRow
      file={file}
      selected={false}
      onOpen={() => {}}
      onRetry={() => {}}
      onRemove={() => {}}
    />,
  );

describe("FileRow — a converting file", () => {
  it("reading in one pass, says how many pages it reads over an indeterminate bar", () => {
    const html = row(converting(reading(23, 0)));
    expect(html).toContain("reading 23 pages");
    expect(html).not.toContain("page 0 of");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('class="intake-bar-indeterminate');
    // An indeterminate bar claims no value.
    expect(html).not.toContain("aria-valuenow");
  });

  it("keeps the measured page and bar from a service that counts pages", () => {
    const html = row(converting(reading(20, 5)));
    expect(html).toContain("reading page 5 of 20");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain("width:25%");
    expect(html).not.toContain('class="intake-bar-indeterminate');
  });

  it("holds the indeterminate bar still for a reader who asked for less motion", () => {
    const html = row(converting(reading(23, 0)));
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain(".intake-bar-indeterminate { animation: none;");
  });

  it("shows no bar once reading is over", () => {
    const html = row(
      converting({
        phase: "structuring",
        pages: 20,
        pagesDone: 20,
        elapsedMs: 1000,
      }),
    );
    expect(html).toContain("structuring the text");
    expect(html).not.toContain('role="progressbar"');
  });

  it("offers Remove, which stops the conversion", () => {
    const html = row(converting());
    expect(html).toMatch(
      /<button[^>]*title="Stop converting and drop this file[^"]*"[^>]*>Remove<\/button>/,
    );
  });
});
