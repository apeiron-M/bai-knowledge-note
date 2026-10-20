/**
 * The inline side of citations: turning an answer's `[[documentId]]` markers
 * into the numbered chips the reader sees, and reading them back. Pure string
 * work, kept out of the component so it is testable without a DOM.
 */
import { parseMarker } from "./evidence.js";

/**
 * Replace `[[documentId]]` / `[[documentId#itemId]]` markers with
 * `[[cite:n:k]]` tokens — n the document's number in the Sources row, k the
 * marker's position in the text — which MarkdownPreview renders as chips. The
 * position ties a chip to its evidence (one passage per marker); it counts
 * every marker, listed or not, so it lines up with `collectEvidence`. A marker
 * whose document is not in the list (mid-stream, or a citation the resolver
 * dropped) is removed. One preceding space is consumed so "word [[id]]" and
 * "word[[id]]" both render as "word [n]" — never a double space.
 */
export function numberCitations(
  text: string,
  citations: readonly { documentId: string }[],
): string {
  const index = new Map(citations.map((c, i) => [c.documentId, i + 1]));
  let position = 0;
  return text.replace(/ ?\[\[([^\]]+?)\]\]/g, (_m, label: string) => {
    const k = position++;
    const n = index.get(parseMarker(label).documentId);
    return n ? ` [[cite:${n}:${k}]]` : "";
  });
}

/**
 * Every marker in text order, as document + anchor — the fallback for a turn
 * stored before evidence existed, so its chips still open the right place.
 */
export function markerOccurrences(
  text: string,
): { documentId: string; anchor: string | null }[] {
  return [...text.matchAll(/\[\[([^\]]+?)\]\]/g)].map((m) => parseMarker(m[1]));
}
