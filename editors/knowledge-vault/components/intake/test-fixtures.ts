import type {
  ConversionFigure,
  ConvertedFile,
  IntakeFile,
  Section,
} from "../../lib/intake-model.js";

/** A section of `chars` characters (or the given body). */
export const section = (
  title: string,
  body: string | number = "Body text.",
): Section => {
  const content = typeof body === "number" ? "x".repeat(body) : body;
  return {
    title,
    headingPath: [title],
    text: content,
    content,
    charCount: content.length,
    chunks: [0],
    mergedFrom: [],
    markdownRange: null,
  };
};

export const convertedOf = (
  sections: Section[],
  over: Partial<ConvertedFile> = {},
): ConvertedFile => ({
  filename: "Report.pdf",
  format: "pdf",
  sections,
  plan: {
    cutLevel: 1,
    splitSections: 0,
    mergedSections: 0,
    rejoinedSections: 0,
    minSectionChars: 2000,
  },
  ...over,
});

export const fileOf = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Report.pdf",
  size: 753_700,
  mimeType: "application/pdf",
  state: "queued",
  sourceType: "ARTICLE",
  folderName: "Report",
  selected: [],
  ...over,
});

/** A converted file with `n` sections of the given lengths, all kept unless said otherwise. */
export const readyFile = (
  lengths: number[],
  over: Partial<IntakeFile> = {},
  converted: Partial<ConvertedFile> = {},
): IntakeFile =>
  fileOf({
    state: "converted",
    converted: convertedOf(
      lengths.map((n, i) => section(`Part ${i + 1}`, n)),
      converted,
    ),
    selected: lengths.map(() => true),
    ...over,
  });

export const figureOf = (
  kind: ConversionFigure["kind"],
  index: number,
): ConversionFigure => ({
  id: `${kind}-${index}`,
  kind,
  page: 1,
  placeholderIndex: index,
  alt: `${kind} ${index}`,
  mimeType: "image/png",
  width: 10,
  height: 4,
  bytesBase64: "iVBORw0KGgo=",
});
