import type { ConversionFigure, Section } from "./intake-model.js";

/**
 * Figures → attachments of a source.
 *
 * The conversion service returns a document's pictures and display formulas
 * as PNGs, each keyed to the n-th `<!-- image -->` or `<!-- formula-not-decoded -->`
 * in the *whole* markdown. A source is one section — a slice of that markdown —
 * so the n-th placeholder of the document is the (n − base)-th of the section,
 * where `base` is how many of that kind came before the slice
 * (`Section.placeholderBase`, counted at convert time while the markdown is
 * still in hand). This module does the arithmetic and the rewrite; it knows
 * nothing about uploads.
 */

export const PICTURE_PLACEHOLDER = "<!-- image -->";
export const FORMULA_PLACEHOLDER = "<!-- formula-not-decoded -->";

const placeholderFor = (kind: ConversionFigure["kind"]) =>
  kind === "picture" ? PICTURE_PLACEHOLDER : FORMULA_PLACEHOLDER;

/** How many times `needle` occurs in `text`. */
export function countOccurrences(text: string, needle: string): number {
  let n = 0;
  for (
    let at = text.indexOf(needle);
    at !== -1;
    at = text.indexOf(needle, at + needle.length)
  )
    n += 1;
  return n;
}

/** Replace only the `index`-th occurrence of `placeholder`; unchanged when there is none. */
export function replaceNth(
  text: string,
  placeholder: string,
  index: number,
  replacement: string,
): string {
  let from = 0;
  for (let i = 0; ; i++) {
    const at = text.indexOf(placeholder, from);
    if (at === -1) return text;
    if (i === index)
      return (
        text.slice(0, at) + replacement + text.slice(at + placeholder.length)
      );
    from = at + placeholder.length;
  }
}

/**
 * The figures that fall inside this section, with their index local to it.
 * A section without a `placeholderBase` (no markdown range: chunk text, or
 * a ceiling split) gets none — its placeholders stay as they are.
 */
export function figuresInSection(
  section: Pick<Section, "content" | "placeholderBase">,
  figures: readonly ConversionFigure[],
): { figure: ConversionFigure; localIndex: number }[] {
  const base = section.placeholderBase;
  if (!base) return [];
  const counts = {
    picture: countOccurrences(section.content, PICTURE_PLACEHOLDER),
    formula: countOccurrences(section.content, FORMULA_PLACEHOLDER),
  };
  const out: { figure: ConversionFigure; localIndex: number }[] = [];
  for (const figure of figures) {
    const localIndex = figure.placeholderIndex - base[figure.kind];
    if (localIndex >= 0 && localIndex < counts[figure.kind])
      out.push({ figure, localIndex });
  }
  return out;
}

/**
 * The section's content with each placed figure's placeholder replaced by an
 * image whose source is the attachment ref, alt text intact. Replacements go
 * from the last placeholder to the first so earlier indices stay valid.
 */
/** Offset of the `index`-th occurrence of `placeholder`, or -1. */
function nthOffset(text: string, placeholder: string, index: number): number {
  let from = 0;
  for (let i = 0; ; i++) {
    const at = text.indexOf(placeholder, from);
    if (at === -1 || i === index) return at;
    from = at + placeholder.length;
  }
}

export function rewriteWithAttachments(
  section: Pick<Section, "content" | "placeholderBase">,
  figures: readonly ConversionFigure[],
  refOf: (figure: ConversionFigure) => string | undefined,
): { content: string; attached: ConversionFigure[] } {
  // Placed figures in the order they appear in the text; replaced back to
  // front so earlier offsets stay valid, reported front to back.
  const placed = figuresInSection(section, figures)
    .map((p) => ({
      ...p,
      ref: refOf(p.figure),
      at: nthOffset(
        section.content,
        placeholderFor(p.figure.kind),
        p.localIndex,
      ),
    }))
    .filter(
      (
        p,
      ): p is {
        figure: ConversionFigure;
        localIndex: number;
        ref: string;
        at: number;
      } => p.ref !== undefined && p.at >= 0,
    )
    .sort((a, b) => a.at - b.at);
  let content = section.content;
  for (const { figure, localIndex, ref } of [...placed].reverse()) {
    content = replaceNth(
      content,
      placeholderFor(figure.kind),
      localIndex,
      `![${figure.alt}](${ref})`,
    );
  }
  return { content, attached: placed.map((p) => p.figure) };
}

/** Base64 (the wire form of a figure) → bytes, in the browser and in Node. */
export function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `ADD_ATTACHMENT` input for a figure whose bytes are at `ref`. */
export function addAttachmentInput(
  figure: ConversionFigure,
  ref: string,
  attachedAt: string,
) {
  return {
    id: figure.id,
    ref,
    mimeType: figure.mimeType,
    fileName: `${figure.id}.png`,
    sizeBytes:
      Math.floor((figure.bytesBase64.length * 3) / 4) -
      (figure.bytesBase64.match(/=+$/)?.[0].length ?? 0),
    role: figure.kind,
    page: figure.page,
    alt: figure.alt,
    width: figure.width,
    height: figure.height,
    attachedAt,
  };
}
