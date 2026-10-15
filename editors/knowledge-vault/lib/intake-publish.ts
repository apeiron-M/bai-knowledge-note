import type { IntakeFile, Section } from "./intake-model.js";

/**
 * What the vault will be asked to create, decided purely.
 *
 * Three of these rules are the routes' rules, not ours: a folder name cannot
 * contain `/` (source-folders.ts refuses it), a source cannot be created
 * without a `title` and a `content` (routes/sources.ts refuses both), and every
 * source from one document carries that document's `SourceType`. Getting them
 * wrong means a 400 part-way through a publish, with some of the batch already
 * written — so they are asserted here, before anything is sent.
 */

const MAX_NAME = 120;

export function sanitiseFolderName(raw: string): string {
  const cleaned = raw.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.slice(0, MAX_NAME).trim() || "Untitled";
}

export function sectionTitle(
  section: Section,
  index: number,
  documentName: string,
): string {
  const own = section.title.trim();
  if (own) return own.slice(0, MAX_NAME);
  return `${documentName} · part ${index + 1}`.slice(0, MAX_NAME);
}

/** A title as the vault keeps it on the source's node: trimmed, its spaces collapsed. */
export function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A file whose folder already holds its sections — an earlier add of it that
 * was cut short, or the same file added again — continues there: the sections
 * already in the folder (matched by title, each once) start left out, and the
 * rest goes in beside them rather than into a renamed folder.
 *
 * Only when what the folder holds is mostly this file's sections: a folder
 * that merely shares a name with another document keeps today's rename.
 * `null` when nothing changes.
 */
export function continuation(
  file: IntakeFile,
  titlesInFolder: ReadonlyMap<string, readonly string[]> | undefined,
): Pick<IntakeFile, "folderName" | "renamedFrom" | "alreadyIn" | "selected"> | null {
  const sections = file.converted?.sections ?? [];
  if (sections.length === 0 || !titlesInFolder) return null;
  const folder = file.renamedFrom ?? file.folderName;
  const titles = titlesInFolder.get(folder);
  if (!titles || titles.length === 0) return null;
  const left = new Map<string, number>();
  for (const title of titles) left.set(titleKey(title), (left.get(titleKey(title)) ?? 0) + 1);
  const alreadyIn = sections.map((section, index) => {
    const key = titleKey(sectionTitle(section, index, folder));
    const n = left.get(key) ?? 0;
    if (n === 0) return false;
    left.set(key, n - 1);
    return true;
  });
  const present = alreadyIn.filter(Boolean).length;
  if (present === 0 || present * 2 < titles.length) return null;
  return {
    folderName: folder,
    renamedFrom: undefined,
    alreadyIn,
    selected: file.selected.map((on, index) => on && !alreadyIn[index]),
  };
}

export type PublishPlan = {
  folderName: string;
  sources: {
    title: string;
    content: string;
    sourceType: string;
    sectionIndex: number;
  }[];
  /** Ticked sections with no content, which cannot become a source. */
  skipped: number;
};

export function publishPlan(file: IntakeFile): PublishPlan {
  const sections = file.converted?.sections ?? [];
  const sources: PublishPlan["sources"] = [];
  let skipped = 0;

  // A published row publishes nothing again: `POST sources` is not idempotent
  // on content, so a second pass would duplicate every source in the folder.
  if (file.publishedIds === undefined) {
    sections.forEach((section, index) => {
      if (file.selected[index] !== true) return;
      if (!section.content.trim()) {
        skipped += 1;
        return;
      }
      sources.push({
        title: sectionTitle(section, index, file.folderName),
        // `content` is the markdown slice (tables intact), or the chunk text when
        // the section could not be located in the markdown. Untrimmed on purpose.
        content: section.content,
        sourceType: file.sourceType,
        sectionIndex: index,
      });
    });
  }

  return { folderName: sanitiseFolderName(file.folderName), sources, skipped };
}
