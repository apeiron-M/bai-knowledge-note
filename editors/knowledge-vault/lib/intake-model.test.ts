import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  addFiles,
  canPublish,
  defaultSourceType,
  discardUnpublished,
  extensionOf,
  folderNameFor,
  isLikelyFurniture,
  markPublished,
  needsUser,
  nextQueued,
  progressBar,
  progressLabel,
  removeFile,
  selectedCount,
  setAllSections,
  setState,
  toggleSection,
  totalSelected,
  validateFile,
  type ConversionProgress,
  type Section,
} from "./intake-model.js";

const formats = ["pdf", "docx", "html", "md"];

const sec = (title: string, text: string): Section => ({
  title,
  headingPath: [title],
  text,
  content: text,
  charCount: text.length,
  chunks: [0],
  mergedFrom: [],
  markdownRange: null,
});
const plan = {
  cutLevel: 1,
  splitSections: 0,
  mergedSections: 0,
  rejoinedSections: 0,
  minSectionChars: 2000,
};

describe("validateFile", () => {
  it("accepts a supported extension within the cap", () => {
    expect(validateFile({ name: "book.pdf", size: 1024 }, formats)).toEqual({
      ok: true,
    });
  });

  it("refuses an over-size file and names the limit", () => {
    const result = validateFile(
      { name: "book.pdf", size: DEFAULT_MAX_UPLOAD_BYTES + 1 },
      formats,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("30 MB");
  });

  it("checks against the vault's own cap when it reports one (a vault on this computer takes 100 MB)", () => {
    const report = { name: "State-of-AI-Report-2026.pdf", size: 38.9 * 1024 * 1024 };
    expect(validateFile(report, formats).ok).toBe(false);
    expect(validateFile(report, formats, 100 * 1024 * 1024).ok).toBe(true);
    const over = validateFile({ name: "atlas.pdf", size: 120 * 1024 * 1024 }, formats, 100 * 1024 * 1024);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("120.0 MB is over the 100 MB limit for one document.");
  });

  it("accepts exactly the cap", () => {
    expect(
      validateFile({ name: "book.pdf", size: DEFAULT_MAX_UPLOAD_BYTES }, formats).ok,
    ).toBe(true);
  });

  it("refuses an extension the server does not accept, and says which", () => {
    const result = validateFile({ name: "notes.pages", size: 10 }, formats);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("pages");
  });

  it("is case-insensitive about the extension", () => {
    expect(validateFile({ name: "BOOK.PDF", size: 10 }, formats).ok).toBe(true);
  });

  it("refuses a name with no extension at all", () => {
    expect(validateFile({ name: "README", size: 10 }, formats).ok).toBe(false);
  });

  it("refuses an empty file", () => {
    const result = validateFile({ name: "empty.pdf", size: 0 }, formats);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });
});

describe("folderNameFor", () => {
  it("is the file name without its extension", () => {
    expect(folderNameFor("Design for How People Think.pdf")).toBe(
      "Design for How People Think",
    );
  });
  it("strips a path and keeps a dotted stem", () => {
    expect(folderNameFor("C:\\docs\\reactor-6.2.3-release-notes.html")).toBe(
      "reactor-6.2.3-release-notes",
    );
  });
  it("never returns an empty name", () => {
    expect(folderNameFor(".pdf")).toBe(".pdf");
    expect(folderNameFor("   ")).toBe("Untitled");
  });
});

describe("addFiles", () => {
  it("adds rows as queued, typed by format, with no sections yet", () => {
    const files = addFiles(
      [],
      [{ name: "book.pdf", size: 10, mimeType: "application/pdf" }],
    );
    expect(files).toHaveLength(1);
    expect(files[0].state).toBe("queued");
    expect(files[0].selected).toEqual([]);
    expect(files[0].folderName).toBe("book");
    expect(files[0].sourceType).toBe("ARTICLE");
  });

  it("gives each row a distinct id, across calls", () => {
    const a = addFiles(
      [],
      [{ name: "a.pdf", size: 1, mimeType: "application/pdf" }],
    );
    const b = addFiles(a, [
      { name: "b.pdf", size: 1, mimeType: "application/pdf" },
    ]);
    expect(new Set(b.map((f) => f.id)).size).toBe(2);
  });

  it("does not mutate the list it was given", () => {
    const before: never[] = [];
    addFiles(before, [{ name: "a.pdf", size: 1, mimeType: "application/pdf" }]);
    expect(before).toHaveLength(0);
  });
});

describe("the state machine", () => {
  const one = () =>
    addFiles([], [{ name: "book.pdf", size: 10, mimeType: "application/pdf" }]);

  /** The same file, converted, with two sections. */
  const twoSections = () => {
    const files = one();
    return setState(files, files[0].id, {
      state: "converted",
      converted: {
        filename: "book.pdf",
        format: "pdf",
        plan,
        sections: [sec("One", "a"), sec("Two", "b")],
      },
    });
  };

  it("carries a conversion result and ticks every section by default", () => {
    // All ticked is the default on purpose: the section rule already folded the
    // undersized and split the oversized, so the review exists so the user can
    // disagree, not so they must assemble the result by hand.
    const files = twoSections();
    expect(files[0].state).toBe("converted");
    expect(files[0].selected).toEqual([true, true]);
    expect(selectedCount(files[0])).toBe(2);
  });

  it("leaves furniture unticked by default, so the user re-ticks rather than culls", () => {
    // Measured on a 238-page book at the default floor: the first two sections
    // were `Praise for …` (3.7k chars) and `[ contents ]` (13.7k). Ticked by
    // default, both would have become sources.
    const files = one();
    const converted = setState(files, files[0].id, {
      state: "converted",
      converted: {
        filename: "book.pdf",
        format: "pdf",
        plan,
        sections: [
          sec("Praise for Design for How People Think", "…"),
          sec("[ contents ]", "…"),
          sec("Emotion", "…"),
        ],
      },
    });
    expect(converted[0].selected).toEqual([false, false, true]);
  });

  it("keeps the error message on failure and leaves the row retryable", () => {
    const files = one();
    const failed = setState(files, files[0].id, {
      state: "failed",
      error: "Conversion service unreachable",
    });
    expect(failed[0].error).toBe("Conversion service unreachable");
    // Retry means returning to queued — the scheduler picks it up again.
    const retried = setState(failed, failed[0].id, {
      state: "queued",
      error: undefined,
    });
    expect(retried[0].state).toBe("queued");
    expect(retried[0].error).toBeUndefined();
  });

  it("toggles one section without touching its neighbours", () => {
    const files = twoSections();
    const toggled = toggleSection(files, files[0].id, 0);
    expect(toggled[0].selected).toEqual([false, true]);
    expect(selectedCount(toggled[0])).toBe(1);
  });

  it("can select none — publishing nothing is a legal state to be in", () => {
    const files = twoSections();
    const cleared = setAllSections(files, files[0].id, false);
    expect(cleared[0].selected).toEqual([false, false]);
    expect(totalSelected(cleared)).toBe(0);
  });

  it("remembers what it published and stops counting it as publishable", () => {
    const files = twoSections();
    const published = markPublished(files, files[0].id, ["s1", "s2"]);
    expect(published[0].publishedIds).toEqual(["s1", "s2"]);
    expect(selectedCount(published[0])).toBe(0);
    expect(canPublish(published)).toBe(false);
  });

  it("removes a row, so a wrong file never blocks the batch", () => {
    const files = addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );
    const fewer = removeFile(files, files[0].id);
    expect(fewer.map((f) => f.name)).toEqual(["b.pdf"]);
  });

  it("cancel discards what is not in the vault and keeps what is", () => {
    let files = addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
        { name: "c.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );
    files = setState(files, files[0].id, {
      state: "converted",
      converted: {
        filename: "a.pdf",
        format: "pdf",
        plan,
        sections: [sec("One", "a")],
      },
    });
    files = markPublished(files, files[0].id, ["s1"]);
    files = setState(files, files[1].id, { state: "converting" });
    const kept = discardUnpublished(files);
    expect(kept.map((f) => f.name)).toEqual(["a.pdf"]);
    // Nothing published: everything goes.
    expect(discardUnpublished(files.slice(1))).toEqual([]);
  });

  it("ignores an unknown id", () => {
    const files = twoSections();
    expect(setState(files, "nope", { state: "failed" })).toEqual(files);
    expect(toggleSection(files, "nope", 0)).toEqual(files);
  });
});

describe("scheduling", () => {
  const two = () =>
    addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );

  it("picks the first queued file, so the batch runs in the order it was added", () => {
    expect(nextQueued(two())?.name).toBe("a.pdf");
  });

  it("skips a file already converting", () => {
    const files = two();
    expect(
      nextQueued(setState(files, files[0].id, { state: "converting" }))?.name,
    ).toBe("b.pdf");
  });

  it("has nothing to do once every file has settled", () => {
    let files = two();
    for (const f of files)
      files = setState(files, f.id, { state: "converted" });
    expect(nextQueued(files)).toBeUndefined();
  });

  it("counts only converted files with something ticked as publishable", () => {
    let files = two();
    files = setState(files, files[0].id, {
      state: "converted",
      converted: { filename: "a.pdf", format: "pdf", plan, sections: [] },
    });
    expect(canPublish(files)).toBe(false);
    expect(totalSelected(files)).toBe(0);
  });
});

describe("needsUser — what the Sources badge counts", () => {
  it("counts files ready for review and files that failed, never the batch size", () => {
    let files = addFiles(
      [],
      [
        { name: "a.pdf", size: 1, mimeType: "application/pdf" },
        { name: "b.pdf", size: 1, mimeType: "application/pdf" },
        { name: "c.pdf", size: 1, mimeType: "application/pdf" },
        { name: "d.pdf", size: 1, mimeType: "application/pdf" },
      ],
    );
    files = setState(files, files[0].id, {
      state: "converted",
      converted: {
        filename: "a.pdf",
        format: "pdf",
        plan,
        sections: [sec("One", "a")],
      },
    });
    files = setState(files, files[1].id, { state: "failed", error: "x" });
    files = setState(files, files[2].id, { state: "converting" });
    expect(needsUser(files)).toBe(2);
    // Once published, a converted file no longer needs the user.
    files = markPublished(files, files[0].id, ["s1"]);
    expect(needsUser(files)).toBe(1);
  });
});

describe("defaultSourceType", () => {
  // By format, never by section count: a two-section CV is not a book, and a
  // twelve-section PDF may be a report. BOOK_CHAPTER is a choice the user makes.
  it("calls a web page a web page", () => {
    expect(defaultSourceType("page.html")).toBe("WEB_PAGE");
    expect(defaultSourceType("PAGE.HTM")).toBe("WEB_PAGE");
  });

  it("calls captions and media transcripts", () => {
    expect(defaultSourceType("talk.vtt")).toBe("TRANSCRIPT");
    expect(defaultSourceType("talk.mp3")).toBe("TRANSCRIPT");
    expect(defaultSourceType("talk.mp4")).toBe("TRANSCRIPT");
  });

  it("calls everything else an article, and never a book chapter", () => {
    for (const name of [
      "book.pdf",
      "notes.md",
      "report.docx",
      "data.csv",
      "README",
    ]) {
      expect(defaultSourceType(name)).toBe("ARTICLE");
    }
  });
});

describe("isLikelyFurniture", () => {
  it("recognises the furniture a real book produced", () => {
    for (const title of [
      "[ contents ]",
      "[ SIDE NOTE ]",
      "Praise for Design for How People Think",
      "Contents",
      "Table of Contents",
      "Index",
      "Copyright",
      "Colophon",
      "Revision History for the First Edition:",
      "How to Contact Us",
      "About the Author",
      "Acknowledgments",
      "Acknowledgements",
      "Dedication",
    ]) {
      expect(isLikelyFurniture(title), title).toBe(true);
    }
  });

  it("does not flag a chapter", () => {
    for (const title of [
      "Emotion",
      "Wayfinding",
      "Core Competencies",
      "Selected Projects",
      "Design for How People Think — front matter",
      "Indexing the graph",
      "The Contents of a Claim",
    ]) {
      expect(isLikelyFurniture(title), title).toBe(false);
    }
  });
});

describe("progress — what a converting row says", () => {
  const at = (
    phase: ConversionProgress["phase"],
    pages: number | null,
    pagesDone: number,
  ): ConversionProgress => ({ phase, pages, pagesDone, elapsedMs: 1000 });

  it("says how many pages it is reading when the service converts in one pass", () => {
    // One pass: the page count is known, how far the pass has got is not.
    expect(progressLabel(at("reading", 23, 0))).toBe("reading 23 pages");
    expect(progressLabel(at("reading", 1, 0))).toBe("reading 1 page");
    expect(progressBar(at("reading", 23, 0))).toEqual({ kind: "indeterminate" });
  });

  it("keeps the measured page count from a service that counts pages as they finish", () => {
    expect(progressLabel(at("reading", 23, 12))).toBe("reading page 12 of 23");
    expect(progressBar(at("reading", 23, 12))).toEqual({
      kind: "measured",
      fraction: 12 / 23,
    });
    // Never past full, whatever the service reports.
    expect(progressBar(at("reading", 23, 30))).toEqual({
      kind: "measured",
      fraction: 1,
    });
  });

  it("names the later phases, and shows no bar for them", () => {
    expect(progressLabel(at("structuring", 23, 23))).toBe("structuring the text");
    expect(progressLabel(at("text-layer", null, 0))).toBe(
      "reading the text layer",
    );
    expect(progressLabel(at("ocr", 4, 0))).toBe("recognising text (OCR)");
    expect(progressLabel(at("figures", 23, 0))).toBe("cutting out figures");
    expect(progressLabel(at("figures", 23, 7))).toBe("cutting out figures · 7");
    expect(progressLabel(at("cancelled", 23, 0))).toBe("cancelled");
    for (const phase of [
      "structuring",
      "text-layer",
      "ocr",
      "figures",
      "cancelled",
    ] as const) {
      expect(progressBar(at(phase, 23, 5))).toBeNull();
    }
  });

  it("says only \"converting\" when there is nothing more to say", () => {
    expect(progressLabel(undefined)).toBe("converting");
    expect(progressLabel(at("starting", null, 0))).toBe("converting");
    // Reading, but the page count is not known: no number to show.
    expect(progressLabel(at("reading", null, 0))).toBe("converting");
    expect(progressBar(at("reading", null, 0))).toBeNull();
    expect(progressBar(undefined)).toBeNull();
  });
});

describe("extensionOf", () => {
  it("names a format the way the converter does: lower-case, no dot", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("dir/archive.tar.gz")).toBe("gz");
    expect(extensionOf(".hidden")).toBe("");
    expect(extensionOf("README")).toBe("");
  });
});
