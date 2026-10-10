import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversionProgress, IntakeFile } from "../../lib/intake-model.js";
import { FileRow } from "./FileRow.js";
import { IntakeStyles } from "./intake-styles.js";
import { fileOf, readyFile } from "./test-fixtures.js";

const row = (
  file: IntakeFile,
  {
    waiting,
    publishingId = null,
  }: { waiting?: string; publishingId?: string | null } = {},
) =>
  renderToStaticMarkup(
    <FileRow
      file={file}
      waiting={waiting}
      publishingId={publishingId}
      onReview={() => {}}
      onAdd={() => {}}
      onRetry={() => {}}
      onRunOcr={() => {}}
      onRetryAttach={() => {}}
      onRemove={() => {}}
      onOpenSources={() => {}}
      onAddAgain={() => {}}
    />,
  );

/** The button with this exact label, and its class list. */
const button = (html: string, label: string) =>
  [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .filter((m) => m[2] === label)
    .map((m) => m[1]);
const isPrimary = (attrs: string | undefined) =>
  attrs?.includes("ik-btn-primary") === true;

const reading = (
  phase: ConversionProgress["phase"],
  pages: number | null,
  pagesDone: number,
): IntakeFile =>
  fileOf({
    state: "converting",
    startedAt: Date.now() - 41_000,
    progress: { phase, pages, pagesDone, elapsedMs: 41_000 },
  });

describe("FileRow — reading", () => {
  it("says how many pages it reads, over a bar that claims no share", () => {
    const html = row(reading("reading", 23, 0));
    expect(html).toContain("Reading 23 pages");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('class="ik-track-glow"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toMatch(/class="ik-time">0:4[01]</);
  });

  it("fills the bar from a service that counts pages", () => {
    const html = row(reading("reading", 20, 5));
    expect(html).toContain("Reading page 5 of 20");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain("width:25%");
  });

  it("keeps a moving bar while it finds the sections", () => {
    const html = row(reading("structuring", 20, 20));
    expect(html).toContain("Finding the sections");
    expect(html).toContain('class="ik-track-glow"');
  });

  it("offers × to stop it", () => {
    expect(row(reading("reading", 23, 0))).toContain(
      'title="Stop reading it and remove it"',
    );
  });

  it("holds the bar still for a reader who asked for less motion", () => {
    const css = renderToStaticMarkup(<IntakeStyles />);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/\.ik-track-glow \{ animation: none; \}/);
  });
});

describe("FileRow — waiting", () => {
  it("says what it waits for, with no bar and no actions", () => {
    const html = row(fileOf(), {
      waiting: "Waiting. Starts when Board-pack is read.",
    });
    expect(html).toContain("Waiting. Starts when Board-pack is read.");
    expect(html).not.toContain("progressbar");
    expect(html).not.toContain("ik-btn");
  });
});

describe("FileRow — ready", () => {
  it("offers Add with its sections already chosen, and Review beside it", () => {
    const html = row(readyFile([2563, 3767, 2398]));
    expect(html).toContain("3 sections");
    expect(isPrimary(button(html, "Add 3 sources")[0])).toBe(true);
    expect(isPrimary(button(html, "Review")[0])).toBe(false);
    // The bar is the file's sections, one tile each.
    expect(html.match(/<i style="flex-grow:\d+"/g)).toHaveLength(3);
  });

  it("counts the sections left out, and adds only the kept ones", () => {
    const html = row(
      readyFile([10, 600, 600, 10], { selected: [false, true, true, false] }),
    );
    expect(html).toContain("4 sections, 2 left out");
    expect(button(html, "Add 2 sources")).toHaveLength(1);
    expect(html.match(/class="ik-off"/g)).toHaveLength(2);
  });

  it("leads with Review when there is a reason to look first", () => {
    const html = row(
      readyFile(
        [2000, 2000],
        {},
        {
          quality: {
            coverage: 0.797,
            rawTokens: 1,
            formulas: { total: 0, decoded: 0 },
            images: 3,
          },
        },
      ),
    );
    expect(html).toContain("About 80% of the text was captured");
    expect(isPrimary(button(html, "Review")[0])).toBe(true);
    expect(isPrimary(button(html, "Add")[0])).toBe(false);
  });

  it("asks for a review when nothing is kept", () => {
    const html = row(readyFile([500, 500], { selected: [false, false] }));
    expect(html).toContain("2 sections, none kept");
    expect(isPrimary(button(html, "Review")[0])).toBe(true);
    expect(html).not.toMatch(/>Add/);
  });

  it("shows Adding… on the file being added, and holds the other files' Add", () => {
    const file = readyFile([500]);
    expect(
      button(row(file, { publishingId: file.id }), "Adding…")[0],
    ).toContain("disabled");
    expect(
      button(row(file, { publishingId: "other" }), "Add 1 source")[0],
    ).toContain("disabled");
  });

  it("says on the row when adding it failed", () => {
    const html = row(
      readyFile([500], { publishError: "The vault did not answer." }),
    );
    expect(html).toContain("Couldn&#x27;t add it: The vault did not answer.");
    expect(button(html, "Add 1 source")).toHaveLength(1);
  });
});

describe("FileRow — needing a decision, or failed", () => {
  it("asks before reading a scan, with the time it takes", () => {
    const file = fileOf({
      state: "converted",
      converted: {
        filename: "Lease.pdf",
        format: "pdf",
        sections: [],
        plan: {
          cutLevel: 1,
          splitSections: 0,
          mergedSections: 0,
          rejoinedSections: 0,
          minSectionChars: 0,
        },
        pages: 31,
        needsOcr: { via: "tesseract", estimateSeconds: 240 },
      },
    });
    const html = row(file);
    expect(html).toContain(
      "This is a scan. Reading the text from its 31 page images takes about 4 min.",
    );
    expect(isPrimary(button(html, "Read the scan")[0])).toBe(true);
  });

  it("says it couldn't read the file, with the reason, and offers Try again", () => {
    const html = row(
      fileOf({ state: "failed", error: "The reader stopped with an error." }),
    );
    expect(html).toContain("Couldn&#x27;t read this file.");
    expect(html).toContain("The reader stopped with an error.");
    expect(button(html, "Try again")).toHaveLength(1);
  });
});

describe("FileRow — added", () => {
  it("says how many sources it became, in green, with Open and no ×", () => {
    const html = row(
      readyFile([300, 200, 200], { publishedIds: ["s1", "s2", "s3"] }),
    );
    expect(html).toContain("Added as 3 sources");
    expect(html).toContain('data-tone="added"');
    expect(button(html, "Open")).toHaveLength(1);
    expect(html).not.toContain('aria-label="Remove');
  });

  it("offers to attach the original again when it didn't land", () => {
    const html = row(
      readyFile([300], { publishedIds: ["s1"], attachError: "upload refused" }),
    );
    expect(html).toContain(
      "Added as 1 source, but the original file couldn&#x27;t be attached",
    );
    expect(button(html, "Attach again")).toHaveLength(1);
  });
});

describe("FileRow — a file the vault already holds", () => {
  it("says so, where the earlier copy is, and offers Open and Add again — not a reading bar", () => {
    const html = row(
      fileOf({
        state: "duplicate",
        known: {
          folderName: "Report",
          sources: 12,
          addedAt: "2026-01-10T09:00:00Z",
        },
      }),
    );
    expect(html).toContain(
      '<span class="ik-cap-warn">Already in the vault.</span>',
    );
    expect(html).toContain("as 12 sources in Sources › Report.");
    expect(button(html, "Open")).toHaveLength(1);
    expect(button(html, "Add again")).toHaveLength(1);
    expect(html).not.toContain("progressbar");
    expect(html).toContain('title="Remove it. Nothing from it will be added."');
  });

  it("names the twin when the copy is in this batch", () => {
    const html = row(
      fileOf({
        name: "Copy of report.pdf",
        state: "duplicate",
        known: {
          folderName: null,
          sources: 0,
          addedAt: null,
          inBatch: "Report.pdf",
        },
      }),
    );
    expect(html).toContain("Same file as Report.");
    expect(html).toContain("It&#x27;s already in this batch.");
  });

  it("says when a ready file goes into a folder of its own, without making Review the first step", () => {
    const html = row(
      readyFile([500, 500], {
        folderName: "Report (2)",
        renamedFrom: "Report",
      }),
    );
    expect(html).toContain("Goes in “Report (2)”");
    expect(isPrimary(button(html, "Add 2 sources")[0])).toBe(true);
  });
});
