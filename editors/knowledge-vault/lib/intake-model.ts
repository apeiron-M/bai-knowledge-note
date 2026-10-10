/**
 * The intake flow's model: what a file row is, how it moves through its states,
 * what is selected, and what is publishable. No React, no fetch — this is where
 * the flow is decided, so this is where the tests are.
 */

/** A vault's cap when its health does not say (an older server); the server's own number wins. */
export const DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** "30 MB", "100 MB": the cap as a person reads it. */
export function formatUploadLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

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
  textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr" | "text";
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

/** "about 4 min": the same estimate, said the way a person would. */
export const aboutEstimate = (seconds: number): string =>
  formatEstimate(seconds).replace("~", "about ");

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
    | "failed"
    | "cancelled";
  /** The document's page count, when the service knows it. */
  pages: number | null;
  /**
   * Pages finished. A service that reads the whole document in one pass holds
   * this at 0 while `reading`: it knows how many pages there are, not how far
   * it has got. An older service that streams counts them as they finish.
   */
  pagesDone: number;
  elapsedMs: number;
};

/**
 * What a reading row says it is doing, in the person's words. Its numbers are
 * the service's own — the page count, pages finished — never projected:
 * reading in one pass, the service knows the pages but not how far it is, and
 * the row says just that ("Reading 23 pages") rather than "page 0 of 23".
 */
export function progressLabel(progress: ConversionProgress | undefined): string {
  if (!progress) return "Reading";
  const { pages, pagesDone } = progress;
  switch (progress.phase) {
    case "reading":
      if (!pages) return "Reading";
      return pagesDone > 0
        ? `Reading page ${pagesDone} of ${pages}`
        : `Reading ${pages} page${pages === 1 ? "" : "s"}`;
    case "structuring":
      return "Finding the sections";
    case "text-layer":
      return "Reading the text";
    case "ocr":
      return "Reading the scan";
    case "figures":
      return `Cutting out the figures${pagesDone ? `, ${pagesDone} so far` : ""}`;
    case "cancelled":
      return "Stopped";
    default:
      return "Reading";
  }
}

/**
 * The bar under a reading row. `measured`: pages finished over pages in the
 * file — the only share the service actually counts. `indeterminate` for the
 * rest of the work: a glow that travels along the track to show something is
 * happening and claims no share of it, so it is never an estimate.
 */
export type ProgressBar =
  | { kind: "measured"; fraction: number }
  | { kind: "indeterminate" };

export function progressBar(
  progress: ConversionProgress | undefined,
): ProgressBar {
  return progress?.phase === "reading" && progress.pages && progress.pagesDone > 0
    ? {
        kind: "measured",
        fraction: Math.min(1, progress.pagesDone / progress.pages),
      }
    : { kind: "indeterminate" };
}

/**
 * Where a file is. `duplicate`: the vault (or this batch) already holds this
 * exact file — it is held, unread, until the person says what to do.
 */
export type FileState =
  | "queued"
  | "converting"
  | "converted"
  | "failed"
  | "duplicate";

/** A file the vault already holds, found by its content — not by its name. */
export type KnownOriginal = {
  /** The folder its sources are in, when they are in one. */
  folderName: string | null;
  /** How many sources were made from it. */
  sources: number;
  /** When it was first added (ISO), when the vault recorded that. */
  addedAt: string | null;
  /** The copy is another file of this batch, not the vault: that file's name. */
  inBatch?: string;
};

/** What the vault already holds: each original by its content ref, and the folder names directly under /sources. */
export type VaultIndex = {
  originals: ReadonlyMap<string, KnownOriginal>;
  folders: ReadonlySet<string>;
};

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
  /**
   * Adding it to the vault failed, and why. On a row that is not published the
   * person adds it again; on a published row only part of it landed.
   */
  publishError?: string;
  /**
   * Its content ref — `attachment://v1:<sha-256>` of its bytes — once hashed:
   * the ref every source records as its original, so a file added before is
   * recognised whatever it is called now.
   */
  originalRef?: string;
  /**
   * Checked against what the vault holds: `clear` (not there, or added again
   * on purpose) or `skipped` (the vault could not say in time, or the file
   * could not be hashed). Unset while the check is under way.
   */
  check?: "clear" | "skipped";
  /** The vault, or this batch, already holds this exact file. */
  known?: KnownOriginal;
  /** The person chose to add a file the vault already holds. */
  addAgain?: boolean;
  /** The folder name it would have had, when a folder of that name already holds other sources. */
  renamedFrom?: string;
  /** The user asked for OCR regardless of cost; the next conversion sends `?ocr=1`. */
  forceOcr?: boolean;
  /**
   * Live progress while converting: the service's phase and its page counts,
   * never an estimate. Reading in one pass, it knows the pages but not how far
   * it is — the row then shows an indeterminate bar, which claims nothing.
   */
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

/** Lower-case, no dot: how the converter names a format (`formats`, `modelExtensions`). */
export const extensionOf = (fileName: string): string => {
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
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): { ok: true } | { ok: false; reason: string } {
  if (file.size <= 0) {
    return { ok: false, reason: "the file is empty." };
  }
  if (file.size > maxBytes) {
    const size = (file.size / MB).toFixed(1);
    return {
      ok: false,
      reason: `it's ${size} MB, over the ${formatUploadLimit(maxBytes)} limit for one file.`,
    };
  }
  const ext = extensionOf(file.name);
  if (!ext) {
    return {
      ok: false,
      reason: "it has no extension, so there's no telling what kind of file it is.",
    };
  }
  if (!formats.some((f) => f.toLowerCase() === ext)) {
    return {
      ok: false,
      reason: `the vault can't read .${ext} files.`,
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
    (f) =>
      isReviewReady(f) ||
      needsOcrDecision(f) ||
      f.state === "failed" ||
      f.state === "duplicate",
  ).length;
}

// --- what a person reads -------------------------------------------------------

/** The name a row shows: the file's name without its extension — the icon says the format. */
export function displayName(fileName: string): string {
  return folderNameFor(fileName);
}

/** The format as a file icon labels it: "PDF", "DOCX" — at most four letters. */
export function formatBadge(fileName: string): string {
  const ext = extensionOf(fileName);
  return ext ? ext.slice(0, 4).toUpperCase() : "FILE";
}

/**
 * "2 min": how long a section takes to read — about six characters a word and
 * 230 words a minute — never under a minute. A length people feel, where
 * "2,563 chars" is a number they have to translate.
 */
export function readingTime(chars: number): string {
  const minutes = Math.max(1, Math.round(chars / 6 / 230));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "0:41", "12:05", "1:02:09": time spent reading a file, the way a timer shows it. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The model's `SourceType`, as a person names one of them and several. */
const SOURCE_TYPE_WORDS: Record<SourceTypeName, { one: string; many: string }> = {
  ARTICLE: { one: "Article", many: "articles" },
  PAPER: { one: "Paper", many: "papers" },
  BOOK_CHAPTER: { one: "Book chapter", many: "book chapters" },
  TRANSCRIPT: { one: "Transcript", many: "transcripts" },
  DOCUMENTATION: { one: "Documentation", many: "documentation" },
  CONVERSATION: { one: "Conversation", many: "conversations" },
  WEB_PAGE: { one: "Web page", many: "web pages" },
  MANUAL_ENTRY: { one: "Manual entry", many: "manual entries" },
};

export function sourceTypeWords(type: string): { one: string; many: string } {
  const known = SOURCE_TYPE_WORDS[type as SourceTypeName] as
    | { one: string; many: string }
    | undefined;
  if (known) return known;
  const one = type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
  return { one, many: one.toLowerCase() };
}

/** Something a person should know before adding a file. A `warn` makes Review the row's first action. */
export type ReviewNote = {
  tone: "warn" | "info";
  /** One line, for the row. */
  short: string;
  /** The full sentence, for the review. */
  long: string;
};

/**
 * What to know about a converted file before adding it, most important first —
 * only what changes the decision. A file read cleanly has no notes at all.
 */
export function reviewNotes(file: IntakeFile): ReviewNote[] {
  const converted = file.converted;
  if (!converted) return [];
  const notes: ReviewNote[] = [];
  if (converted.textSource === "pdfjs") {
    notes.push({
      tone: "warn",
      short: "Read without its layout",
      long: "This PDF's layout couldn't be read, so its headings were guessed from the size of the type, and tables and lists come out as plain text.",
    });
  } else if (converted.ocr) {
    notes.push({
      tone: "warn",
      short: "Read from a scan",
      long: "This file is a scan, so its text was recognised from the page images. Check names and numbers before adding.",
    });
  }
  if (file.renamedFrom) {
    notes.push({
      tone: "info",
      short: `Goes in “${file.folderName}”`,
      long: file.addAgain
        ? `An earlier copy of this file is in Sources › ${file.renamedFrom}, so this one goes in “${file.folderName}”. Change it below to put them together.`
        : `Sources › ${file.renamedFrom} already holds another file's sections, so these go in “${file.folderName}”. Change it below if they belong together.`,
    });
  }
  const coverage = converted.quality?.coverage;
  if (coverage != null && coverage < 0.95) {
    const percent = Math.round(coverage * 100);
    notes.push({
      tone: "warn",
      short: `About ${percent}% of the text was captured`,
      long: `About ${percent}% of this file's text was captured. Words inside charts and tables may be missing, so skim a section or two before adding.`,
    });
  }
  return notes;
}

/**
 * What the review says about the file itself, in plain sentences: its format,
 * size and pages, then the figures and formulas that are kept as pictures.
 * Counted from what will actually be attached, not from what was found.
 */
export function fileFacts(file: IntakeFile, size: string): string {
  const converted = file.converted;
  const pages = converted?.pages;
  const facts = [
    `${formatBadge(file.name)}, ${size}${pages ? `, ${pages} page${pages === 1 ? "" : "s"}` : ""}.`,
  ];
  const figures = converted?.figures ?? [];
  const pictures = figures.filter((f) => f.kind === "picture").length;
  const formulas = figures.filter((f) => f.kind === "formula").length;
  if (pictures > 0)
    facts.push(
      `Its ${pictures} figure${pictures === 1 ? " is" : "s are"} kept as images.`,
    );
  if (formulas > 0)
    facts.push(
      `${formulas} formula${formulas === 1 ? " is" : "s are"} kept as images${pictures > 0 ? " too" : ""}.`,
    );
  const dropped = converted?.figureStats?.droppedForBudget ?? 0;
  if (dropped > 0)
    facts.push(
      `${dropped} more ${dropped === 1 ? "was" : "were"} left out to keep the sources small.`,
    );
  return facts.join(" ");
}

/**
 * What the picker and the drop accept. The converter names its input formats
 * (`formats`) — mostly extensions, but some are families such as `image` — and
 * separately lists the extensions it reads with its models (`modelExtensions`:
 * pdf, png, jpg, …). Both count: without the second, a PNG the converter reads
 * would be refused before it was ever sent.
 */
export function acceptedExtensions(
  formats: readonly string[],
  modelExtensions: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  for (const f of [...formats, ...modelExtensions]) {
    const ext = f.toLowerCase().replace(/^\./, "");
    if (ext) out.add(ext);
  }
  return [...out];
}

/** Families of formats as people name them, in the order they look for them. */
const FAMILIES: readonly { name: string; exts: readonly string[] }[] = [
  { name: "PDF", exts: ["pdf"] },
  { name: "Word", exts: ["docx", "doc", "odt"] },
  { name: "PowerPoint", exts: ["pptx", "ppt", "odp"] },
  { name: "Excel", exts: ["xlsx", "xls", "ods"] },
  { name: "web pages", exts: ["html", "htm", "mhtml"] },
  { name: "images", exts: ["png", "jpg", "jpeg", "tif", "tiff", "webp"] },
  { name: "Markdown", exts: ["md"] },
  { name: "EPUB", exts: ["epub"] },
];

/** "PDF, Word, PowerPoint, Excel, web pages, images, Markdown and more": what the vault reads, named, never counted wrong. */
export function formatsSentence(accepted: readonly string[]): string {
  const known = new Set(accepted.map((f) => f.toLowerCase()));
  const named = FAMILIES.filter((family) =>
    family.exts.some((ext) => known.has(ext)),
  );
  const covered = new Set(named.flatMap((family) => family.exts));
  const more = [...known].some((ext) => !covered.has(ext));
  const names = named.map((family) => family.name);
  if (names.length === 0) return "";
  if (more) return `${names.join(", ")} and more`;
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One part of the sentence under "Adding 6 files": a count, and whether it asks for the person. */
export type SummaryPart = { text: string; tone?: "ready" | "look" };

/**
 * "2 ready for you, 1 needs a look, 2 reading, 1 waiting and 1 added": where
 * the batch is, in one sentence, what needs the person first. Each part is
 * left out when its count is zero.
 */
export function batchSummary(files: readonly IntakeFile[]): SummaryPart[] {
  const count = (test: (f: IntakeFile) => boolean) => files.filter(test).length;
  const ready = count(isReviewReady);
  const look = count(
    (f) =>
      needsOcrDecision(f) || f.state === "failed" || f.state === "duplicate",
  );
  const reading = count((f) => f.state === "converting");
  const waiting = count((f) => f.state === "queued");
  const added = count((f) => f.publishedIds !== undefined);
  const parts: SummaryPart[] = [];
  if (ready) parts.push({ text: `${ready} ready for you`, tone: "ready" });
  if (look)
    parts.push({ text: `${look} need${look === 1 ? "s" : ""} a look`, tone: "look" });
  if (reading) parts.push({ text: `${reading} reading` });
  if (waiting) parts.push({ text: `${waiting} waiting` });
  if (added) parts.push({ text: `${added} added` });
  return parts;
}

/**
 * What a waiting file waits for. The converter reads PDFs and images one lane
 * at a time and everything else in another (`laneOf`), so the file next in its
 * lane starts when that lane's file is done — and says which one that is.
 */
export function waitingLine(
  file: IntakeFile,
  files: readonly IntakeFile[],
  laneOf: (name: string) => string,
  /** The batch checks files against the vault before reading them. */
  checking = false,
): string {
  if (checking && !file.check)
    return "Checking whether it's already in the vault…";
  if (file.error) return `Waiting. ${file.error}`;
  const lane = laneOf(file.name);
  const inLane = (f: IntakeFile) => laneOf(f.name) === lane;
  const next = files.find((f) => f.state === "queued" && inLane(f));
  if (next?.id !== file.id) return "Waiting its turn.";
  const reading = files.filter((f) => f.state === "converting" && inLane(f));
  if (reading.length === 1)
    return `Waiting. Starts when ${displayName(reading[0].name)} is read.`;
  if (reading.length > 1)
    return "Waiting. Starts when one of the files being read is done.";
  return "Waiting.";
}

/**
 * A section's text without its own heading, when that heading is the
 * section's title: the review shows the title once, above the text. Any other
 * opening heading (a parent's, a merged neighbour's) stays.
 */
export function withoutOwnHeading(content: string, title: string): string {
  const match = /^\s*#{1,6}[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(content);
  if (!match) return content;
  const plain = (s: string) =>
    s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!title.trim() || plain(match[1]) !== plain(title)) return content;
  return content.slice(match[0].length).replace(/^\s*\n/, "");
}

// --- files the vault already holds -------------------------------------------

/** "Report (2)", "Report (3)": the first folder name not taken. */
export function freeFolderName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`;
    if (!taken.has(name)) return name;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10 Oct", or "10 Oct 2025" in another year; null for a date that cannot be read. */
export function shortDate(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day} ${date.getFullYear()}`;
}

/** What a held duplicate's row says: the finding first, then where the earlier copy is. */
export function knownLine(
  known: KnownOriginal,
  now: Date = new Date(),
): { lead: string; detail: string } {
  if (known.inBatch !== undefined)
    return {
      lead: `Same file as ${displayName(known.inBatch)}.`,
      detail: "It's already in this batch.",
    };
  const date = shortDate(known.addedAt, now);
  const sources = `${known.sources} source${known.sources === 1 ? "" : "s"}`;
  return {
    lead: "Already in the vault.",
    detail: `Added${date ? ` on ${date}` : ""} as ${sources}${known.folderName ? ` in Sources › ${known.folderName}` : ""}.`,
  };
}

/**
 * The vault's originals, from its sources: one entry per content ref, with
 * how many sources came from it, when it was first added, and the folder most
 * of them are in. Sources without an original (pasted text, or added before
 * originals were kept) cannot be matched and are left out.
 */
export function vaultIndexOf(
  sources: readonly {
    originalRef: string | null;
    folderName: string | null;
    addedAt: string | null;
  }[],
  folders: readonly string[],
): VaultIndex {
  const grouped = new Map<
    string,
    { count: number; addedAt: string | null; folders: Map<string | null, number> }
  >();
  for (const source of sources) {
    if (!source.originalRef) continue;
    const entry = grouped.get(source.originalRef) ?? {
      count: 0,
      addedAt: null,
      folders: new Map<string | null, number>(),
    };
    entry.count += 1;
    if (source.addedAt && (!entry.addedAt || source.addedAt < entry.addedAt))
      entry.addedAt = source.addedAt;
    entry.folders.set(source.folderName, (entry.folders.get(source.folderName) ?? 0) + 1);
    grouped.set(source.originalRef, entry);
  }
  const originals = new Map<string, KnownOriginal>();
  for (const [ref, entry] of grouped) {
    const [folderName] = [...entry.folders.entries()].sort((a, b) => b[1] - a[1])[0];
    originals.set(ref, { folderName, sources: entry.count, addedAt: entry.addedAt });
  }
  return { originals, folders: new Set(folders) };
}
