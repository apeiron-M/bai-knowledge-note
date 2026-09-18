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
