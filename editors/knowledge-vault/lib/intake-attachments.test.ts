import { describe, expect, it } from "vitest";
import {
  addAttachmentInput,
  bytesFromBase64,
  countOccurrences,
  figuresInSection,
  FORMULA_PLACEHOLDER,
  PICTURE_PLACEHOLDER,
  replaceNth,
  rewriteWithAttachments,
} from "./intake-attachments.js";
import type { ConversionFigure } from "./intake-model.js";

const fig = (
  kind: ConversionFigure["kind"],
  index: number,
): ConversionFigure => ({
  id: `${kind}-${index + 1}`,
  kind,
  page: 3,
  placeholderIndex: index,
  alt: `${kind} ${index + 1}, page 3${kind === "formula" ? " — not decoded" : ""}`,
  mimeType: "image/png",
  width: 10,
  height: 4,
  bytesBase64: "iVBORw0KGgo=",
});

// A document whose markdown holds F0 · F1 · P0 · F2 · P1, split into two
// sections: the first slice carries F0, F1, P0; the second F2, P1.
const first = {
  content: `Intro\n\n${FORMULA_PLACEHOLDER}\n\nthen\n\n${FORMULA_PLACEHOLDER}\n\n${PICTURE_PLACEHOLDER}\n`,
  placeholderBase: { picture: 0, formula: 0 },
};
const second = {
  content: `More\n\n${FORMULA_PLACEHOLDER}\n\n${PICTURE_PLACEHOLDER}\n`,
  placeholderBase: { picture: 1, formula: 2 },
};
const all = [
  fig("formula", 0),
  fig("formula", 1),
  fig("formula", 2),
  fig("picture", 0),
  fig("picture", 1),
];

describe("figuresInSection", () => {
  it("maps document-wide indices to the section's own, by kind", () => {
    expect(
      figuresInSection(first, all).map((p) => `${p.figure.id}@${p.localIndex}`),
    ).toEqual(["formula-1@0", "formula-2@1", "picture-1@0"]);
    expect(
      figuresInSection(second, all).map(
        (p) => `${p.figure.id}@${p.localIndex}`,
      ),
    ).toEqual(["formula-3@0", "picture-2@0"]);
  });

  it("places nothing in a section without a markdown range — its placeholders stay", () => {
    expect(
      figuresInSection({ content: first.content, placeholderBase: null }, all),
    ).toEqual([]);
  });

  it("ignores a figure whose placeholder is beyond the section's count (a service/slice disagreement)", () => {
    expect(figuresInSection(second, [fig("formula", 9)])).toEqual([]);
  });
});

describe("rewriteWithAttachments", () => {
  it("replaces each placed placeholder with an image whose src is the attachment ref, alt intact", () => {
    const refs: Record<string, string> = {
      "formula-1": "attachment://v1:" + "1".repeat(64),
      "formula-2": "attachment://v1:" + "2".repeat(64),
      "picture-1": "attachment://v1:" + "a".repeat(64),
    };
    const { content, attached } = rewriteWithAttachments(
      first,
      all,
      (f) => refs[f.id],
    );
    expect(content).toBe(
      `Intro\n\n![formula 1, page 3 — not decoded](${refs["formula-1"]})\n\nthen\n\n![formula 2, page 3 — not decoded](${refs["formula-2"]})\n\n![picture 1, page 3](${refs["picture-1"]})\n`,
    );
    expect(attached.map((f) => f.id)).toEqual([
      "formula-1",
      "formula-2",
      "picture-1",
    ]);
  });

  it("leaves the placeholder of a figure that has no ref (hashing failed) and still places the others", () => {
    const { content, attached } = rewriteWithAttachments(first, all, (f) =>
      f.id === "formula-1" ? undefined : "attachment://v1:" + "c".repeat(64),
    );
    expect(countOccurrences(content, FORMULA_PLACEHOLDER)).toBe(1);
    expect(content.indexOf(FORMULA_PLACEHOLDER)).toBeLessThan(
      content.indexOf("![formula 2"),
    );
    expect(attached.map((f) => f.id)).toEqual(["formula-2", "picture-1"]);
  });
});

describe("helpers", () => {
  it("replaceNth touches only the n-th occurrence", () => {
    expect(replaceNth("a x b x c", "x", 1, "Y")).toBe("a x b Y c");
    expect(replaceNth("a x b x c", "x", 5, "Y")).toBe("a x b x c");
  });
  it("bytesFromBase64 decodes the wire form", () => {
    expect([...bytesFromBase64("iVBORw0KGgo=")]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
  it("addAttachmentInput carries the general fields the model asks for, with role = the figure's kind", () => {
    const input = addAttachmentInput(
      fig("formula", 11),
      "attachment://v1:" + "f".repeat(64),
      "2026-09-18T14:00:00.000Z",
    );
    expect(input).toEqual({
      id: "formula-12",
      ref: "attachment://v1:" + "f".repeat(64),
      mimeType: "image/png",
      fileName: "formula-12.png",
      sizeBytes: 8,
      role: "formula",
      page: 3,
      alt: "formula 12, page 3 — not decoded",
      width: 10,
      height: 4,
      attachedAt: "2026-09-18T14:00:00.000Z",
    });
  });
});
