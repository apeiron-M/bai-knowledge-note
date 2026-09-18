/**
 * The intake flow's model: what a file row is, how it moves through its states,
 * what is selected, and what is publishable. No React, no fetch — this is where
 * the flow is decided, so this is where the tests are.
 */

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * The model's own `SourceType` enum, copied once so the review's select cannot
 * drift from what `POST sources` accepts — it validates against the generated
 * zod schema and answers 400 for anything else.
 */
export const SECTION_TYPES = [
  "ARTICLE",
  "PAPER",
  "BOOK_CHAPTER",
  "TRANSCRIPT",
  "DOCUMENTATION",
  "CONVERSATION",
  "WEB_PAGE",
  "MANUAL_ENTRY",
] as const;

export type SourceTypeName = (typeof SECTION_TYPES)[number];

/** A group the section rule folded into a section — kept so the fold is visible. */
export type SectionPart = {
  title: string;
  headingPath: string[];
  charCount: number;
};

/**
 * A section as the convert route returns it, plus `content`.
 *
 * `text` is chunk text and flattens tables; `content` is the markdown slice at
 * `markdownRange` (the convert step derives it), falling back to `text` when
 * the range is null. `content` is what becomes the source.
 */
export type Section = {
  title: string;
  headingPath: string[];
  text: string;
  content: string;
  charCount: number;
  chunks: number[];
  mergedFrom: SectionPart[];
  markdownRange: { start: number; end: number } | null;
  /**
   * How many `<!-- image -->` / `<!-- formula-not-decoded -->` placeholders
   * precede this section's slice in the whole markdown — the offset that turns a
   * figure's document-wide `placeholderIndex` into one local to the section.
   * Null when the section has no markdown range.
   */
  placeholderBase?: { picture: number; formula: number } | null;
};

export type SectionPlanSummary = {
  cutLevel: number;
  splitSections: number;
  mergedSections: number;
  rejoinedSections: number;
  minSectionChars: number;
};

export type ConvertedFile = {
  filename: string;
  format: string;
  sections: Section[];
  plan: SectionPlanSummary;
  /** Which OCR engine read the file, when one did. */
  ocr?: "tesseract" | "docling" | null;
  /** Which rung produced the text; `pdfjs` = the text layer without layout. */
  textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr";
  /** OCR is needed but over the service's budget: no sections yet; the user decides. */
  needsOcr?: {
    via: "tesseract" | "docling-ocr";
    estimateSeconds: number;
  } | null;
  pages?: number | null;
  /** Measured completeness — a floor, not a proof: share of the file's text layer present, and the losses docling announces. */
  quality?: ConversionQuality | null;
  /** The document's pictures and display formulas as PNGs, keyed to the n-th placeholder in the markdown. */
  figures?: ConversionFigure[];
  figureStats?: FigureStats | null;
  /** Set when the text was read flat from the text layer: what OCR would cost to recover tables. */
  ocrOffer?: {
    via: "tesseract" | "docling-ocr";
    estimateSeconds: number;
  } | null;
};

/** "~45 s" / "~3 min": how long an OCR pass is expected to take, rounded so it does not pretend to precision. */
export const formatEstimate = (seconds: number): string =>
  seconds >= 90
    ? `~${Math.round(seconds / 60)} min`
    : `~${Math.max(5, Math.round(seconds / 5) * 5)} s`;

export type ConversionFigure = {
  id: string;
  kind: "picture" | "formula";
  page: number;
  placeholderIndex: number;
  alt: string;
  mimeType: string;
  width: number;
  height: number;
  bytesBase64: string;
};

export type FigureStats = {
  pictures: number;
  formulas: number;
  located: number;
  skipped: number;
  droppedForBudget: number;
  /** Figures that could not be positioned in the text (no box on the page). */
  unplaced?: number;
};

/** "3 figures · 70 of 79 formulas as images" — what the review says about a file's pictures. */
export function figuresLine(
  stats: FigureStats | null | undefined,
): string | null {
  if (!stats || (stats.pictures === 0 && stats.formulas === 0)) return null;
  const parts: string[] = [];
  if (stats.pictures > 0)
    parts.push(`${stats.pictures} figure${stats.pictures === 1 ? "" : "s"}`);
  if (stats.formulas > 0)
    parts.push(
      `${stats.located} of ${stats.formulas} formula${stats.formulas === 1 ? "" : "s"} as images`,
    );
  if (stats.droppedForBudget > 0)
    parts.push(`${stats.droppedForBudget} left out for size`);
  return parts.join(" · ");
}

export type ConversionQuality = {
  coverage: number | null;
  rawTokens: number;
  formulas: { total: number; decoded: number };
  images: number;
};

/** Where a conversion is, as the service reports it while the file converts. */
export type ConversionProgress = {
  phase:
    | "starting"
    | "reading"
    | "structuring"
    | "text-layer"
    | "ocr"
    | "figures"
    | "done"
    | "failed";
  pages: number | null;
  pagesDone: number;
  elapsedMs: number;
};

export type FileState = "queued" | "converting" | "converted" | "failed";

export type IntakeFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  state: FileState;
  converted?: ConvertedFile;
  error?: string;
  /** Per file, shared by every section it produces (spec §3, decision 4). */
  sourceType: string;
  /** The `/sources/<folderName>` this document's sources will land in. */
  folderName: string;
  /** One flag per section; converted files arrive ticked except for furniture. */
  selected: boolean[];
  /**
   * Set once this row has been published. `POST sources` is not idempotent on
   * content — only the queue task is deduped — so a second publish would create
   * a second set of sources in the same folder. The row refuses instead.
   */
  publishedIds?: string[];
  /** The sources exist and are queued, but the original could not be attached — and why. */
  attachError?: string;
  /** The user asked for OCR regardless of cost; the next conversion sends `?ocr=1`. */
  forceOcr?: boolean;
  /** Live progress while converting — measured pages, never an estimate. */
  progress?: ConversionProgress;
  startedAt?: number;
  finishedAt?: number;
};

// --- furniture ---------------------------------------------------------------

/**
 * Titles that are almost never a source: the book's own furniture, read as
 * headings by the layout model. A heuristic, not a verdict — these arrive
 * unticked and the user re-ticks. Measured on a 238-page book: at the default
 * floor the first two sections were `Praise for …` and `[ contents ]`.
 */
const FURNITURE: readonly RegExp[] = [
  /^\[.*\]$/, // `[ contents ]`, `[ SIDE NOTE ]`
  /^praise for\b/i,
  /^(table of )?contents$/i,
  /^index$/i,
  /^copyright\b/i,
  /^colophon$/i,
  /^revision history\b/i,
  /^how to contact\b/i,
  /^about the authors?$/i,
  /^acknowledge?ments$/i,
  /^dedication$/i,
];

export function isLikelyFurniture(title: string): boolean {
  const t = title.trim();
  return FURNITURE.some((rule) => rule.test(t));
}

// --- names and types ---------------------------------------------------------

/** `/sources/<name>`: the file's name without its extension. */
export function folderNameFor(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || "Untitled";
}

const extensionOf = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

const TRANSCRIPT_EXTENSIONS = new Set([
  "vtt",
  "srt",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mkv",
  "mov",
]);

/**
 * By format, never by section count. A two-section CV is not a book and a
 * twelve-section PDF may be a report; `BOOK_CHAPTER` is a choice the user makes
 * in the review, per file.
 */
export function defaultSourceType(fileName: string): SourceTypeName {
  const ext = extensionOf(fileName);
  if (ext === "html" || ext === "htm") return "WEB_PAGE";
  if (TRANSCRIPT_EXTENSIONS.has(ext)) return "TRANSCRIPT";
  return "ARTICLE";
}

// --- validation --------------------------------------------------------------

const MB = 1024 * 1024;

export function validateFile(
  file: { name: string; size: number },
  formats: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (file.size <= 0) {
    return { ok: false, reason: `“${file.name}” is empty.` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const limit = Math.round(MAX_UPLOAD_BYTES / MB);
    const size = (file.size / MB).toFixed(1);
    return {
      ok: false,
      reason: `${size} MB is over the ${limit} MB limit for one document.`,
    };
  }
  const ext = extensionOf(file.name);
  if (!ext) {
    return {
      ok: false,
      reason: `“${file.name}” has no file extension, so its format cannot be told.`,
    };
  }
  if (!formats.some((f) => f.toLowerCase() === ext)) {
    return {
      ok: false,
      reason: `.${ext} is not one of the formats the converter reads.`,
    };
  }
  return { ok: true };
}

// --- the rows ----------------------------------------------------------------

let counter = 0;
const nextId = () => `intake-${++counter}-${Date.now().toString(36)}`;

export function addFiles(
  files: readonly IntakeFile[],
  additions: readonly { name: string; size: number; mimeType: string }[],
): IntakeFile[] {
  return [
    ...files,
    ...additions.map(
      (a): IntakeFile => ({
        id: nextId(),
        name: a.name,
        size: a.size,
        mimeType: a.mimeType,
        state: "queued",
        sourceType: defaultSourceType(a.name),
        folderName: folderNameFor(a.name),
        selected: [],
      }),
    ),
  ];
}

export function removeFile(
  files: readonly IntakeFile[],
  id: string,
): IntakeFile[] {
  return files.filter((f) => f.id !== id);
}

/**
 * Cancel: drop everything that is not in the vault. What was published stays —
 * it exists as documents and cannot be un-published from here — so a cancel
 * after a partial publish leaves the summary of what landed, not a blank.
 */
export function discardUnpublished(files: readonly IntakeFile[]): IntakeFile[] {
  return files.filter((f) => f.publishedIds !== undefined);
}

export function setState(
  files: readonly IntakeFile[],
  id: string,
  patch: Partial<IntakeFile>,
): IntakeFile[] {
  return files.map((f) => {
    if (f.id !== id) return f;
    const next: IntakeFile = { ...f, ...patch };
    // A conversion result arrives ticked — except for furniture: the review
    // exists so the user can disagree, not so they must do the work, and
    // culling `[ contents ]` by hand is work.
    if (patch.converted) {
      next.selected = patch.converted.sections.map(
        (s) => !isLikelyFurniture(s.title),
      );
    }
    return next;
  });
}

export function toggleSection(
  files: readonly IntakeFile[],
  id: string,
  index: number,
): IntakeFile[] {
  return files.map((f) =>
    f.id === id
      ? { ...f, selected: f.selected.map((on, i) => (i === index ? !on : on)) }
      : f,
  );
}

export function setAllSections(
  files: readonly IntakeFile[],
  id: string,
  on: boolean,
): IntakeFile[] {
  return files.map((f) =>
    f.id === id ? { ...f, selected: f.selected.map(() => on) } : f,
  );
}

export function markPublished(
  files: readonly IntakeFile[],
  id: string,
  sourceIds: string[],
): IntakeFile[] {
  return files.map((f) =>
    f.id === id ? { ...f, publishedIds: sourceIds } : f,
  );
}

// --- derived -----------------------------------------------------------------

/** Ticked sections on a row that has not been published yet. */
export function selectedCount(file: IntakeFile): number {
  if (file.publishedIds) return 0;
  return file.selected.filter(Boolean).length;
}

export function totalSelected(files: readonly IntakeFile[]): number {
  return files.reduce((n, f) => n + selectedCount(f), 0);
}

export function canPublish(files: readonly IntakeFile[]): boolean {
  return totalSelected(files) > 0;
}

/** The next file to convert: first in, first out, one at a time. */
export function nextQueued(
  files: readonly IntakeFile[],
): IntakeFile | undefined {
  return files.find((f) => f.state === "queued");
}

/** Converted and not yet published: the user has a decision waiting. */
export const isReviewReady = (f: IntakeFile): boolean =>
  f.state === "converted" &&
  f.publishedIds === undefined &&
  !f.converted?.needsOcr;

/** Converted, but the service would not spend the OCR minutes without being asked. */
export const needsOcrDecision = (f: IntakeFile): boolean =>
  f.state === "converted" &&
  f.publishedIds === undefined &&
  Boolean(f.converted?.needsOcr);

/**
 * What the Sources tab badge shows: files waiting for the user — ready for
 * review, or failed. Never the batch size, and never what is still converting.
 */
export function needsUser(files: readonly IntakeFile[]): number {
  return files.filter(
    (f) => isReviewReady(f) || needsOcrDecision(f) || f.state === "failed",
  ).length;
}
