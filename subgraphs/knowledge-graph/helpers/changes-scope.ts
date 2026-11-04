import { GraphQLError } from "graphql";
import { parseWindow, type ChangeDigest, type ChangeScope } from "../../../processors/graph-indexer/changes.js";
import { isKnowledgeLinkType } from "../../../processors/graph-indexer/link-types.js";
import { getQuery, type GraphSubgraph } from "./db.js";
import { searchVault } from "./search.js";

/** How many semantic hits a `q` scope starts from (spec §7). */
export const CHANGE_Q_HITS = 10;

/**
 * Resolve a `q` scope to document ids: the top semantic hits plus their
 * one-hop knowledge-edge neighbours, so "what changed in processors" works
 * without knowing a map id. Explicit `documentIds` narrow the result. Shared
 * by the GraphQL resolver and `GET changes`, so both answer the same totals.
 */
export async function resolveChangeScope(
  subgraph: GraphSubgraph,
  driveId: string,
  scope: ChangeScope,
): Promise<ChangeScope> {
  if (!scope.q) return scope;
  const hits = await searchVault(subgraph, driveId, scope.q, "SEMANTIC", CHANGE_Q_HITS, false);
  const ids = new Set(hits.map((h) => String(h.node.documentId)));
  const edges = await getQuery(subgraph, driveId).edgesTouching([...ids]);
  const seeds = new Set(ids);
  for (const e of edges) {
    if (!isKnowledgeLinkType(e.linkType)) continue;
    if (seeds.has(e.sourceDocumentId)) ids.add(e.targetDocumentId);
    if (seeds.has(e.targetDocumentId)) ids.add(e.sourceDocumentId);
  }
  const explicit = scope.documentIds ? new Set(scope.documentIds) : null;
  const documentIds = [...ids].filter((id) => !explicit || explicit.has(id)).sort();
  return { ...scope, documentIds };
}

export type ChangeArgs = {
  since: string;
  until?: string | null;
  moc?: string | null;
  topic?: string | null;
  q?: string | null;
  documentIds?: string[] | null;
  types?: string[] | null;
  limit?: number | null;
  cursor?: string | null;
};

/** The caller's scope, without the keys they left out. */
export function scopeOf(args: ChangeArgs): ChangeScope {
  const scope: ChangeScope = {};
  if (args.moc) scope.moc = args.moc;
  if (args.topic) scope.topic = args.topic;
  if (args.q) scope.q = args.q;
  if (args.documentIds?.length) scope.documentIds = args.documentIds;
  if (args.types?.length) scope.types = args.types;
  return scope;
}

/** A malformed window is the caller's mistake, not the server's. */
export class ChangeWindowError extends Error {}

/**
 * The change digest for a drive (canonical id): window parsed in UTC, `q`
 * resolved, the caller's scope echoed. Authorization is the caller's job —
 * the subgraph's drive guard or the route's `canonicalForRead`.
 */
export async function loadDriveChanges(
  subgraph: GraphSubgraph,
  driveId: string,
  args: ChangeArgs,
  now: Date = new Date(),
): Promise<ChangeDigest> {
  let window: { since: string; until: string };
  try {
    window = parseWindow(args.since, args.until, now);
  } catch (err) {
    throw new ChangeWindowError(err instanceof Error ? err.message : String(err));
  }
  const scope = scopeOf(args);
  const resolved = await resolveChangeScope(subgraph, driveId, scope);
  const digest = await getQuery(subgraph, driveId).changes(window, resolved, {
    limit: args.limit ?? undefined,
    cursor: args.cursor ?? undefined,
  });
  return { ...digest, scope };
}

/** {@link loadDriveChanges} for GraphQL: a bad window is BAD_USER_INPUT. */
export async function loadDriveChangesForGraphQL(subgraph: GraphSubgraph, driveId: string, args: ChangeArgs): Promise<ChangeDigest> {
  try {
    return await loadDriveChanges(subgraph, driveId, args);
  } catch (err) {
    if (err instanceof ChangeWindowError) throw new GraphQLError(err.message, { extensions: { code: "BAD_USER_INPUT" } });
    throw err;
  }
}
