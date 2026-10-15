import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";

/**
 * Lookups the vault's own views share: the Topics page, Contradictions and
 * the Ctrl K palette. Pure, and built from data the vault already holds (the
 * graph projection and the drive tree), so none of them costs a request.
 */

/** The fields of a drive tree node these lookups read (a file or a folder). */
export type TreeNodeLike = {
  id: string;
  name: string;
  kind: string;
  parentFolder?: string | null;
  documentType?: string;
};

/** "2 notes", "1 note". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The vault's overview map: the one map every other map hangs from. */
export function hubMap(mocs: readonly MocInfo[]): MocInfo | undefined {
  return mocs.find((m) => m.tier === "HUB");
}

/**
 * Every map but the overview, largest first (design: the Topics list), then
 * by title so equal counts keep one order.
 */
export function rankedTopics(mocs: readonly MocInfo[]): MocInfo[] {
  const hub = hubMap(mocs);
  return mocs
    .filter((m) => m !== hub)
    .sort((a, b) => b.noteCount - a.noteCount || a.title.localeCompare(b.title));
}

/**
 * What a map's count says: its notes, or — for a map that only gathers other
 * maps — its maps, so it never reads "0 notes".
 */
export function topicSize(moc: MocInfo): string {
  if (moc.noteCount === 0 && moc.childRefs.length > 0) return plural(moc.childRefs.length, "map");
  return plural(moc.noteCount, "note");
}

const TIER_PREFERENCE: Record<string, number> = { TOPIC: 0, DOMAIN: 1 };

/**
 * The topic each note sits in, by note id: the narrowest map that holds it as
 * a core idea (a topic before a domain). The overview holds maps, not notes,
 * and never counts.
 */
export function noteTopicIndex(mocs: readonly MocInfo[]): Map<string, MocInfo> {
  const index = new Map<string, MocInfo>();
  const rank = (m: MocInfo) => (m.tier ? (TIER_PREFERENCE[m.tier] ?? 2) : 2);
  for (const moc of mocs) {
    if (moc.tier === "HUB") continue;
    for (const idea of moc.coreIdeas) {
      const held = index.get(idea.noteRef);
      if (!held || rank(moc) < rank(held)) index.set(idea.noteRef, moc);
    }
  }
  return index;
}

/**
 * An original the vault was given: the folder under /sources that holds its
 * parts, or the source itself when it came in whole.
 */
export type SourceDocument = {
  id: string;
  /** How the original reads (`originalName`): "2026 global tech report technology". */
  name: string;
  /** The folder's or file's own name in the drive: "2026-global-tech-report-technology.pdf.coredownload.inline". */
  fileName: string;
  kind: "folder" | "source";
  /** The `bai/source` documents it is made of. */
  sourceIds: string[];
};

export type SourceDocuments = {
  documents: SourceDocument[];
  /** source id → the original it belongs to */
  bySource: Map<string, SourceDocument>;
};

/**
 * The vault's originals, from the drive tree. A file dropped on the vault
 * becomes a folder under /sources holding one source per section; the folder
 * is the original. A source sitting directly in /sources (pasted text, a
 * short file) is its own original. Without a /sources folder, a source's own
 * folder is taken as its original.
 */
export function sourceDocuments(nodes: readonly TreeNodeLike[]): SourceDocuments {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const root = nodes.find((n) => n.kind === "folder" && !n.parentFolder && n.name === "sources");
  const documents = new Map<string, SourceDocument>();
  const bySource = new Map<string, SourceDocument>();
  for (const node of nodes) {
    if (node.documentType !== "bai/source") continue;
    let holder: TreeNodeLike = node;
    if (root) {
      // Climb to the node directly under /sources.
      let parent = node.parentFolder ? byId.get(node.parentFolder) : undefined;
      while (parent && parent.id !== root.id && parent.parentFolder !== root.id) {
        parent = parent.parentFolder ? byId.get(parent.parentFolder) : undefined;
      }
      if (parent && parent.parentFolder === root.id) holder = parent;
    } else if (node.parentFolder) {
      holder = byId.get(node.parentFolder) ?? node;
    }
    let doc = documents.get(holder.id);
    if (!doc) {
      doc = {
        id: holder.id,
        name: originalName(holder.name),
        fileName: holder.name,
        kind: holder.kind === "folder" ? "folder" : "source",
        sourceIds: [],
      };
      documents.set(holder.id, doc);
    }
    doc.sourceIds.push(node.id);
    bySource.set(node.id, doc);
  }
  return { documents: [...documents.values()], bySource };
}

/** A file extension, or the suffix a browser leaves on a download, at the end of a name. */
const FILE_SUFFIX =
  /\.(pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|txt|md|markdown|html?|epub|csv|tsv|json|xml|coredownload|crdownload|download|part|inline|tmp)$/i;

/**
 * An original's name as a reader would write it. The vault knows only the
 * file it was given, so a file-style name is tidied: extensions and download
 * suffixes go, and a slug's dashes and underscores become spaces
 * ("State-of-AI-Report-2026.pdf" → "State of AI Report 2026"). A name that
 * already reads as words is left alone.
 */
export function originalName(fileName: string): string {
  let name = fileName.trim();
  while (FILE_SUFFIX.test(name)) name = name.replace(FILE_SUFFIX, "");
  if (!name) return fileName;
  if (/\s/.test(name)) return name;
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : fileName;
}

/** The original a note was extracted from, through its DERIVED_FROM link. */
export function noteSourceDocument(
  note: KnowledgeNoteInfo,
  bySource: ReadonlyMap<string, SourceDocument>,
): SourceDocument | undefined {
  for (const link of note.links) {
    if (link.linkType !== "DERIVED_FROM" || !link.targetDocumentId) continue;
    const doc = bySource.get(link.targetDocumentId);
    if (doc) return doc;
  }
  return undefined;
}

/** How many notes each original gave the vault, by original id. */
export function notesPerSourceDocument(
  notes: readonly KnowledgeNoteInfo[],
  bySource: ReadonlyMap<string, SourceDocument>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const doc = noteSourceDocument(note, bySource);
    if (doc) counts.set(doc.id, (counts.get(doc.id) ?? 0) + 1);
  }
  return counts;
}

/** A note's kind in the reader's words: "concept" → "Concept", "bug-pattern" → "Bug pattern". */
export function kindLabel(noteType: string | null | undefined): string | null {
  const raw = noteType?.trim();
  if (!raw) return null;
  const words = raw.replace(/[-_]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
