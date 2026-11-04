import { GraphQLError } from "graphql";
import {
  ChangeInputError,
  cursorUntil,
  parseWindow,
  type ChangeDigest,
  type ChangeScope,
} from "../../../processors/graph-indexer/changes.js";
import { matchMapTitle } from "../../../processors/graph-indexer/changes-story.js";
import { isKnowledgeLinkType } from "../../../processors/graph-indexer/link-types.js";
import { getQuery, readerOf, type GraphSubgraph } from "./db.js";
import { searchVault } from "./search.js";

/** How many semantic hits a `q` scope starts from when it names no map (spec Addendum B2). */
export const CHANGE_Q_HITS = 25;

/**
 * Resolve a `q` scope (spec Addendum B2): a query that names a hub area or a
 * map below it (whole words, see `matchMapTitle`) scopes to that map's
 * subtree; otherwise the top semantic hits plus their one-hop knowledge-edge
 * neighbours. Explicit `documentIds` narrow the search result; with an
 * explicit `moc` the map is already chosen and `q` searches within it.
 * `resolved` says which it was. Shared by the GraphQL resolver and
 * `GET changes`, so both answer the same totals.
 */
export async function resolveChangeScope(
  subgraph: GraphSubgraph,
  driveId: string,
  scope: ChangeScope,
): Promise<ChangeScope> {
  if (!scope.q) return scope;
  const query = getQuery(subgraph, driveId);
  if (!scope.moc) {
    const map = matchMapTitle(scope.q, await query.changeMaps());
    if (map) return { ...scope, moc: map.id, resolved: { kind: "moc", id: map.id, title: map.title } };
  }
  const hits = await searchVault(subgraph, driveId, scope.q, "SEMANTIC", CHANGE_Q_HITS, false);
  const ids = new Set(hits.map((h) => String(h.node.documentId)));
  const edges = await query.edgesTouching([...ids]);
  const seeds = new Set(ids);
  for (const e of edges) {
    if (!isKnowledgeLinkType(e.linkType)) continue;
    if (seeds.has(e.sourceDocumentId)) ids.add(e.targetDocumentId);
    if (seeds.has(e.targetDocumentId)) ids.add(e.sourceDocumentId);
  }
  const explicit = scope.documentIds ? new Set(scope.documentIds) : null;
  const documentIds = [...ids].filter((id) => !explicit || explicit.has(id)).sort();
  return { ...scope, documentIds, resolved: { kind: "search", query: scope.q, hits: hits.length } };
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

interface DriveTreeNode {
  id: string;
  name?: string | null;
  kind?: string;
  documentType?: string | null;
  parentFolder?: string | null;
}

/**
 * Each source's folder as a path from the drive root (`/sources/powerhouse`).
 * A source at the drive root has none. Pure, over the drive's node list.
 */
export function sourceFolderPaths(nodes: readonly DriveTreeNode[]): Map<string, string> {
  const folders = new Map(nodes.filter((n) => n.kind === "folder").map((n) => [n.id, n]));
  const paths = new Map<string, string>();
  const pathOf = (id: string): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const names: string[] = [];
    const seen = new Set<string>();
    for (let f = folders.get(id); f && !seen.has(f.id); f = f.parentFolder ? folders.get(f.parentFolder) : undefined) {
      seen.add(f.id);
      names.unshift(f.name ?? f.id);
    }
    const path = `/${names.join("/")}`;
    paths.set(id, path);
    return path;
  };
  const out = new Map<string, string>();
  for (const n of nodes) {
    if (n.documentType === "bai/source" && n.parentFolder && folders.has(n.parentFolder)) out.set(n.id, pathOf(n.parentFolder));
  }
  return out;
}

/**
 * The drive's source folders, read from its tree (one document read, as the
 * source timeline does). Best effort: without them a source whose notes are
 * ungrouped lands in "Unplaced" rather than failing the digest.
 */
async function loadSourceFolders(subgraph: GraphSubgraph, driveId: string): Promise<Map<string, string>> {
  try {
    const drive = (await readerOf(subgraph).get(driveId)) as { state?: { global?: { nodes?: DriveTreeNode[] } } } | null;
    return sourceFolderPaths(drive?.state?.global?.nodes ?? []);
  } catch (err) {
    console.warn(`[changes] ${driveId}: could not read the drive tree for source folders:`, err instanceof Error ? err.message : err);
    return new Map();
  }
}

/** A malformed window or cursor is the caller's mistake, not the server's. */
export { ChangeInputError };

/**
 * The change digest for a drive (canonical id): window parsed in UTC, `q`
 * resolved, the caller's scope echoed. A next page asked without `until`
 * keeps the window the cursor was issued for. Authorization is the caller's
 * job — the subgraph's drive guard or the route's `canonicalForRead`.
 * Throws {@link ChangeInputError} for a bad date or cursor.
 */
export async function loadDriveChanges(
  subgraph: GraphSubgraph,
  driveId: string,
  args: ChangeArgs,
  now: Date = new Date(),
): Promise<ChangeDigest> {
  const until = args.until || (args.cursor ? cursorUntil(args.cursor) : null);
  const window = parseWindow(args.since, until, now);
  const scope = scopeOf(args);
  const [resolved, sourceFolders] = await Promise.all([
    resolveChangeScope(subgraph, driveId, scope),
    loadSourceFolders(subgraph, driveId),
  ]);
  const { resolved: how, ...internal } = resolved;
  const digest = await getQuery(subgraph, driveId).changes(window, internal, {
    limit: args.limit ?? undefined,
    cursor: args.cursor ?? undefined,
    sourceFolders,
  });
  return { ...digest, scope: how ? { ...scope, resolved: how } : scope };
}

/** {@link loadDriveChanges} for GraphQL: a bad window or cursor is BAD_USER_INPUT. */
export async function loadDriveChangesForGraphQL(subgraph: GraphSubgraph, driveId: string, args: ChangeArgs): Promise<ChangeDigest> {
  try {
    return await loadDriveChanges(subgraph, driveId, args);
  } catch (err) {
    if (err instanceof ChangeInputError) throw new GraphQLError(err.message, { extensions: { code: "BAD_USER_INPUT" } });
    throw err;
  }
}
