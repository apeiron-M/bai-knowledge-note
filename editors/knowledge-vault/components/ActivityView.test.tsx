import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityRowLabel,
  docKindLabel,
  filterCountLine,
  FILTER_TYPES,
  OP_ICONS,
} from "./ActivityView.js";

describe("Activity filters", () => {
  it("lifecycle lists only operations a note model defines", () => {
    expect(FILTER_TYPES.lifecycle.ops).toEqual([
      "SUBMIT_FOR_REVIEW",
      "APPROVE_NOTE",
      "REJECT_NOTE",
      "ARCHIVE_NOTE",
      "RESTORE_NOTE",
    ]);
    expect(OP_ICONS.SET_STATUS).toBeUndefined();
  });

  it("content includes PATCH_CONTENT", () => {
    expect(FILTER_TYPES.content.ops).toContain("PATCH_CONTENT");
  });

  it("links covers the three link operations the indexer records, plus v1's three", () => {
    expect(FILTER_TYPES.links.ops).toEqual([
      "ADD_RELATIONSHIP",
      "REMOVE_RELATIONSHIP",
      "UPDATE_RELATIONSHIP",
      "ADD_LINK",
      "REMOVE_LINK",
      "UPDATE_LINK_TYPE",
    ]);
    for (const op of FILTER_TYPES.links.ops) expect(OP_ICONS[op]).toBeTruthy();
    expect(OP_ICONS.PATCH_CONTENT).toBeTruthy();
  });
});

describe("filterCountLine", () => {
  it("names the filter and the window it ran over", () => {
    expect(filterCountLine(12, "lifecycle")).toBe("12 changes (Lifecycle) in the latest 200");
    expect(filterCountLine(1, "links")).toBe("1 change (Links) in the latest 200");
    expect(filterCountLine(0, "content")).toBe("0 changes (Content) in the latest 200");
  });

  it("is plain with no filter", () => {
    expect(filterCountLine(200, "all")).toBe("200 changes");
    expect(filterCountLine(1, "all")).toBe("1 change");
  });
});

describe("row titles", () => {
  const byId = new Map([
    ["doc-1234567890", { id: "doc-1234567890", title: "Caching claim", documentType: "bai/knowledge-note", noteType: "claim" }],
    ["src-1", { id: "src-1", title: "Chapter 3", documentType: "bai/source", noteType: null }],
  ]);

  it("shows the document's title and kind", () => {
    const html = renderToStaticMarkup(<ActivityRowLabel documentId="doc-1234567890" byId={byId} />);
    expect(html).toContain("Caching claim");
    expect(html).toContain("note");
    expect(html).not.toContain("doc-1234");
  });

  it("names a source as a source", () => {
    expect(docKindLabel("bai/source")).toBe("source");
    expect(docKindLabel("bai/knowledge-note")).toBe("note");
    expect(docKindLabel("bai/moc")).toBe("topic");
    expect(docKindLabel("bai/tension")).toBe("tension");
  });

  it("falls back to the short id for a document the index does not know", () => {
    const html = renderToStaticMarkup(<ActivityRowLabel documentId="abcdef1234567890" byId={byId} />);
    expect(html).toContain("abcdef12");
    expect(html).not.toContain("abcdef1234567890");
  });
});
