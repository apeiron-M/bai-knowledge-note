/**
 * The Sources list's rows from the server in one answer
 * (`knowledgeGraphSources`), instead of one document read per source. A
 * server that predates the query answers "unsupported" and the list reads
 * the documents as before.
 */
import type { SourceRow } from "./source-search.js";

export const SOURCE_ROWS_QUERY = `query SourceRows($driveId: ID!) {
  knowledgeGraphSources(driveId: $driveId) {
    documentId parentFolder name title description status sourceType author url addedAt createdAt createdBy
    updatedAt extractedAt publishedAt originalFile originalFileName originalAttachedAt originalSizeBytes claimCount
  }
}`;

/** A list row plus what the intake reads: the original's ref and the folder. */
export interface ServerSourceRow extends SourceRow {
  parentFolder: string | null;
  originalFile: string | null;
}

export type SourceRowsAnswer = { kind: "rows"; rows: ServerSourceRow[] } | { kind: "unsupported" };

const UNSUPPORTED = /Cannot query field "knowledgeGraphSources"|Unknown type "KnowledgeGraphSourceRow"/;

interface WireRow {
  documentId: string;
  parentFolder: string | null;
  name: string | null;
  title: string;
  description: string | null;
  status: string;
  sourceType: string | null;
  author: string | null;
  url: string | null;
  addedAt: string;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  extractedAt: string | null;
  publishedAt: string | null;
  originalFile: string | null;
  originalFileName: string | null;
  originalAttachedAt: string | null;
  originalSizeBytes: number | null;
  claimCount: number;
}

/** The same row `toSourceRow` makes from a document, from the server's. */
export function fromWire(r: WireRow): ServerSourceRow {
  return {
    id: r.documentId,
    name: r.name ?? r.title,
    title: r.title,
    description: r.description,
    author: r.author,
    url: r.url,
    sourceType: r.sourceType,
    status: r.status || "INBOX",
    claimCount: r.claimCount,
    createdBy: r.createdBy,
    createdAt: r.createdAt ?? r.addedAt,
    updatedAt: r.updatedAt,
    extractedAt: r.extractedAt,
    publishedAt: r.publishedAt,
    originalAttachedAt: r.originalAttachedAt,
    originalSizeBytes: r.originalSizeBytes,
    parentFolder: r.parentFolder,
    originalFile: r.originalFile,
  };
}

/** The rows, or "unsupported" when the server predates the query; any other error throws. */
export function readSourceRowsAnswer(json: unknown): SourceRowsAnswer {
  const body = (json ?? {}) as { data?: { knowledgeGraphSources?: WireRow[] | null } | null; errors?: { message?: string }[] };
  const messages = (body.errors ?? []).map((e) => e.message ?? "").filter(Boolean);
  if (messages.some((m) => UNSUPPORTED.test(m))) return { kind: "unsupported" };
  if (messages.length > 0) throw new Error(messages.join("; "));
  const rows = body.data?.knowledgeGraphSources;
  if (!rows) throw new Error("The server sent no sources");
  return { kind: "rows", rows: rows.map(fromWire) };
}

/** Ask the knowledge-graph subgraph; `post` sends the body (authedGraphQLFetch in the app). */
export async function fetchSourceRows(driveId: string, post: (body: unknown) => Promise<Response>): Promise<SourceRowsAnswer> {
  const res = await post({ query: SOURCE_ROWS_QUERY, variables: { driveId } });
  // GraphQL servers answer a query they cannot validate with 400 and the reason in the body.
  if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status} from the knowledge graph`);
  return readSourceRowsAnswer((await res.json()) as unknown);
}
