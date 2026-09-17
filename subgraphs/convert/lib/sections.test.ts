import { describe, expect, it } from "vitest";
import {
  SECTION_CHAR_CEILING,
  SECTION_MIN_CHARS,
  deriveSections,
} from "./sections.js";

const chunk = (text: string, headings: string[] = []) => ({ text, headings });

// The cut-level tests run with the floor disabled, so each mechanism is tested
// on its own; the floor has its own describe block below.
const cutOnly = { minSectionChars: 0 };

/**
 * The arms the main describe does not reach, because its helper always supplies
 * a `headings` array and its documents are never a single oversized chunk.
 */
describe("deriveSections — input shapes the happy path skips", () => {
  it("treats a chunk with no headings key at all as front matter", () => {
    // `chunk()` in this file always passes `[]`, so `headings` being *absent*
    // was never exercised — which is the case for a title page or a scanned
    // cover, where the extractor has no heading to report.
    const plan = deriveSections(
      [{ text: "preface" }, chunk("one", ["Record"]), chunk("two", ["Reduce"])],
      { documentName: "Book", ...cutOnly },
    );

    expect(plan.sections[0].title).toBe("Book — front matter");
    expect(plan.sections[0].headingPath).toEqual([]);
    expect(plan.cutLevel).toBe(1);
  });

  it("names the front matter after the document when nothing is headed", () => {
    const plan = deriveSections([{ text: "scan" }, { text: "scan 2" }], {
      documentName: "Invoice",
      ...cutOnly,
    });

    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].title).toBe("Invoice");
    expect(plan.cutLevel).toBe(0);
  });

  it("tests depth 2 against a chunk that is shallower than the cut", () => {
    // One H1 covers every chunk, so depth 1 cannot divide it; the depth-2 pass
    // then meets a chunk with only that single heading, which must not be
    // mistaken for a depth-2 path of its own.
    const plan = deriveSections(
      [
        chunk("intro", ["Book"]),
        chunk("a", ["Book", "Record"]),
        chunk("b", ["Book", "Reduce"]),
      ],
      { documentName: "Book", ...cutOnly },
    );

    expect(plan.cutLevel).toBe(2);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Book",
      "Record",
      "Reduce",
    ]);
  });

  it("leaves a single oversized chunk unsplit — no boundary left to cut on", () => {
    // Splitting happens at chunk boundaries, so a document that is one huge
    // chunk has nothing to divide it by, and must be reported as unsplit rather
    // than as one part of a split.
    const oversized = "x".repeat(SECTION_CHAR_CEILING + 100);
    const plan = deriveSections([{ text: oversized, headings: ["Only"] }], {
      documentName: "Book",
      minSectionChars: 0,
    });

    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].text).toBe(oversized);
    expect(plan.splitSections).toBe(0);
  });
});

describe("deriveSections — the cut level", () => {
  it("cuts at depth 1 when three H1s divide the document", () => {
    const plan = deriveSections(
      [
        chunk("one", ["Record"]),
        chunk("two", ["Reduce"]),
        chunk("three", ["Reflect"]),
      ],
      { documentName: "Book", ...cutOnly },
    );
    expect(plan.cutLevel).toBe(1);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Record",
      "Reduce",
      "Reflect",
    ]);
    expect(plan.sections[0].headingPath).toEqual(["Record"]);
  });

  it("falls to depth 2 when one H1 covers every chunk", () => {
    const plan = deriveSections(
      [
        chunk("a", ["Book", "Record"]),
        chunk("b", ["Book", "Reduce"]),
        chunk("c", ["Book", "Reflect"]),
      ],
      { documentName: "Book", ...cutOnly },
    );
    expect(plan.cutLevel).toBe(2);
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Record",
      "Reduce",
      "Reflect",
    ]);
    expect(plan.sections[0].headingPath).toEqual(["Book", "Record"]);
  });

  it("keeps chunks before the first heading as a front-matter section", () => {
    const plan = deriveSections(
      [chunk("preface"), chunk("one", ["Record"]), chunk("two", ["Reduce"])],
      { documentName: "Book", ...cutOnly },
    );
    expect(plan.sections[0].title).toBe("Book — front matter");
    expect(plan.sections[0].headingPath).toEqual([]);
    expect(plan.sections).toHaveLength(3);
  });

  it("returns one section when the document has no headings at all", () => {
    const plan = deriveSections([chunk("a"), chunk("b")], {
      documentName: "notes.md",
      ...cutOnly,
    });
    expect(plan.cutLevel).toBe(0);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].title).toBe("notes.md");
    expect(plan.sections[0].text).toBe("a\n\nb");
  });

  it("reports charCount as the joined text length and keeps chunk indexes", () => {
    const plan = deriveSections(
      [
        chunk("abc", ["A"]),
        chunk("de", ["A"]),
        chunk("f", ["B"]),
        chunk("g", ["C"]),
      ],
      { documentName: "Book", ...cutOnly },
    );
    const first = plan.sections.find((s) => s.title === "A");
    expect(first?.charCount).toBe("abc\n\nde".length);
    expect(first?.chunks).toEqual([0, 1]);
  });

  it("defaults the ceiling to the exported constant", () => {
    const plan = deriveSections([chunk("a", ["A"]), chunk("b", ["B"])], {
      documentName: "Book",
      ...cutOnly,
    });
    expect(plan.ceiling).toBe(SECTION_CHAR_CEILING);
  });

  it("subdivides a section over the ceiling and counts it", () => {
    const big = "x".repeat(30);
    const plan = deriveSections(
      [
        chunk(big, ["Chapter"]),
        chunk(big, ["Chapter"]),
        chunk(big, ["Chapter"]),
        chunk("small", ["Other"]),
        chunk("small", ["Third"]),
      ],
      { documentName: "Book", ceiling: 40, ...cutOnly },
    );
    expect(plan.splitSections).toBe(1);
    const parts = plan.sections.filter((s) => s.title.startsWith("Chapter"));
    expect(parts).toHaveLength(3);
    expect(parts.map((s) => s.title)).toEqual([
      "Chapter · part 1",
      "Chapter · part 2",
      "Chapter · part 3",
    ]);
    expect(parts.every((s) => s.charCount <= 40)).toBe(true);
  });
});

/**
 * The floor exists because of a measurement, not a preference: docling returns
 * a FLAT heading list on real books (97 of 99 chunks at depth 1), so "cut at
 * the shallowest heading" puts the title page, the praise page, `[ SIDE NOTE ]`
 * and `Warning` on equal footing with the chapters. On a real 238-page book the
 * cut rule alone produced 290 sections — more than one per page.
 */
describe("deriveSections — the floor", () => {
  it("defaults to the exported minimum", () => {
    const plan = deriveSections([chunk("x", ["A"]), chunk("y", ["B"])], {
      documentName: "Book",
    });
    expect(plan.minSectionChars).toBe(SECTION_MIN_CHARS);
  });

  it("folds an undersized section forward into the next one", () => {
    const body = "y".repeat(100);
    const plan = deriveSections(
      [
        chunk("praise", ["Praise for the Book"]),
        chunk(body, ["Chapter One"]),
        chunk(body, ["Chapter Two"]),
      ],
      { documentName: "Book", minSectionChars: 50 },
    );
    // The praise page is not a source; it opens Chapter One.
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(plan.sections[0].text.startsWith("praise")).toBe(true);
    expect(plan.sections[0].charCount).toBeGreaterThan(100);
    expect(plan.mergedSections).toBe(1);
  });

  it("folds a trailing undersized section back into the previous one", () => {
    const body = "y".repeat(100);
    const plan = deriveSections(
      [
        chunk(body, ["Chapter One"]),
        chunk(body, ["Chapter Two"]),
        chunk("index", ["Index"]),
      ],
      { documentName: "Book", minSectionChars: 50 },
    );
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(plan.sections[1].text.endsWith("index")).toBe(true);
    expect(plan.mergedSections).toBe(1);
  });

  it("keeps a document that is smaller than the floor as one section", () => {
    const plan = deriveSections(
      [chunk("short", ["Only"]), chunk("also", ["And"])],
      {
        documentName: "CV",
        minSectionChars: 50,
      },
    );
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].title).toBe("CV");
    expect(plan.sections[0].text).toBe("short\n\nalso");
  });

  it("never merges across the ceiling, and counts what it split", () => {
    const part = "z".repeat(60);
    const plan = deriveSections(
      [
        chunk(part, ["Chapter One"]),
        chunk(part, ["Chapter One"]),
        chunk(part, ["Chapter One"]),
        chunk(part, ["Chapter Two"]),
        chunk(part, ["Chapter Two"]),
        chunk(part, ["Chapter Two"]),
      ],
      { documentName: "Book", ceiling: 100, minSectionChars: 10 },
    );
    // 184 chars per chapter, ceiling 100, three paragraph-sized chunks each.
    expect(plan.sections).toHaveLength(6);
    expect(plan.splitSections).toBe(2);
  });
});

/**
 * Grouping is by contiguous run, not by heading key. Measured on a 238-page
 * book: `[ SIDE NOTE ]` recurs sixteen times, and collecting every occurrence
 * under one key stitched text from sixteen places into a single section, out
 * of reading order. A run ends when the path changes; what a folded sidebar
 * left in two is rejoined afterwards.
 */
describe("deriveSections — reading order", () => {
  const body = "y".repeat(100);

  it("does not stitch a recurring heading's occurrences into one section", () => {
    const plan = deriveSections(
      [
        chunk(body, ["Chapter One"]),
        chunk("aside", ["[ SIDE NOTE ]"]),
        chunk(body, ["Chapter Two"]),
        chunk("aside 2", ["[ SIDE NOTE ]"]),
        chunk(body, ["Chapter Three"]),
      ],
      { documentName: "Book", ...cutOnly },
    );
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Chapter One",
      "[ SIDE NOTE ]",
      "Chapter Two",
      "[ SIDE NOTE ]",
      "Chapter Three",
    ]);
    // Chunk order is document order, never regrouped.
    expect(plan.sections.flatMap((s) => s.chunks)).toEqual([0, 1, 2, 3, 4]);
  });

  it("rejoins a chapter that a folded sidebar had cut in two", () => {
    const plan = deriveSections(
      [
        chunk(body, ["Emotion"]),
        chunk("boxed note", ["[ SIDE NOTE ]"]),
        chunk(body, ["Emotion"]),
        chunk(body, ["Language"]),
      ],
      { documentName: "Book", minSectionChars: 50 },
    );
    expect(plan.sections.map((s) => s.title)).toEqual(["Emotion", "Language"]);
    expect(plan.sections[0].chunks).toEqual([0, 1, 2]);
    expect(plan.mergedSections).toBe(1);
    expect(plan.rejoinedSections).toBe(1);
    // The rejoined section lists every group it holds, sidebar included.
    expect(plan.sections[0].mergedFrom.map((p) => p.title)).toEqual([
      "Emotion",
      "[ SIDE NOTE ]",
      "Emotion",
    ]);
  });

  it("never rejoins front matter with front matter", () => {
    // Two headless runs would both carry an empty path; an empty path is not a
    // shared heading. (Only leading chunks are headless here, so the check is
    // that the front matter and a following section stay apart.)
    const plan = deriveSections(
      [chunk("cover"), chunk(body, ["One"]), chunk(body, ["Two"])],
      { documentName: "Book", minSectionChars: 0 },
    );
    expect(plan.rejoinedSections).toBe(0);
    expect(plan.sections).toHaveLength(3);
  });

  it("keeps a headless chunk that follows a heading inside that heading's run", () => {
    // A paragraph the extractor could not attribute to a heading belongs to the
    // section it appears in, not to the front matter at the top of the file.
    const plan = deriveSections(
      [chunk("a", ["One"]), { text: "unattributed" }, chunk("b", ["Two"])],
      { documentName: "Book", ...cutOnly },
    );
    expect(plan.sections.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(plan.sections[0].chunks).toEqual([0, 1]);
  });
});

/**
 * The name of a merged section. Measured on a two-page CV: forward folding
 * with "the last group names the section" produced a section titled
 * `MakerDAO SES` — an employer read as a heading — for text that was mostly
 * Core Competencies. The largest part is the one the section is about.
 */
describe("deriveSections — naming a merged section", () => {
  it("names a merged section after its largest part, not the one that tipped the floor", () => {
    const plan = deriveSections(
      [
        chunk("Petru, Lisbon"),
        chunk("t".repeat(70), ["Core Competencies"]),
        chunk("e".repeat(40), ["Professional Experience"]),
        chunk("m".repeat(45), ["MakerDAO SES"]),
        chunk("s".repeat(300), ["Selected Projects"]),
      ],
      { documentName: "cv.pdf", minSectionChars: 160 },
    );
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Core Competencies",
      "Selected Projects",
    ]);
    expect(plan.sections[0].headingPath).toEqual(["Core Competencies"]);
    expect(plan.sections[0].mergedFrom).toEqual([
      { title: "cv.pdf — front matter", headingPath: [], charCount: 13 },
      {
        title: "Core Competencies",
        headingPath: ["Core Competencies"],
        charCount: 70,
      },
      {
        title: "Professional Experience",
        headingPath: ["Professional Experience"],
        charCount: 40,
      },
      { title: "MakerDAO SES", headingPath: ["MakerDAO SES"], charCount: 45 },
    ]);
  });

  it("prefers the earlier part on a tie", () => {
    const plan = deriveSections(
      [
        chunk("aaaa", ["First"]),
        chunk("bbbb", ["Second"]),
        chunk("c".repeat(50), ["Third"]),
      ],
      { documentName: "Doc", minSectionChars: 9 },
    );
    expect(plan.sections[0].title).toBe("First");
  });

  it("leaves mergedFrom empty for a section that is exactly one group", () => {
    const plan = deriveSections([chunk("a", ["One"]), chunk("b", ["Two"])], {
      documentName: "Doc",
      ...cutOnly,
    });
    expect(plan.sections.every((s) => s.mergedFrom.length === 0)).toBe(true);
  });

  it("names a trailing fold after the section it folds back into, even when the tail is bigger", () => {
    // Folding back is an exception to "largest wins"? No: the tail is smaller
    // than the floor by definition, and the survivor is at least the floor.
    const plan = deriveSections(
      [
        chunk("x".repeat(100), ["Chapter"]),
        chunk("index".repeat(4), ["Index"]),
      ],
      { documentName: "Book", minSectionChars: 50 },
    );
    expect(plan.sections.map((s) => s.title)).toEqual(["Chapter"]);
    expect(plan.sections[0].mergedFrom.map((p) => p.title)).toEqual([
      "Chapter",
      "Index",
    ]);
  });
});

/**
 * The markdown is where tables are rendered correctly; chunk text flattens
 * them (measured: an education table came back as `🟤, 1 = … , 2 = …`
 * triplets). A section that knows its span of the markdown can hand out the
 * table intact — so each section locates its first heading in the markdown.
 */
describe("deriveSections — markdown ranges", () => {
  const md = [
    "Cover line",
    "",
    "## Core Competencies",
    "",
    "Languages &amp; Frameworks: TypeScript",
    "",
    "## Copenhagen, Denmark",
    "",
    "first stay",
    "",
    "## Copenhagen, Denmark",
    "",
    "second stay",
    "",
    "## Education",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
  ].join("\n");

  const offsetOf = (line: string, nth = 0) => {
    let from = 0;
    for (let i = 0; i <= nth; i++) {
      from = md.indexOf(line, from) + (i < nth ? line.length : 0);
    }
    return from;
  };

  it("locates each section at its heading line and makes the ranges tile the markdown", () => {
    const plan = deriveSections(
      [
        chunk("Cover line"),
        chunk("Languages & Frameworks: TypeScript", ["Core Competencies"]),
        chunk("first stay", ["Copenhagen, Denmark"]),
        chunk("second stay", ["Copenhagen, Denmark"]),
        chunk("a, b = 1, 2", ["Education"]),
      ],
      { documentName: "cv.pdf", markdown: md, ...cutOnly },
    );
    // Two adjacent runs with the same path are one run — so three headed
    // sections plus the front matter.
    expect(plan.sections.map((s) => s.title)).toEqual([
      "cv.pdf — front matter",
      "Core Competencies",
      "Copenhagen, Denmark",
      "Education",
    ]);
    const ranges = plan.sections.map((s) => s.markdownRange);
    expect(ranges[0]).toEqual({
      start: 0,
      end: offsetOf("## Core Competencies"),
    });
    expect(ranges[1]).toEqual({
      start: offsetOf("## Core Competencies"),
      end: offsetOf("## Copenhagen, Denmark"),
    });
    expect(ranges[2]).toEqual({
      start: offsetOf("## Copenhagen, Denmark"),
      end: offsetOf("## Education"),
    });
    expect(ranges[3]).toEqual({
      start: offsetOf("## Education"),
      end: md.length,
    });
    // The table is in the Education slice, as a table.
    const r = ranges[3]!;
    expect(md.slice(r.start, r.end)).toContain("| 1 | 2 |");
  });

  it("resolves a recurring heading to its next occurrence, not its first", () => {
    // The two `Copenhagen, Denmark` runs are separated here, so the second one
    // must land on the second heading line.
    const plan = deriveSections(
      [
        chunk("Languages & Frameworks: TypeScript", ["Core Competencies"]),
        chunk("first stay", ["Copenhagen, Denmark"]),
        chunk("interlude", ["Core Competencies"]),
        chunk("second stay", ["Copenhagen, Denmark"]),
      ],
      { documentName: "cv.pdf", markdown: md, ...cutOnly },
    );
    expect(plan.sections[3].markdownRange?.start).toBe(
      offsetOf("## Copenhagen, Denmark", 1),
    );
    // `Core Competencies` only occurs once in the markdown, so its second run
    // has nothing to point at — the earlier section's range extends over it.
    expect(plan.sections[2].markdownRange).toBeNull();
    expect(plan.sections[1].markdownRange?.end).toBe(
      offsetOf("## Copenhagen, Denmark", 1),
    );
  });

  it("matches a heading through entity encoding, emphasis and case", () => {
    const plan = deriveSections(
      [chunk("x", ["Languages & Frameworks"]), chunk("y", ["Other"])],
      {
        documentName: "d",
        markdown: "# languages &amp; **Frameworks**\n\nx\n\n# Other\n\ny\n",
        ...cutOnly,
      },
    );
    expect(plan.sections[0].markdownRange?.start).toBe(0);
    expect(plan.sections[1].markdownRange?.start).toBe(
      "# languages &amp; **Frameworks**\n\nx\n\n".length,
    );
  });

  it("does not match a heading that only shares a prefix", () => {
    const plan = deriveSections(
      [chunk("x", ["Copenhagen"]), chunk("y", ["Other"])],
      {
        documentName: "d",
        markdown: "## Copenhagen, Denmark\n\nx\n\n## Other\n\ny\n",
        ...cutOnly,
      },
    );
    expect(plan.sections[0].markdownRange).toBeNull();
  });

  it("gives a merged section the range of its first located part", () => {
    const plan = deriveSections(
      [
        chunk("Cover line"),
        chunk("Languages & Frameworks: TypeScript".repeat(2), [
          "Core Competencies",
        ]),
        chunk("first stay", ["Copenhagen, Denmark"]),
        chunk("second stay", ["Copenhagen, Denmark"]),
        chunk("a".repeat(120), ["Education"]),
      ],
      { documentName: "cv.pdf", markdown: md, minSectionChars: 100 },
    );
    expect(plan.sections.map((s) => s.title)).toEqual([
      "Core Competencies",
      "Education",
    ]);
    expect(plan.sections[0].markdownRange).toEqual({
      start: 0,
      end: offsetOf("## Education"),
    });
    expect(plan.sections[1].markdownRange).toEqual({
      start: offsetOf("## Education"),
      end: md.length,
    });
  });

  it("reports null ranges when no markdown is given", () => {
    const plan = deriveSections([chunk("a", ["One"]), chunk("b", ["Two"])], {
      documentName: "d",
      ...cutOnly,
    });
    expect(plan.sections.every((s) => s.markdownRange === null)).toBe(true);
  });

  it("reports null ranges for the parts of a ceiling split", () => {
    const big = "x".repeat(30);
    const plan = deriveSections(
      [
        chunk(big, ["Chapter"]),
        chunk(big, ["Chapter"]),
        chunk("small", ["Other"]),
      ],
      {
        documentName: "d",
        markdown: "# Chapter\n\n…\n\n# Other\n\nsmall\n",
        ceiling: 40,
        ...cutOnly,
      },
    );
    const parts = plan.sections.filter((s) => s.title.startsWith("Chapter"));
    expect(parts).toHaveLength(2);
    expect(parts.every((s) => s.markdownRange === null)).toBe(true);
    expect(plan.sections.at(-1)?.markdownRange?.start).toBe(
      "# Chapter\n\n…\n\n".length,
    );
  });

  it("starts the front matter at offset 0 even when the document collapses to one section", () => {
    const plan = deriveSections([chunk("short"), chunk("also", ["A"])], {
      documentName: "note.md",
      markdown: "short\n\n# A\n\nalso\n",
      minSectionChars: 100,
    });
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0].markdownRange).toEqual({
      start: 0,
      end: "short\n\n# A\n\nalso\n".length,
    });
  });
});
