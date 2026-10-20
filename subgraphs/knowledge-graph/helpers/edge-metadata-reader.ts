/**
 * Reading relationship metadata during a reindex.
 *
 * The public client surface returns the DOCUMENTS at the other end of a
 * relationship (`getOutgoingRelationships(...) → PHDocument[]`), never the
 * relationship rows, so it cannot tell us an edge's `metadata`. The rows
 * live in the reactor's document-indexer read model, which the in-process
 * `ReactorClient` holds as a private field. We reach for it structurally:
 * if the object we were handed has a `documentIndexer.getOutgoing`, we use
 * it; otherwise metadata is preserved from the projection's existing rows
 * and nothing else changes. Both branches are exercised by tests.
 *
 * The indexer's own paging works (it honours `limit` and returns `next()`),
 * unlike the client's relationship reads — see relationship-paging.ts for
 * that story — so one walk per document covers every knowledge type.
 */
import {
  normalizeEdgeMetadata,
  serializeEdgeMetadata,
} from "../../../processors/graph-indexer/edge-metadata.js";

export type RelationshipMetadataRow = {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  metadata?: unknown;
};

export type RelationshipMetadataPage = {
  results: RelationshipMetadataRow[];
  next?: () => Promise<RelationshipMetadataPage>;
};

export type RelationshipPaging = { cursor: string; limit: number };

/** The two indexer reads the reindex needs, in the reactor's own shape. */
export type DocumentIndexerLike = {
  getOutgoing(
    documentId: string,
    types?: string[],
    paging?: RelationshipPaging,
  ): Promise<RelationshipMetadataPage>;
  getIncoming(
    documentId: string,
    types?: string[],
    paging?: RelationshipPaging,
  ): Promise<RelationshipMetadataPage>;
};

/** Bounds one document's walk; 1000 pages × 100 rows is far beyond real data. */
export const MAX_METADATA_PAGES = 1000;

const PAGE_LIMIT = 100;

/**
 * The document indexer behind a reactor client, if this client is the
 * in-process one. Null for GraphQL clients and test doubles without it.
 */
export function documentIndexerOf(client: unknown): DocumentIndexerLike | null {
  const candidate = (client as { documentIndexer?: unknown } | null | undefined)
    ?.documentIndexer as Partial<DocumentIndexerLike> | undefined;
  if (
    candidate &&
    typeof candidate.getOutgoing === "function" &&
    typeof candidate.getIncoming === "function"
  ) {
    return candidate as DocumentIndexerLike;
  }
  return null;
}

/** `graph_edges.id` for a relationship row — the processor's convention. */
export function edgeIdOf(row: RelationshipMetadataRow): string {
  return `${row.sourceId}-${row.targetId}-${row.relationshipType}`;
}

/**
 * Walk one indexer read to exhaustion and return `edgeId → serialized
 * metadata` for every row that carries any. Rows without metadata are not
 * in the map, so callers can `?? preserved.get(id) ?? null`.
 */
export async function readRelationshipMetadata(
  fetchPage: (paging: RelationshipPaging) => Promise<RelationshipMetadataPage>,
  options: { maxPages?: number } = {},
): Promise<Map<string, string>> {
  const maxPages = options.maxPages ?? MAX_METADATA_PAGES;
  const out = new Map<string, string>();
  let page: RelationshipMetadataPage | undefined = await fetchPage({
    cursor: "0",
    limit: PAGE_LIMIT,
  });
  let pages = 0;
  while (page && page.results.length > 0 && pages < maxPages) {
    pages++;
    for (const row of page.results) {
      const text = serializeEdgeMetadata(normalizeEdgeMetadata(row.metadata));
      if (text) out.set(edgeIdOf(row), text);
    }
    page = page.next ? await page.next() : undefined;
  }
  return out;
}

/** Outgoing metadata for one source document over the given types. */
export function readOutgoingMetadata(
  indexer: DocumentIndexerLike,
  sourceId: string,
  types: readonly string[],
): Promise<Map<string, string>> {
  return readRelationshipMetadata((paging) =>
    indexer.getOutgoing(sourceId, [...types], paging),
  );
}

/** Incoming metadata for one target document over the given types. */
export function readIncomingMetadata(
  indexer: DocumentIndexerLike,
  targetId: string,
  types: readonly string[],
): Promise<Map<string, string>> {
  return readRelationshipMetadata((paging) =>
    indexer.getIncoming(targetId, [...types], paging),
  );
}
