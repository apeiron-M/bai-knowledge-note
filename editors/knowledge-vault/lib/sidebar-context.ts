import type { Node } from "@powerhousedao/shared/document-drive";
import type { GraphFocus } from "../components/GraphView.js";
import type { VaultContextItem, VaultContextListProps } from "../components/VaultContextList.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import { contradictionLabel, type Contradiction } from "./contradictions.js";
import { hubMap, plural, rankedTopics, topicSize } from "./vault-lookups.js";

/**
 * A note opened from a topic map (one of its core ideas) or from a
 * contradiction (one of its claims): the sidebar keeps that place's list, and
 * closing the note goes back to where it was opened from.
 */
export type ContextOrigin = { place: "topics" | "contradictions"; id: string };

export type SidebarContextInput = {
  /** Every node in the drive: sources and the folders they sit in. */
  nodes: Node[];
  /** From `useKnowledgeNotes`, the same map its consumers read. */
  noteMap: Map<string, KnowledgeNoteInfo>;
  /** From `useKnowledgeMocs`, already in the order the Topics list shows. */
  mocs: MocInfo[];
  mocMap: Map<string, MocInfo>;
  /**
   * Source titles by id (`sourceTitleMap`): the tree knows only file names
   * ("07-ch05-language-i-told-you-so"); the title is in the document. A
   * source not in the map yet shows its name.
   */
  sourceTitles?: Map<string, string>;
  selected: Node | undefined;
  graphFocus: GraphFocus | null;
  /** Every contradiction, as the Contradictions place shows them. */
  contradictions?: Contradiction[];
  /** Where the open note was opened from, if from a topic map or a contradiction. */
  origin?: ContextOrigin | null;
  open: (id: string) => void;
  close: () => void;
  clearGraph: () => void;
  /** Back to a place's own page: "All topics", "All contradictions". */
  showPlace?: (place: "topics" | "contradictions") => void;
};

/** Titles from source documents, by id; documents without one are left out. */
export function sourceTitleMap(
  docs: ReadonlyArray<{ header: { id: string }; state: unknown }>,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const doc of docs) {
    const title = (doc.state as { global?: { title?: unknown } } | null)?.global?.title;
    if (typeof title === "string" && title.trim()) titles.set(doc.header.id, title.trim());
  }
  return titles;
}

/** File order: by name, numbers as numbers, so "02-…" comes before "10-…". */
const byFileName = (a: Node, b: Node) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });


function documentTypeOf(node: Node | undefined): string | undefined {
  return node && "documentType" in node ? node.documentType : undefined;
}

/**
 * The one place that decides what the sidebar lists while you are in a place.
 * A graph selection wins, then an open topic map or contradiction — or a note
 * opened from one — then an open source. Nothing else makes a context.
 */
export function buildSidebarContext(
  input: SidebarContextInput,
): VaultContextListProps | undefined {
  if (input.graphFocus) return graphContext(input, input.graphFocus);
  const docType = documentTypeOf(input.selected);
  const selected = input.selected;
  if (docType === "bai/moc" && selected) return topicContext(input, selected.id, selected.name);
  if (docType === "bai/tension" && selected) return contradictionContext(input, selected.id, selected.name);
  if (docType === "bai/knowledge-note" && input.origin) {
    return input.origin.place === "topics"
      ? topicContext(input, input.origin.id)
      : contradictionContext(input, input.origin.id);
  }
  if (docType === "bai/source" && selected) return sourceContext(input, selected);
  return undefined;
}

function graphContext(
  input: SidebarContextInput,
  focus: GraphFocus,
): VaultContextListProps {
  const { noteMap, mocMap } = input;
  const { selectedId, focusedIds } = focus;
  const selectedNote = noteMap.get(selectedId);
  // The edge between the selected note and a neighbour, either direction,
  // so the list says not just WHAT is connected but WHY.
  const edgeTo = (id: string) => {
    const out = selectedNote?.links.find((l) => l.targetDocumentId === id);
    if (out) return { linkType: out.linkType, reason: out.reason, direction: "out" as const };
    const back = noteMap.get(id)?.links.find((l) => l.targetDocumentId === selectedId);
    if (back) return { linkType: back.linkType, reason: back.reason, direction: "in" as const };
    return null;
  };
  const items: VaultContextItem[] = [
    selectedId,
    ...focusedIds.filter((id) => id !== selectedId),
  ].map((id) => {
    const note = noteMap.get(id);
    const moc = mocMap.get(id);
    const kind = note ? "Note" : moc ? "MoC" : "Unknown";
    const label = note ? (note.title ?? note.name) : moc ? moc.title : id.slice(0, 12);
    if (id === selectedId) {
      const meta = note?.noteType ?? moc?.tier ?? null;
      return { id, label, detail: [kind, meta].filter(Boolean).join(" · ") };
    }
    const edge = edgeTo(id);
    if (!edge) return { id, label, detail: kind };
    const arrow = edge.direction === "out" ? "→" : "←";
    const type = (edge.linkType ?? "linked").replace(/_/g, " ").toLowerCase();
    return {
      id,
      label,
      detail: [`${arrow} ${type}`, edge.reason].filter(Boolean).join(" · "),
    };
  });
  // The reader's current document, once stepping has moved it onto a
  // neighbour; the graph's own node until then.
  const current = input.selected?.id;
  const activeId =
    current !== undefined && items.some((i) => i.id === current) ? current : selectedId;
  return {
    place: "graph",
    title: items.find((i) => i.id === selectedId)?.label ?? "Selected node",
    subtitle: plural(items.length - 1, "connection"),
    items,
    activeId,
    onOpen: input.open,
    onBack: input.clearGraph,
  };
}

/**
 * Inside a topic map: every topic, the overview first, then the Topics page's
 * order (largest first), each with its count (design: "a topic map").
 */
function topicContext(
  input: SidebarContextInput,
  activeId: string,
  fallbackName?: string,
): VaultContextListProps {
  const hub = hubMap(input.mocs);
  const topics = rankedTopics(input.mocs);
  const items: VaultContextItem[] = [
    ...(hub ? [{ id: hub.id, label: `${hub.title} overview`, detail: "every topic", marker: "hub" as const }] : []),
    ...topics.map((m) => ({ id: m.id, label: m.title, detail: topicSize(m), marker: "map" as const })),
  ];
  // A map the index has not reached yet is still where you are.
  if (!items.some((i) => i.id === activeId)) {
    items.unshift({ id: activeId, label: fallbackName ?? "This topic", marker: "map" });
  }
  return {
    place: "topics",
    title: "Topics",
    subtitle: hub ? `${plural(topics.length, "topic")} and the overview` : plural(topics.length, "topic"),
    items,
    activeId,
    onOpen: input.open,
    onBack: input.showPlace ? () => input.showPlace?.("topics") : input.close,
    filterPlaceholder: "Filter topics",
  };
}

/**
 * Inside a contradiction: the open ones, each named by the claims it sets
 * against each other (design: "a contradiction"). One already closed is listed
 * while it is the one you are in.
 */
function contradictionContext(
  input: SidebarContextInput,
  activeId: string,
  fallbackName?: string,
): VaultContextListProps {
  const all = input.contradictions ?? [];
  const open = all.filter((c) => c.status === "OPEN");
  const listed = open.some((c) => c.id === activeId)
    ? open
    : [...open, ...all.filter((c) => c.id === activeId)];
  const items: VaultContextItem[] = listed.map((c) => ({
    id: c.id,
    label: contradictionLabel(c),
    detail: c.status === "OPEN" ? "Open" : c.status === "RESOLVED" ? "Resolved" : "Dissolved",
    marker: "warn",
  }));
  if (!items.some((i) => i.id === activeId)) {
    items.unshift({ id: activeId, label: fallbackName ?? "This contradiction", marker: "warn" });
  }
  return {
    place: "contradictions",
    title: "Contradictions",
    subtitle: `${open.length} open`,
    items,
    activeId,
    onOpen: input.open,
    onBack: input.showPlace ? () => input.showPlace?.("contradictions") : input.close,
  };
}

function sourceContext(
  input: SidebarContextInput,
  selected: Node,
): VaultContextListProps {
  const folderId = selected.parentFolder ?? null;
  const folder = folderId ? input.nodes.find((n) => n.id === folderId) : undefined;
  const sources = input.nodes
    .filter((n) => documentTypeOf(n) === "bai/source" && (n.parentFolder ?? null) === folderId)
    .sort(byFileName);
  return {
    place: "sources",
    title: folder?.name ?? "Sources",
    subtitle: plural(sources.length, "source"),
    items: sources.map((n) => ({ id: n.id, label: input.sourceTitles?.get(n.id) ?? n.name })),
    activeId: selected.id,
    onOpen: input.open,
    onBack: input.close,
  };
}
