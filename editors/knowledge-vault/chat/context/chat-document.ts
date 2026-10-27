import type { PHDocument } from "document-model";
import { documentTitle, type ChatDocument } from "../core/ref-candidates.js";
import type { CandidateDoc, DocumentTarget } from "./context-frame.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A loaded document as the chat sees it (global state only). */
export function toChatDocument(d: PHDocument): ChatDocument {
  const state: unknown = d.state;
  const global = isRecord(state) && isRecord(state.global) ? state.global : {};
  return {
    id: d.header.id,
    docType: d.header.documentType,
    title: documentTitle(global, d.header.name || d.header.id),
    state: global,
  };
}

/**
 * The drive's documents as candidates, from file nodes (id, name, type)
 * and the titles the chat has seen (the recent ring, the open document).
 * Node names go stale (nothing sends UPDATE_NODE after SET_TITLE), so a
 * known title leads and the node name stays as an alias.
 */
export function candidateDocs(
  nodes: { id: string; name: string; documentType: string }[],
  known: DocumentTarget[],
): CandidateDoc[] {
  const titles = new Map<string, string>();
  for (const k of [...known].reverse()) if (k.title) titles.set(k.id, k.title);
  return nodes.map((n) => {
    const title = titles.get(n.id);
    return title && title !== n.name
      ? { id: n.id, docType: n.documentType, title, aliases: n.name ? [n.name] : [] }
      : { id: n.id, docType: n.documentType, title: n.name || n.id };
  });
}
