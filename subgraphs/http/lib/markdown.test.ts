import { describe, expect, it } from "vitest";
import { renderNoteMarkdown } from "./markdown.js";

const doc = {
  id: "n1",
  name: "Reactors store operations",
  documentType: "bai/knowledge-note",
  state: {
    global: {
      title: "Reactors store operations",
      description: "The reactor appends actions as operations.",
      noteType: "concept",
      status: "CANONICAL",
      topics: [{ name: "reactor" }],
      provenance: {
        author: "knowledge-agent",
        sourceOrigin: "DERIVED",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      content: "The body.",
    },
  },
};

describe("renderNoteMarkdown", () => {
  it("emits YAML frontmatter and the content", () => {
    const md = renderNoteMarkdown(doc, [], "http://h/api/x", "d");
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Reactors store operations"');
    expect(md).toContain("status: CANONICAL");
    expect(md).toContain("topics: [reactor]");
    expect(md).toContain("sourceOrigin: DERIVED");
    expect(md.endsWith("The body.")).toBe(true);
  });

  it("renders edges as absolute markdown links with the reason", () => {
    const md = renderNoteMarkdown(
      doc,
      [
        {
          direction: "out",
          documentId: "n2",
          linkType: "BUILDS_ON",
          title: "Other",
          reason: "Extends the claim",
          confidence: "grounded",
        },
      ],
      "http://h/api/x",
      "d",
    );
    expect(md).toContain(
      "[Other](http://h/api/x/notes/n2.md?drive=d) — Extends the claim",
    );
  });

  it("falls back to the document name and handles a missing content body", () => {
    const md = renderNoteMarkdown(
      { ...doc, state: { global: {} } },
      [],
      "http://h",
      "d",
    );
    expect(md).toContain('title: "Reactors store operations"');
  });
});