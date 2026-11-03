import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowNotesWork, shapeOf } from "./HowNotesWork.js";

describe("How notes work: the first step in plain words", () => {
  it("names the kind of source and its parts", () => {
    expect(shapeOf({ label: "Book", partCount: 26, partWord: "chapter" })).toBe("a book in 26 chapters");
    expect(shapeOf({ label: "PDF", partCount: 9, partWord: "section" })).toBe("a PDF in 9 sections");
    expect(shapeOf({ label: "Documentation", partCount: 6, partWord: "chapter" })).toBe("documentation in 6 chapters");
  });

  it("does not count a source that came in whole", () => {
    expect(shapeOf({ label: "Email", partCount: 1, partWord: "message" })).toBe("an email");
    expect(shapeOf({ label: "Documentation", partCount: 1, partWord: "chapter" })).toBe("documentation");
  });

  it("says a workflow's deliveries and an agent's chapters as what they are", () => {
    expect(shapeOf({ label: "Meeting notes", partCount: 266, partWord: "item" })).toBe("266 items from a workflow");
    expect(shapeOf({ label: "Written by an agent", partCount: 4, partWord: "chapter" })).toBe("4 chapters written by an agent");
  });

  it("says only what it knows", () => {
    expect(shapeOf({ label: null, partCount: 3, partWord: "part" })).toBe("in 3 parts");
    expect(shapeOf({ label: null, partCount: 1, partWord: "part" })).toBe("");
  });
});

describe("How notes work: the last step counts the links", () => {
  const render = (links: number, fromElsewhere: number) =>
    renderToStaticMarkup(createElement(HowNotesWork, { example: { source: "Guide", shape: "", claim: "A claim", topic: null, topicNotes: 0, links, fromElsewhere } }));
  it("agrees with one note or many", () => {
    expect(render(1, 0)).toContain("1 note links to that one");
    expect(render(1, 1)).toContain("1 note links to that one, from another source");
    expect(render(3, 1)).toContain("3 notes link to that one, 1 of them from another source");
    expect(render(3, 2)).toContain("3 notes link to that one, 2 of them from other sources");
  });
});
