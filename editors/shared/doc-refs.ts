/**
 * Analyses written by the vault's automations name notes by id — a contradiction's "Involved claims" read
 * `title — \`id\``. A reader needs the note, not the id: this rewrites every id the vault knows into a link
 * token the markdown preview draws as the note's title (and opens it on click). Ids the vault does not know
 * stay as they are. The document keeps its ids — agents read them — only the reading copy changes.
 */
const ID = "[A-Za-z0-9_-]{16,64}";
const TITLE_THEN_ID = new RegExp(`([^\\n\`]*?)\\s+[—–-]\\s+\`(${ID})\``, "g");
const BARE_ID = new RegExp(`\`(${ID})\``, "g");

/** The token MarkdownPreview turns into a link to the document. */
export function docToken(id: string, title: string): string {
  return `[[doc:${id}|${title.replace(/[\]|\n]/g, " ").trim()}]]`;
}

const same = (a: string, b: string) => {
  const norm = (s: string) => s.trim().replace(/[.!?…]+$/, "").toLowerCase();
  return norm(a) === norm(b);
};

export function linkDocRefs(md: string, titleOf: (id: string) => string | null | undefined): string {
  // "title — `id`": the note once, as a link. Its words are the note's current title, so a note renamed
  // since the analysis was written shows the name it has now.
  let out = md.replace(TITLE_THEN_ID, (whole, before: string, id: string) => {
    const title = titleOf(id);
    if (!title) return whole;
    const lead = /^(\s*(?:[-*+]|\d+[.)])\s+)?(.*)$/.exec(before);
    const marker = lead?.[1] ?? "";
    const text = lead?.[2] ?? before;
    return same(text, title) || text.trim() === "" ? `${marker}${docToken(id, title)}` : `${before} — ${docToken(id, title)}`;
  });
  out = out.replace(BARE_ID, (whole, id: string) => {
    const title = titleOf(id);
    return title ? docToken(id, title) : whole;
  });
  return out;
}
