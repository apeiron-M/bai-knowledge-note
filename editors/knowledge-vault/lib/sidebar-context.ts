import type { Node } from "@powerhousedao/shared/document-drive";
import type { GraphFocus } from "../components/GraphView.js";
import type { VaultContextItem, VaultContextListProps } from "../components/VaultContextList.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";

export type SidebarContextInput = {
  /** Every node in the drive: sources and the folders they sit in. */
  nodes: Node[];
  /** From `useKnowledgeNotes`, the same map its consumers read. */
  noteMap: Map<string, KnowledgeNoteInfo>;
  /** From `useKnowledgeMocs`, already in the order the Topics list shows. */
  mocs: MocInfo[];
  mocMap: Map<string, MocInfo>;
  selected: Node | undefined;
  graphFocus: GraphFocus | null;
  open: (id: string) => void;
  close: () => void;
  clearGraph: () => void;
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function documentTypeOf(node: Node | undefined): string | undefined {
  return node && "documentType" in node ? node.documentType : undefined;
}

/**
 * The one place that decides what the sidebar lists while you are in a place.
 * A graph selection wins, then an open topic map, then an open source.
 * Nothing else makes a context.
 */
export function buildSidebarContext(
  input: SidebarContextInput,
): VaultContextListProps | undefined {
  if (input.graphFocus) return graphContext(input, input.graphFocus);
  const docType = documentTypeOf(input.selected);
  if (docType === "bai/moc" && input.selected) return topicContext(input, input.selected);
  if (docType === "bai/source" && input.selected) return sourceContext(input, input.selected);
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

function topicContext(
  input: SidebarContextInput,
  selected: Node,
): VaultContextListProps {
  const current = input.mocMap.get(selected.id);
  return {
    place: "topics",
    title: current?.title ?? selected.name,
    subtitle: plural(input.mocs.length, "topic"),
    items: input.mocs.map((m) => ({ id: m.id, label: m.title, detail: plural(m.noteCount, "note") })),
    activeId: selected.id,
    onOpen: input.open,
    onBack: input.close,
  };
}

function sourceContext(
  input: SidebarContextInput,
  selected: Node,
): VaultContextListProps {
  const folderId = selected.parentFolder ?? null;
  const folder = folderId ? input.nodes.find((n) => n.id === folderId) : undefined;
  const sources = input.nodes.filter(
    (n) => documentTypeOf(n) === "bai/source" && (n.parentFolder ?? null) === folderId,
  );
  return {
    place: "sources",
    title: folder?.name ?? "Sources",
    subtitle: plural(sources.length, "source"),
    items: sources.map((n) => ({ id: n.id, label: n.name })),
    activeId: selected.id,
    onOpen: input.open,
    onBack: input.close,
  };
}
