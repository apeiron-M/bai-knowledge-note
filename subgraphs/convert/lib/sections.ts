/**
 * Turning docling's chunk stream into vault sections.
 *
 * docling's chunker is tokenizer-shaped: it emits one chunk per document
 * element, each carrying the heading path it sits under. Measured on a
 * six-element HTML page: 5 chunks. A 400-page book scales that to thousands,
 * and a `bai/source` per chunk would dilute every query that touches the
 * topic — the failure AGENT.md names as the most damaging an agent can do to
 * a vault. So a section, not a chunk, is the unit that becomes a source.
 *
 * The rule is "cut at the shallowest heading depth that actually divides the
 * document": a book with three parts and no chapters cuts at depth 1; one
 * that is a single part with twelve chapters cuts at depth 2.
 *
 * This is the only piece of genuine vault semantics in the conversion feature,
 * so it is pure, standalone, and tested first — the service below it knows
 * formats, never vault vocabulary.
 */

/** A chunk as the conversion service returns it (docling's shape). */
export interface SourceChunk {
  text: string;
  headings?: string[];
  docItems?: string[];
  contextualized?: string;
}

/** A heading group that was folded into a section, kept so the fold is visible. */
export interface SectionPart {
  title: string;
  headingPath: string[];
  charCount: number;
}

/** A half-open `[start, end)` span of the converted markdown. */
export interface MarkdownRange {
  start: number;
  end: number;
}

/** One prospective `bai/source`. */
export interface Section {
  /** The section's own heading, or a generated name. */
  title: string;
  /** The full heading path, outermost first. Empty for front matter. */
  headingPath: string[];
  /** The chunk texts joined — complete, but tables come back flattened. */
  text: string;
  charCount: number;
  /** Indexes into the chunk array this section was built from. */
  chunks: number[];
  /**
   * Every heading group this section absorbed, in document order — empty when
   * it is exactly one group. The title above is the largest of these; this is
   * how a reader sees what else is inside.
   */
  mergedFrom: SectionPart[];
  /**
   * Where this section sits in the converted markdown, when a `markdown` was
   * given and the section's first heading could be located in it. The markdown
   * is where tables are rendered correctly, so a source built from this slice
   * keeps them; `text` does not. `null` when unlocatable (the preceding
   * section's range then extends over it) and for ceiling-split parts.
   */
  markdownRange: MarkdownRange | null;
}

export interface SectionPlan {
  sections: Section[];
  /** Heading depth the cut was made at; 0 when the document has no headings. */
  cutLevel: number;
  /** How many sections the ceiling forced into parts. */
  splitSections: number;
  /** How many undersized sections were folded into a neighbour. */
  mergedSections: number;
  /**
   * How many sections were rejoined with a neighbour carrying the same heading
   * path — a chapter that a sidebar or a boxed note had cut in two.
   */
  rejoinedSections: number;
  ceiling: number;
  minSectionChars: number;
}

export interface DeriveSectionsOptions {
  documentName: string;
  ceiling?: number;
  minSectionChars?: number;
  /**
   * The document's converted markdown. Optional and never copied into the
   * plan: it is used only to compute each section's `markdownRange`, so a
   * caller that has it can hand out correct tables without a second pass.
   */
  markdown?: string;
}

/**
 * A safety valve, not a target. Every operation stores a full copy of the
 * document's state, so a source far above this re-serialises itself on every
 * claim added.
 */
export const SECTION_CHAR_CEILING = 40_000;

/**
 * The smallest thing worth calling a source.
 *
 * This exists because of a measurement: docling returns a **flat** heading list
 * on real books — 996 of 998 chunks on a 238-page book came back at depth 1 —
 * so "cut at the shallowest heading depth that divides the document" treats the
 * title page, the praise page, `[ SIDE NOTE ]` and `Warning` exactly like the
 * chapters. Measured on that book, the cut rule alone produced **290 sections**,
 * more than one per page: the dilution a vault is supposed to avoid, arrived at
 * by following the rule.
 *
 * So sections below this fold into a neighbour. At 2 000 chars the same book
 * yields 107 sections, of which four read as furniture, and a 2-page CV yields
 * 2 — a CV has a genuine two-part shape. The dial table is in the design spec
 * (§6.1); this is exposed as an option so the intake view can offer it.
 */
export const SECTION_MIN_CHARS = 2_000;

/** Deepest heading depth we will cut at before giving up and not cutting. */
const MAX_CUT_DEPTH = 3;

/** A separator no heading contains, so joined paths compare exactly. */
const PATH_SEPARATOR = "\0";

const pathKey = (headings: string[], depth: number) =>
  headings.slice(0, depth).join(PATH_SEPARATOR);

/** The shallowest depth (1..MAX_CUT_DEPTH) that yields at least two groups. */
function chooseCutLevel(
  chunks: readonly SourceChunk[],
  headed: number[],
): number {
  if (headed.length === 0) return 0;
  for (let depth = 1; depth <= MAX_CUT_DEPTH; depth++) {
    const keys = new Set<string>();
    for (const i of headed) {
      const headings = chunks[i].headings ?? [];
      if (headings.length >= depth) keys.add(pathKey(headings, depth));
    }
    if (keys.size >= 2) return depth;
  }
  // One heading covers everything: cut at depth 1 and let it be one section.
  return 1;
}

/** A contiguous run of chunks under one heading path — the unit before folding. */
interface Group {
  path: string[];
  indexes: number[];
}

/**
 * Chunks grouped into **contiguous runs** by their heading path at `depth`.
 *
 * Runs, not a map keyed on the path: a book's `[ SIDE NOTE ]` heading appears
 * sixteen times, and collecting every occurrence under one key would stitch
 * text from sixteen places into one section, out of reading order, and make
 * it impossible to say where that section sits in the markdown. A run ends
 * when the path changes; a chapter split in two by a boxed note is rejoined
 * later (see `rejoinSamePath`), after the note has been folded away.
 *
 * A chunk with no heading *after* the first headed chunk continues the current
 * run — it belongs to the section it appears in. Only leading headless chunks
 * are front matter, and the caller handles those.
 */
function groupRuns(
  chunks: readonly SourceChunk[],
  headed: number[],
  depth: number,
): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let currentKey: string | null = null;
  for (let i = headed[0]; i < chunks.length; i++) {
    const headings = chunks[i].headings ?? [];
    if (headings.length === 0 && current) {
      current.indexes.push(i);
      continue;
    }
    // A chunk shallower than the cut depth groups under the path it has.
    const key = pathKey(headings, Math.min(depth, headings.length));
    if (current && key === currentKey) {
      current.indexes.push(i);
      continue;
    }
    current = { path: headings.slice(0, depth), indexes: [i] };
    currentKey = key;
    groups.push(current);
  }
  return groups;
}

function buildSection(
  title: string,
  headingPath: string[],
  indexes: number[],
  chunks: readonly SourceChunk[],
): Section {
  const text = indexes.map((i) => chunks[i].text).join("\n\n");
  return {
    title,
    headingPath,
    text,
    charCount: text.length,
    chunks: indexes,
    mergedFrom: [],
    markdownRange: null,
  };
}

// --- locating sections in the markdown -------------------------------------

/** One `#` heading line in the markdown and where it starts. */
interface HeadingLine {
  offset: number;
  text: string;
}

const HEADING_LINE = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

/**
 * Loose enough to survive what a renderer does to a heading: entity-encoded
 * ampersands (`&amp;`), collapsed whitespace, emphasis markers, case. Tight
 * enough that `Copenhagen` does not match `Copenhagen, Denmark`.
 */
function normaliseHeading(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingLines(markdown: string): HeadingLine[] {
  const lines: HeadingLine[] = [];
  for (const match of markdown.matchAll(HEADING_LINE)) {
    lines.push({ offset: match.index, text: normaliseHeading(match[1]) });
  }
  return lines;
}

/**
 * The markdown offset at which each group starts, or `null` when its heading
 * could not be found.
 *
 * Groups are in document order and so are the heading lines, so this is one
 * forward pass with a cursor: each group looks for its leaf heading at or
 * after the previous match. That is what disambiguates a heading that recurs
 * (`Copenhagen, Denmark` twice in a CV, `[ SIDE NOTE ]` sixteen times in a
 * book) — the *next* occurrence is the right one, never the first. On a
 * 400 000-character book this is one regex pass plus ~300 short scans.
 */
function locateGroups(
  groups: readonly Group[],
  markdown: string,
): (number | null)[] {
  const lines = headingLines(markdown);
  const starts: (number | null)[] = [];
  let cursor = 0;
  for (const group of groups) {
    const leaf = group.path.at(-1);
    let found: number | null = null;
    if (leaf !== undefined) {
      const wanted = normaliseHeading(leaf);
      for (let j = cursor; j < lines.length; j++) {
        if (lines[j].text === wanted) {
          found = lines[j].offset;
          cursor = j + 1;
          break;
        }
      }
    }
    starts.push(found);
  }
  return starts;
}

/** Turns per-section start offsets into half-open ranges over the markdown. */
function rangesFromStarts(
  starts: readonly (number | null)[],
  markdownLength: number,
): (MarkdownRange | null)[] {
  const ranges: (MarkdownRange | null)[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    if (start === null) {
      ranges.push(null);
      continue;
    }
    let end = markdownLength;
    for (let j = i + 1; j < starts.length; j++) {
      const next = starts[j];
      if (next !== null) {
        end = next;
        break;
      }
    }
    ranges.push({ start, end });
  }
  return ranges;
}

// --- folding ----------------------------------------------------------------

/** A section under construction: what it holds, and where it starts. */
interface Draft {
  parts: SectionPart[];
  indexes: number[];
  charCount: number;
  /** The first located start among its parts; null if none was located. */
  start: number | null;
}

function draftOf(section: Section, start: number | null): Draft {
  return {
    parts: [
      {
        title: section.title,
        headingPath: section.headingPath,
        charCount: section.charCount,
      },
    ],
    indexes: section.chunks,
    charCount: section.charCount,
    start,
  };
}

function appendDraft(into: Draft, from: Draft): Draft {
  return {
    parts: [...into.parts, ...from.parts],
    indexes: [...into.indexes, ...from.indexes],
    // The parts are joined with a blank line each.
    charCount: into.charCount + 2 + from.charCount,
    start: into.start ?? from.start,
  };
}

/**
 * The part that names a merged section: the **largest** one.
 *
 * Not the first — a praise page and a title page precede the chapter they
 * fold into, and naming the chapter after them is exactly wrong. Not the
 * last — the group that happened to tip the total over the floor may be an
 * employer's city read as a heading (measured on a CV: the section came out
 * titled `MakerDAO SES`). Furniture is small by definition, so the largest
 * part is the one the section is actually about. Ties go to the earlier part.
 */
function dominantPart(parts: readonly SectionPart[]): SectionPart {
  let best = parts[0];
  for (const part of parts) if (part.charCount > best.charCount) best = part;
  return best;
}

function finishDraft(draft: Draft, chunks: readonly SourceChunk[]): Section {
  const dominant = dominantPart(draft.parts);
  const section = buildSection(
    dominant.title,
    dominant.headingPath,
    draft.indexes,
    chunks,
  );
  if (draft.parts.length > 1) section.mergedFrom = draft.parts;
  return section;
}

/**
 * Folds sections below `floor` into a neighbour, preserving document order.
 *
 * Forward for the common case: a title page or a praise page belongs at the top
 * of the chapter that follows it, and folding forward keeps reading order.
 * A trailing undersized section (an index, a colophon) has nothing ahead of it,
 * so it folds back into the last surviving section.
 *
 * A document in which *every* section is undersized collapses to one section
 * named after the document — the honest answer for a one-page invoice: one
 * thing a human opens.
 */
function foldSmallSections(
  sections: Section[],
  starts: readonly (number | null)[],
  chunks: readonly SourceChunk[],
  floor: number,
  documentName: string,
): { drafts: Draft[]; merged: number } {
  const drafts = sections.map((s, i) => draftOf(s, starts[i]));
  if (floor <= 0 || drafts.length <= 1) return { drafts, merged: 0 };

  const out: Draft[] = [];
  let pending: Draft | null = null;

  for (const draft of drafts) {
    const carried: Draft = pending ? appendDraft(pending, draft) : draft;
    if (carried.charCount < floor) {
      pending = carried;
      continue;
    }
    out.push(carried);
    pending = null;
  }

  // A trailing undersized section folds back into the last surviving one.
  if (pending && out.length > 0) {
    out[out.length - 1] = appendDraft(out[out.length - 1], pending);
  }

  // Nothing survived: the whole document is smaller than the floor.
  if (out.length === 0) {
    const all = drafts.flatMap((d) => d.indexes);
    const whole = buildSection(documentName, [], all, chunks);
    return { drafts: [draftOf(whole, starts[0])], merged: sections.length - 1 };
  }

  return { drafts: out, merged: sections.length - out.length };
}

/**
 * Rejoins adjacent sections whose dominant heading path is the same.
 *
 * Contiguous grouping cuts a chapter in two wherever a sidebar with its own
 * heading interrupts it. Once the sidebar has been folded away (it is small),
 * the two halves sit side by side under the same path and belong together.
 * Only headed sections are rejoined: two unrelated front-matter runs are not
 * the same thing just because neither has a heading.
 */
function rejoinSamePath(drafts: Draft[]): {
  drafts: Draft[];
  rejoined: number;
} {
  const out: Draft[] = [];
  let rejoined = 0;
  for (const draft of drafts) {
    const previous = out.at(-1);
    if (previous) {
      const a = dominantPart(previous.parts).headingPath;
      const b = dominantPart(draft.parts).headingPath;
      if (a.length > 0 && pathKey(a, a.length) === pathKey(b, b.length)) {
        out[out.length - 1] = appendDraft(previous, draft);
        rejoined++;
        continue;
      }
    }
    out.push(draft);
  }
  return { drafts: out, rejoined };
}

// --- splitting --------------------------------------------------------------

/** Splits one over-ceiling section at chunk boundaries (paragraph-shaped). */
function splitByCeiling(
  section: Section,
  chunks: readonly SourceChunk[],
  ceiling: number,
): Section[] {
  const parts: Section[] = [];
  let current: number[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    parts.push(
      buildSection(
        `${section.title} · part ${parts.length + 1}`,
        section.headingPath,
        current,
        chunks,
      ),
    );
    current = [];
    currentChars = 0;
  };

  for (const i of section.chunks) {
    const size = chunks[i].text.length;
    // A single chunk larger than the ceiling is not split further: there is
    // no smaller authored boundary left to cut on.
    if (current.length > 0 && currentChars + size > ceiling) flush();
    current.push(i);
    currentChars += size;
  }
  flush();

  // A section that produced a single part is not reported as split.
  return parts.length > 1 ? parts : [section];
}

// --- the rule ---------------------------------------------------------------

/**
 * Turn a document's chunks into the sections that will become sources.
 *
 * Chunks above the first heading are grouped as front matter, because a title
 * page and a preface belong to the document, not to a chapter that does not
 * exist yet.
 *
 * Order of operations, and why: group into runs, *then* fold the undersized
 * away, *then* rejoin what the folding left adjacent under one heading, *then*
 * split the oversized. Folding first means a title page never becomes a
 * source; rejoining after it means a sidebar does not leave a chapter in two;
 * splitting last means a section that grew past the ceiling still gets divided.
 */
export function deriveSections(
  chunks: readonly SourceChunk[],
  options: DeriveSectionsOptions,
): SectionPlan {
  const ceiling = options.ceiling ?? SECTION_CHAR_CEILING;
  const minSectionChars = options.minSectionChars ?? SECTION_MIN_CHARS;
  const name = options.documentName;
  const markdown = options.markdown;

  const headed: number[] = [];
  chunks.forEach((c, i) => {
    if ((c.headings?.length ?? 0) > 0) headed.push(i);
  });
  const leading: number[] = [];
  for (let i = 0; i < (headed[0] ?? chunks.length); i++) leading.push(i);

  const cutLevel = chooseCutLevel(chunks, headed);
  const groups: Group[] = [];
  if (leading.length > 0) groups.push({ path: [], indexes: leading });
  if (cutLevel > 0) groups.push(...groupRuns(chunks, headed, cutLevel));

  const frontTitle = headed.length === 0 ? name : `${name} — front matter`;
  const sections = groups.map((g) =>
    buildSection(
      g.path.length === 0 ? frontTitle : g.path[g.path.length - 1],
      g.path,
      g.indexes,
      chunks,
    ),
  );

  // Front matter starts the markdown; every other group is found by heading.
  let starts: (number | null)[] = groups.map(() => null);
  if (markdown !== undefined) {
    starts = locateGroups(groups, markdown);
    if (leading.length > 0) starts[0] = 0;
  }

  const folded = foldSmallSections(
    sections,
    starts,
    chunks,
    minSectionChars,
    name,
  );
  const joined = rejoinSamePath(folded.drafts);
  const ranges = rangesFromStarts(
    joined.drafts.map((d) => d.start),
    markdown?.length ?? 0,
  );

  let splitSections = 0;
  const out: Section[] = [];
  joined.drafts.forEach((draft, i) => {
    const section = finishDraft(draft, chunks);
    section.markdownRange = ranges[i];
    if (section.charCount <= ceiling) {
      out.push(section);
      return;
    }
    const parts = splitByCeiling(section, chunks, ceiling);
    if (parts.length > 1) splitSections++;
    out.push(...parts);
  });

  return {
    sections: out,
    cutLevel,
    splitSections,
    mergedSections: folded.merged,
    rejoinedSections: joined.rejoined,
    ceiling,
    minSectionChars,
  };
}
