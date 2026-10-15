/**
 * A contradiction's description quotes the notes it sets against each other
 * (“A” contradicts “B”). Split such a text into plain runs and the runs that
 * name a known note, so the editor can make each quoted note a link to it.
 */
export type MentionPart = string | { id: string; text: string };

export function mentionParts(text: string, notes: readonly { id: string; title: string }[]): MentionPart[] {
  const targets = notes.filter((n) => n.title.trim().length >= 3).sort((a, b) => b.title.length - a.title.length);
  const parts: MentionPart[] = [];
  let i = 0;
  let plain = "";
  while (i < text.length) {
    const hit = targets.find((n) => text.startsWith(n.title, i));
    if (hit) {
      if (plain) parts.push(plain);
      plain = "";
      parts.push({ id: hit.id, text: hit.title });
      i += hit.title.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) parts.push(plain);
  return parts;
}
