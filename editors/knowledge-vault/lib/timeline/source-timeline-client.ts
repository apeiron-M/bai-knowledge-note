/**
 * The editor's side of the source timeline: the query, how to read its
 * answer, and — for a server that predates the query — the builder's input
 * made from what the editor already holds (the drive tree, the source
 * documents the Sources view loads, the graph).
 */
import {
  findSourcesRoot,
  sourceFromDocument,
  type SourceTimeline,
  type TimelineInput,
  type TimelineSource,
} from "../../../../processors/graph-indexer/source-timeline.js";
import type { DriveTreeNode, GraphEdgeMetadata, GraphNodeMetadata } from "../../hooks/use-graph-metadata.js";

export const SOURCE_TIMELINE_QUERY = `query SourceTimeline($driveId: ID!) {
  knowledgeGraphSourceTimeline(driveId: $driveId) {
    additions {
      id kind title folderId addedAt lastAddedAt addedBy fileName mimeType sizeBytes method tool url sourceType
      sources extracted waiting archived sourceIds notes firstNoteAt lastNoteAt writtenFrom topicIds
      linksWithin linksToEarlier earlier { additionId links } tags { name count } topNotes { documentId title }
    }
    notes { documentId addedAt writtenAt additionId }
    topics { documentId title addedAt writtenAt additionId }
    totals { sources notes topics links }
  }
}`;

export type TimelineAnswer = { kind: "timeline"; timeline: SourceTimeline } | { kind: "unsupported" };

const UNSUPPORTED = /Cannot query field "knowledgeGraphSourceTimeline"|Unknown type "KnowledgeGraphSourceTimeline"/;

/** The timeline, or "unsupported" when the server predates the query; any other error throws. */
export function readTimelineAnswer(json: unknown): TimelineAnswer {
  const body = (json ?? {}) as { data?: { knowledgeGraphSourceTimeline?: SourceTimeline | null } | null; errors?: { message?: string }[] };
  const messages = (body.errors ?? []).map((e) => e.message ?? "").filter(Boolean);
  if (messages.some((m) => UNSUPPORTED.test(m))) return { kind: "unsupported" };
  if (messages.length > 0) throw new Error(messages.join("; "));
  const timeline = body.data?.knowledgeGraphSourceTimeline;
  if (!timeline) throw new Error("The server sent no timeline");
  return { kind: "timeline", timeline };
}

/** Ask the knowledge-graph subgraph; `post` sends the body (authedGraphQLFetch in the app). */
export async function fetchSourceTimeline(driveId: string, post: (body: unknown) => Promise<Response>): Promise<TimelineAnswer> {
  const res = await post({ query: SOURCE_TIMELINE_QUERY, variables: { driveId } });
  // GraphQL servers answer a query they cannot validate with 400 and the reason in the body.
  if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status} from the knowledge graph`);
  return readTimelineAnswer((await res.json()) as unknown);
}

export interface BrowserTimelineData {
  treeNodes: readonly DriveTreeNode[];
  /** Source documents as the Sources view loads them: `{ header, state }`. */
  sourceDocs: readonly unknown[];
  graphNodes: readonly GraphNodeMetadata[];
  graphEdges: readonly GraphEdgeMetadata[];
}

/** The builder's input from what the editor holds. Notes have no arrival time here, so they arrive when written. */
export function timelineInputFromBrowser(d: BrowserTimelineData): TimelineInput {
  const folders = d.treeNodes.filter((n) => n.kind === "folder").map((n) => ({ id: n.id, name: n.name, parentFolder: n.parentFolder ?? null }));
  const placed = new Map(d.treeNodes.filter((n) => n.documentType === "bai/source").map((n) => [n.id, n.parentFolder ?? null]));
  const sources = d.sourceDocs
    .map((doc) => {
      const id = (doc as { header?: { id?: unknown } } | null)?.header?.id;
      return typeof id === "string" && placed.has(id) ? sourceFromDocument(doc, placed.get(id) ?? null) : null;
    })
    .filter((s): s is TimelineSource => s !== null);
  return {
    sourcesFolderId: findSourcesRoot(folders),
    folders,
    sources,
    nodes: d.graphNodes.map((n) => ({
      documentId: n.documentId,
      documentType: n.documentType ?? "bai/knowledge-note",
      title: n.title ?? "",
      status: n.status,
      noteType: n.noteType,
      topics: n.topics,
      addedAt: null,
      createdAt: n.createdAt,
      sourceOrigin: n.sourceOrigin,
    })),
    edges: d.graphEdges.map((e) => ({ source: e.sourceDocumentId, target: e.targetDocumentId, type: e.linkType ?? "" })),
  };
}

export interface BrowserReadiness {
  /** The graph query is in flight. */
  graphLoading: boolean;
  /** A graph is already on screen (a refresh, not the first load). */
  graphHasNodes: boolean;
  /** Source documents are still being read one by one. */
  docsLoading: boolean;
}

/**
 * Whether the browser fallback has everything it needs. Building early would
 * file every note whose source has not been read yet under "no recorded source".
 */
export function browserTimelineReady(r: BrowserReadiness): boolean {
  if (r.docsLoading) return false;
  return r.graphHasNodes || !r.graphLoading;
}

/** The last complete browser-built timeline, and the vault it belongs to. */
export interface HeldTimeline<T> {
  driveId: string;
  timeline: T;
}

/**
 * What the browser fallback shows: a complete build when there is one, else
 * the last complete one for this vault. Adding a source makes the document
 * list incomplete again until the new one is read; holding the last picture
 * keeps the page from dropping back to "Reading the vault…" each time.
 */
export function shownBrowserTimeline<T>(fresh: T | null, held: HeldTimeline<T> | null, driveId: string): T | null {
  if (fresh) return fresh;
  return held && held.driveId === driveId ? held.timeline : null;
}
