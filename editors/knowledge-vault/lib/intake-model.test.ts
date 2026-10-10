import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  aboutEstimate,
  acceptedExtensions,
  addFiles,
  batchSummary,
  displayName,
  fileFacts,
  formatBadge,
  formatElapsed,
  formatsSentence,
  readingTime,
  reviewNotes,
  sourceTypeWords,
  waitingLine,
  withoutOwnHeading,
  freeFolderName,
  knownLine,
  shortDate,
  vaultIndexOf,
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
  type ConvertedFile,
  type IntakeFile,
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
    if (!over.ok) expect(over.reason).toBe("it's 120.0 MB, over the 100 MB limit for one file.");
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

describe("progress — what a reading row says", () => {
  const at = (
    phase: ConversionProgress["phase"],
    pages: number | null,
    pagesDone: number,
  ): ConversionProgress => ({ phase, pages, pagesDone, elapsedMs: 1000 });

  it("says how many pages it is reading when the service reads in one pass, over a bar that claims no share", () => {
    // One pass: the page count is known, how far the pass has got is not.
    expect(progressLabel(at("reading", 23, 0))).toBe("Reading 23 pages");
    expect(progressLabel(at("reading", 1, 0))).toBe("Reading 1 page");
    expect(progressBar(at("reading", 23, 0))).toEqual({ kind: "indeterminate" });
  });

  it("keeps the measured page count from a service that counts pages as they finish", () => {
    expect(progressLabel(at("reading", 23, 12))).toBe("Reading page 12 of 23");
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

  it("names the later phases in plain words, over a bar that only shows work happening", () => {
    expect(progressLabel(at("structuring", 23, 23))).toBe("Finding the sections");
    expect(progressLabel(at("text-layer", null, 0))).toBe("Reading the text");
    expect(progressLabel(at("ocr", 4, 0))).toBe("Reading the scan");
    expect(progressLabel(at("figures", 23, 0))).toBe("Cutting out the figures");
    expect(progressLabel(at("figures", 23, 7))).toBe(
      "Cutting out the figures, 7 so far",
    );
    expect(progressLabel(at("cancelled", 23, 0))).toBe("Stopped");
    for (const phase of ["structuring", "text-layer", "ocr", "figures"] as const) {
      expect(progressBar(at(phase, 23, 5))).toEqual({ kind: "indeterminate" });
    }
  });

  it("says only \"Reading\" when there is nothing more to say", () => {
    expect(progressLabel(undefined)).toBe("Reading");
    expect(progressLabel(at("starting", null, 0))).toBe("Reading");
    // Reading, but the page count is not known: no number to show.
    expect(progressLabel(at("reading", null, 0))).toBe("Reading");
    expect(progressBar(at("reading", null, 0))).toEqual({ kind: "indeterminate" });
    expect(progressBar(undefined)).toEqual({ kind: "indeterminate" });
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

// --- what a person reads ------------------------------------------------------

const fileOf = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Report.pdf",
  size: 2048,
  mimeType: "application/pdf",
  state: "converted",
  sourceType: "ARTICLE",
  folderName: "Report",
  selected: [true],
  ...over,
});

const convertedWith = (over: Partial<ConvertedFile> = {}): ConvertedFile => ({
  filename: "Report.pdf",
  format: "pdf",
  sections: [sec("One", "Body.")],
  plan,
  ...over,
});

describe("names, kinds and lengths, as a person reads them", () => {
  it("shows a file by its name without the extension, and the format on its icon", () => {
    expect(displayName("State-of-AI-Report-2026.pdf")).toBe(
      "State-of-AI-Report-2026",
    );
    expect(formatBadge("Team handbook.docx")).toBe("DOCX");
    expect(formatBadge("notes.markdown")).toBe("MARK");
    expect(formatBadge("README")).toBe("FILE");
  });

  it("gives a section's length as reading time, never under a minute", () => {
    expect(readingTime(0)).toBe("1 min");
    expect(readingTime(2563)).toBe("2 min");
    expect(readingTime(3767)).toBe("3 min");
    expect(readingTime(6 * 230 * 75)).toBe("1 h 15 min");
    expect(readingTime(6 * 230 * 120)).toBe("2 h");
  });

  it("shows time spent the way a timer does", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(41_400)).toBe("0:41");
    expect(formatElapsed(725_000)).toBe("12:05");
    expect(formatElapsed(3_729_000)).toBe("1:02:09");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("names the source kinds in words, one and many", () => {
    expect(sourceTypeWords("BOOK_CHAPTER")).toEqual({
      one: "Book chapter",
      many: "book chapters",
    });
    expect(sourceTypeWords("ARTICLE").many).toBe("articles");
    // A kind added to the model later still reads as words.
    expect(sourceTypeWords("FIELD_NOTES")).toEqual({
      one: "Field notes",
      many: "field notes",
    });
  });

  it("says the OCR estimate as a person would", () => {
    expect(aboutEstimate(240)).toBe("about 4 min");
    expect(aboutEstimate(42)).toBe("about 40 s");
  });
});

describe("reviewNotes — what to know before adding a file", () => {
  it("has nothing to say about a file read cleanly", () => {
    const file = fileOf({
      converted: convertedWith({
        textSource: "docling",
        quality: { coverage: 0.99, rawTokens: 100, formulas: { total: 0, decoded: 0 }, images: 0 },
      }),
    });
    expect(reviewNotes(file)).toEqual([]);
  });

  it("warns when part of the text is missing, rounded the way a person says it", () => {
    const file = fileOf({
      converted: convertedWith({
        quality: { coverage: 0.797, rawTokens: 100, formulas: { total: 0, decoded: 0 }, images: 37 },
      }),
    });
    expect(reviewNotes(file)).toEqual([
      expect.objectContaining({
        tone: "warn",
        short: "About 80% of the text was captured",
      }),
    ]);
  });

  it("warns about a file read without its layout, or read from a scan", () => {
    const flat = fileOf({ converted: convertedWith({ textSource: "pdfjs" }) });
    expect(reviewNotes(flat)[0]).toMatchObject({
      tone: "warn",
      short: "Read without its layout",
    });
    const scan = fileOf({ converted: convertedWith({ ocr: "tesseract" }) });
    expect(reviewNotes(scan)[0]).toMatchObject({
      tone: "warn",
      short: "Read from a scan",
    });
    expect(reviewNotes(scan)[0].long).toContain("Check names and numbers");
  });
});

describe("fileFacts — the review's line about the file", () => {
  const figure = (kind: "picture" | "formula", i: number) => ({
    id: `${kind}-${i}`,
    kind,
    page: 1,
    placeholderIndex: i,
    alt: "",
    mimeType: "image/png",
    width: 1,
    height: 1,
    bytesBase64: "",
  });

  it("says the format, the size and the pages", () => {
    expect(fileFacts(fileOf({ converted: convertedWith({ pages: 244 }) }), "38.9 MB")).toBe(
      "PDF, 38.9 MB, 244 pages.",
    );
    expect(fileFacts(fileOf(), "2 KB")).toBe("PDF, 2 KB.");
  });

  it("counts the figures and formulas that will be attached, and the ones left out for size", () => {
    const file = fileOf({
      converted: convertedWith({
        figures: [figure("picture", 0), figure("picture", 1), figure("formula", 0)],
        figureStats: { pictures: 3, formulas: 1, located: 1, skipped: 0, droppedForBudget: 1 },
      }),
    });
    expect(fileFacts(file, "1 MB")).toBe(
      "PDF, 1 MB. Its 2 figures are kept as images. 1 formula is kept as images too. 1 more was left out to keep the sources small.",
    );
  });
});

describe("what the picker accepts, and how it is named", () => {
  it("takes the converter's formats and the extensions it reads with its models", () => {
    // `image` is a family, not an extension: a PNG gets in through the models' list.
    const accepted = acceptedExtensions(["pdf", "docx", "image"], ["pdf", "PNG", ".jpg"]);
    expect(accepted).toEqual(["pdf", "docx", "image", "png", "jpg"]);
    expect(validateFile({ name: "chart.png", size: 10 }, accepted).ok).toBe(true);
    expect(validateFile({ name: "chart.png", size: 10 }, ["pdf", "image"]).ok).toBe(false);
  });

  it("names the families people look for, and says \"and more\" rather than a count that could be wrong", () => {
    expect(
      formatsSentence(["pdf", "docx", "pptx", "xlsx", "html", "md", "png", "vtt"]),
    ).toBe("PDF, Word, PowerPoint, Excel, web pages, images, Markdown and more");
    expect(formatsSentence(["pdf", "md"])).toBe("PDF and Markdown");
    expect(formatsSentence(["pdf"])).toBe("PDF");
    expect(formatsSentence([])).toBe("");
  });

  it("refuses in plain words", () => {
    const refused = validateFile({ name: "notes.xyz", size: 10 }, formats);
    expect(refused).toEqual({ ok: false, reason: "the vault can't read .xyz files." });
    expect(validateFile({ name: "empty.pdf", size: 0 }, formats)).toEqual({
      ok: false,
      reason: "the file is empty.",
    });
  });
});

describe("batchSummary — the sentence under \"Adding 6 files\"", () => {
  const row = (state: IntakeFile["state"], over: Partial<IntakeFile> = {}) =>
    fileOf({ state, ...over });

  it("counts what needs the person first, and leaves out what is zero", () => {
    const files = [
      row("converted", { converted: convertedWith() }),
      row("converted", { converted: convertedWith() }),
      row("failed"),
      row("converting"),
      row("converting"),
      row("queued"),
      row("converted", { converted: convertedWith(), publishedIds: ["s1"] }),
    ];
    expect(batchSummary(files)).toEqual([
      { text: "2 ready for you", tone: "ready" },
      { text: "1 needs a look", tone: "look" },
      { text: "2 reading" },
      { text: "1 waiting" },
      { text: "1 added" },
    ]);
  });

  it("counts a scan waiting for the go-ahead as needing a look", () => {
    const scan = row("converted", {
      converted: convertedWith({
        sections: [],
        needsOcr: { via: "tesseract", estimateSeconds: 240 },
      }),
    });
    expect(batchSummary([scan, row("failed")])).toEqual([
      { text: "2 need a look", tone: "look" },
    ]);
  });
});

describe("waitingLine — what a waiting file waits for", () => {
  const laneOf = (name: string) => (/\.(pdf|png)$/.test(name) ? "models" : "other");
  const q = (id: string, name: string, state: IntakeFile["state"] = "queued", over: Partial<IntakeFile> = {}) =>
    fileOf({ id, name, state, ...over });

  it("names the file it starts after, when it is next in its lane", () => {
    const files = [q("a", "Board-pack.pdf", "converting"), q("b", "Lease.pdf"), q("c", "Scan.pdf")];
    expect(waitingLine(files[1], files, laneOf)).toBe(
      "Waiting. Starts when Board-pack is read.",
    );
    expect(waitingLine(files[2], files, laneOf)).toBe("Waiting its turn.");
  });

  it("does not wait on a file in the other lane", () => {
    const files = [q("a", "Board-pack.pdf", "converting"), q("b", "notes.md")];
    expect(waitingLine(files[1], files, laneOf)).toBe("Waiting.");
  });

  it("says so when the lane has several files reading, or the reader is busy", () => {
    const files = [q("a", "a.md", "converting"), q("b", "b.md", "converting"), q("c", "c.md")];
    expect(waitingLine(files[2], files, laneOf)).toBe(
      "Waiting. Starts when one of the files being read is done.",
    );
    const busy = q("d", "d.pdf", "queued", {
      error: "The reader is busy with another file, so it will try again shortly.",
    });
    expect(waitingLine(busy, [busy], laneOf)).toBe(
      "Waiting. The reader is busy with another file, so it will try again shortly.",
    );
  });
});

describe("withoutOwnHeading — the review shows a section's title once", () => {
  it("drops the opening heading when it is the section's title", () => {
    expect(withoutOwnHeading("## Tech investment\n\nBudgets move.", "Tech investment")).toBe(
      "Budgets move.",
    );
    expect(withoutOwnHeading("# **Foreword** #\nText", "Foreword")).toBe("Text");
  });

  it("keeps any other opening heading, and text with none", () => {
    expect(withoutOwnHeading("# The report\n\n## Foreword\n\nText", "Foreword")).toBe(
      "# The report\n\n## Foreword\n\nText",
    );
    expect(withoutOwnHeading("Plain text.", "Foreword")).toBe("Plain text.");
    expect(withoutOwnHeading("## \n\nText", "")).toBe("## \n\nText");
  });
});

describe("files the vault already holds", () => {
  it("finds the first folder name not taken", () => {
    expect(freeFolderName("Report", new Set())).toBe("Report");
    expect(freeFolderName("Report", new Set(["Report"]))).toBe("Report (2)");
    expect(freeFolderName("Report", new Set(["Report", "Report (2)"]))).toBe("Report (3)");
  });

  it("says a date the short way, with the year only when it is another one", () => {
    const now = new Date("2026-10-10T12:00:00");
    expect(shortDate("2026-10-08T09:00:00", now)).toBe("8 Oct");
    expect(shortDate("2025-03-02T09:00:00", now)).toBe("2 Mar 2025");
    expect(shortDate(null, now)).toBeNull();
    expect(shortDate("not a date", now)).toBeNull();
  });

  it("says where the earlier copy is, or that it is in this batch", () => {
    const now = new Date("2026-10-10T12:00:00");
    expect(
      knownLine({ folderName: "Report", sources: 12, addedAt: "2026-10-08T09:00:00" }, now),
    ).toEqual({
      lead: "Already in the vault.",
      detail: "Added on 8 Oct as 12 sources in Sources › Report.",
    });
    expect(knownLine({ folderName: null, sources: 1, addedAt: null }, now).detail).toBe(
      "Added as 1 source.",
    );
    expect(
      knownLine({ folderName: null, sources: 0, addedAt: null, inBatch: "Report.pdf" }, now),
    ).toEqual({ lead: "Same file as Report.", detail: "It's already in this batch." });
  });

  it("indexes the vault's originals: how many sources, the first time, the folder most are in", () => {
    const index = vaultIndexOf(
      [
        { originalRef: "ref-a", folderName: "Report", addedAt: "2026-10-09T10:00:00Z" },
        { originalRef: "ref-a", folderName: "Report", addedAt: "2026-10-08T10:00:00Z" },
        { originalRef: "ref-a", folderName: "Report (2)", addedAt: "2026-10-10T10:00:00Z" },
        { originalRef: null, folderName: null, addedAt: null }, // pasted text: nothing to match
        { originalRef: "ref-b", folderName: null, addedAt: null },
      ],
      ["Report", "Report (2)"],
    );
    expect(index.originals.get("ref-a")).toEqual({
      folderName: "Report",
      sources: 3,
      addedAt: "2026-10-08T10:00:00Z",
    });
    expect(index.originals.get("ref-b")).toEqual({ folderName: null, sources: 1, addedAt: null });
    expect(index.originals.size).toBe(2);
    expect([...index.folders]).toEqual(["Report", "Report (2)"]);
  });

  it("counts a held duplicate as needing the person", () => {
    const held = fileOf({ state: "duplicate", known: { folderName: "R", sources: 1, addedAt: null } });
    expect(needsUser([held])).toBe(1);
    expect(batchSummary([held])).toEqual([{ text: "1 needs a look", tone: "look" }]);
  });

  it("tells the review why a file goes into a folder of its own", () => {
    const renamed = fileOf({
      converted: convertedWith(),
      folderName: "Report (2)",
      renamedFrom: "Report",
    });
    expect(reviewNotes(renamed)).toEqual([
      expect.objectContaining({ tone: "info", short: "Goes in “Report (2)”" }),
    ]);
    expect(reviewNotes(renamed)[0].long).toContain("already holds another file's sections");
    expect(reviewNotes({ ...renamed, addAgain: true })[0].long).toContain(
      "An earlier copy of this file is in Sources › Report",
    );
  });

  it("says a file is being checked against the vault before it is read", () => {
    const file = fileOf({ state: "queued" });
    expect(waitingLine(file, [file], () => "models", true)).toBe(
      "Checking whether it's already in the vault…",
    );
    expect(waitingLine({ ...file, check: "clear" }, [file], () => "models", true)).toBe(
      "Waiting.",
    );
  });
});
