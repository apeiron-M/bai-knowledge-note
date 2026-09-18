import { describe, expect, it } from "vitest";
import type { IntakeFile, Section } from "./intake-model.js";
import {
  publishPlan,
  sanitiseFolderName,
  sectionTitle,
} from "./intake-publish.js";

const section = (title: string, text: string, content = text): Section => ({
  title,
  headingPath: [title],
  text,
  content,
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

const file = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Design for How People Think.pdf",
  size: 10,
  mimeType: "application/pdf",
  state: "converted",
  sourceType: "BOOK_CHAPTER",
  folderName: "Design for How People Think",
  selected: [],
  converted: {
    filename: "Design for How People Think.pdf",
    format: "pdf",
    plan,
    sections: [section("One", "first"), section("Two", "second")],
  },
  ...over,
});

describe("sanitiseFolderName", () => {
  it("removes the slash the route refuses, rather than letting it 400", () => {
    // source-folders.ts: name "is one folder, not a path: it cannot contain '/'".
    expect(sanitiseFolderName("Draft 1/2")).toBe("Draft 1-2");
    expect(sanitiseFolderName("a\\b")).toBe("a-b");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitiseFolderName("  Design   for  How \n People Think ")).toBe(
      "Design for How People Think",
    );
  });

  it("falls back rather than sending an empty name", () => {
    expect(sanitiseFolderName("   ")).toBe("Untitled");
  });

  it("keeps a long name usable instead of letting a node name sprawl", () => {
    expect(sanitiseFolderName("x".repeat(400)).length).toBe(120);
  });
});

describe("sectionTitle", () => {
  it("uses the section's own title", () => {
    expect(sectionTitle(section("Record", "t"), 0, "Book")).toBe("Record");
  });

  it("falls back to the document and the part number, because title is required", () => {
    // POST sources answers 400 when title is empty, so a section the extractor
    // could not name must still arrive named.
    expect(sectionTitle(section("   ", "t"), 2, "Book")).toBe("Book · part 3");
  });

  it("caps a runaway title", () => {
    expect(sectionTitle(section("t".repeat(300), "t"), 0, "Book").length).toBe(
      120,
    );
  });
});

describe("publishPlan", () => {
  it("includes only the ticked sections, in document order", () => {
    const result = publishPlan(file({ selected: [false, true] }));
    expect(result.sources.map((s) => s.title)).toEqual(["Two"]);
    expect(result.sources[0].sectionIndex).toBe(1);
  });

  it("carries the file's type onto every source", () => {
    const result = publishPlan(file({ selected: [true, true] }));
    expect(result.sources.every((s) => s.sourceType === "BOOK_CHAPTER")).toBe(
      true,
    );
  });

  it("skips a section with no content, and counts it, because content is required", () => {
    const result = publishPlan(
      file({
        selected: [true, true, true],
        converted: {
          filename: "b.pdf",
          format: "pdf",
          plan,
          sections: [
            section("One", "first"),
            section("Two", "   "),
            section("Three", "third"),
          ],
        },
      }),
    );
    expect(result.sources.map((s) => s.title)).toEqual(["One", "Three"]);
    expect(result.skipped).toBe(1);
  });

  it("sends the markdown slice as content, not the chunk text", () => {
    // The chunk text of a table is `🟤, 1 = … , 2 = …` triplets; the markdown
    // is the table. `content` is what the convert step sliced from the markdown.
    const result = publishPlan(
      file({
        selected: [true],
        converted: {
          filename: "cv.pdf",
          format: "pdf",
          plan,
          sections: [
            section(
              "Education",
              "🟤, 1 = Academy. , 2 = 2016",
              "## Education\n\n| Academy | 2016 |",
            ),
          ],
        },
      }),
    );
    expect(result.sources[0].content).toBe(
      "## Education\n\n| Academy | 2016 |",
    );
  });

  it("produces an empty plan when nothing is ticked", () => {
    const result = publishPlan(file({ selected: [false, false] }));
    expect(result.sources).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it("produces an empty plan for a row that was already published", () => {
    const result = publishPlan(
      file({ selected: [true, true], publishedIds: ["s1", "s2"] }),
    );
    expect(result.sources).toEqual([]);
  });

  it("uses the sanitisable folder name the user may have edited", () => {
    const result = publishPlan(file({ folderName: "Book / Vol 2" }));
    expect(result.folderName).toBe("Book - Vol 2");
  });

  it("does not mutate the file it was given", () => {
    const f = file({ selected: [true, false] });
    const before = JSON.stringify(f);
    publishPlan(f);
    expect(JSON.stringify(f)).toBe(before);
  });
});
