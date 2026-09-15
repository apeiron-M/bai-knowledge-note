import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { GraphQLError } from "graphql";
import { getDb, getQuery, resolveCanonicalDriveId } from "./helpers/db.js";
import { reindexDrive } from "./helpers/reindex.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";
import {
  searchSimilar,
  getEmbedding,
} from "../../processors/graph-indexer/embedding-store.js";
import { isCurrentNode } from "../../processors/graph-indexer/query.js";
import { searchVault, searchWithEmbedding } from "./helpers/search.js";
import {
  buildNeighbourhood,
  type Neighbourhood,
} from "./helpers/neighbourhood.js";

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  ctx: unknown,
  info: unknown,
) => unknown;

/**
 * The context shape `assertCanRead` expects, derived rather than imported so
 * this file does not depend on the exported name of reactor-api's context type.
 */
type SubgraphContext = Parameters<BaseSubgraph["assertCanRead"]>[1];

/**
 * Resolvers that must not be served on a bare READ grant.
 *
 * One mutation because it writes: `knowledgeGraphReindex` DELETEs and rebuilds
 * the projection (and CREATEs its tables when a namespace has none).
 *
 * Four queries because of what they expose rather than what they change:
 * `knowledgeGraphDebug` serves the raw projection tables, and the three
 * activity/history resolvers serve `input_json` diffs together with
 * `signer_address` — real contributor Ethereum addresses. That is an audit log
 * and an address book, not vault content.
 *
 * One query because of who it is FOR: `knowledgeGraphBridges` exposes nothing
 * a reader could not already fetch — it returns nodes from the same graph —
 * but it answers "which notes are load-bearing, and what would archiving one
 * strand". That is a curation question, actionable only with write access, so
 * it sits with the curation tools rather than with discovery. It is also the
 * one query that reads the whole graph, which makes the narrower grant worth
 * having on its own.
 */
export const PRIVILEGED_RESOLVERS = new Set([
  "knowledgeGraphReindex",
  "knowledgeGraphDebug",
  "knowledgeGraphHistory",
  "knowledgeGraphActivity",
  "knowledgeGraphActivityByType",
  "knowledgeGraphBridges",
]);

/**
 * Drive-scoped guards for every resolver: authorize the caller against the
 * drive, then resolve the drive's `driveId` argument to its canonical UUID.
 *
 * **Why the authorization lives here and not in the reactor.** This subgraph
 * reads the graph-indexer's own relational tables, not the reactor, so it
 * inherits none of the reactor's read gate: with `DEFAULT_PROTECTION=true` and
 * every document protected, an anonymous `knowledgeGraphRecent` still returned
 * full note bodies (measured: 12,696 characters) while the same content was
 * correctly refused through `document()`. A processor is inside the trust
 * boundary and sees everything; whatever it re-exposes is its own surface to
 * gate. This is that gate, and it sits in the one wrapper every resolver
 * already passes through so no resolver can be added ungated by omission.
 *
 * The check deliberately does no policy branching. `assertCanRead` /
 * `assertCanWrite` already answer correctly for each configured policy — open
 * under `OPEN`, admins-only under `ADMIN_ONLY`, per-drive grants under
 * `DOCUMENT_PERMISSIONS` — and a grant on the drive inherits to every document
 * beneath it. Testing `isSupremeAdmin` here instead would be wrong, because
 * under `OPEN` it answers true for everyone, anonymous callers included.
 *
 * A slug is authorized identically to a UUID: `assertCanRead` resolves the
 * identifier itself, and it runs before the canonical rewrite below, so the
 * slug-aliasing path cannot skip the check.
 */
/**
 * Per-request memo of authorization checks, keyed on the GraphQL context.
 *
 * `assertCanRead` walks the ancestor / protection / grant chain on every call,
 * and a multi-alias query repeats it once per alias against the same drive.
 * The context object is per-request, so this can never leak a decision across
 * identities or requests — which is why it is a WeakMap on ctx rather than a
 * process-level cache.
 *
 * The *promise* is memoized, not its result: concurrent aliases then share one
 * in-flight check, and a refusal is shared too, so no alias can slip past a
 * check that another alias already failed.
 */
const authorizedByCtx = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Exported for tests; the guard is the only production caller. */
export async function assertOncePerRequest(
  subgraph: BaseSubgraph,
  ctx: unknown,
  driveId: string,
  privileged: boolean,
): Promise<unknown> {
  const check = (): Promise<unknown> =>
    privileged
      ? subgraph.assertCanWrite(driveId, ctx as SubgraphContext)
      : subgraph.assertCanRead(driveId, ctx as SubgraphContext);

  if (typeof ctx !== "object" || ctx === null) return check();

  let perCtx = authorizedByCtx.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    authorizedByCtx.set(ctx, perCtx);
  }
  const key = `${privileged ? "write" : "read"}:${driveId}`;
  const cached = perCtx.get(key);
  if (cached) return cached;
  const pending = check();
  perCtx.set(key, pending);
  return pending;
}

function withDriveGuards<T extends Record<string, Resolver>>(
  subgraph: BaseSubgraph,
  resolvers: T,
): T {
  const out: Record<string, Resolver> = {};
  for (const [name, fn] of Object.entries(resolvers)) {
    const privileged = PRIVILEGED_RESOLVERS.has(name);
    out[name] = async (parent, args, ctx, info) => {
      const requested =
        typeof args.driveId === "string" ? args.driveId : undefined;

      if (requested === undefined) {
        // Nothing to scope the check to. A privileged resolver fails closed
        // rather than running unguarded.
        if (privileged) {
          // reactor-api's own ForbiddenError is not in its public type
          // surface, so mirror the wire shape clients already handle.
          throw new GraphQLError(`Forbidden: ${name} requires write access`, {
            extensions: { code: "FORBIDDEN" },
          });
        }
      } else {
        await assertOncePerRequest(subgraph, ctx, requested, privileged);
      }

      if (requested !== undefined) {
        const canonical = await resolveCanonicalDriveId(subgraph, requested);
        args = { ...args, driveId: canonical };
      }
      return fn(parent, args, ctx, info);
    };
  }
  return out as T;
}

/** Neighbours computed per search, then sliced per hit. Also the arg ceiling. */
const NEIGHBOUR_POOL = 25;
/** What a caller gets from `related` without asking for a size. */
const DEFAULT_RELATED_PER_HIT = 5;

export const getResolvers = (subgraph: BaseSubgraph): Record<string, unknown> => {
  return {
    SemanticResult: {
      /**
       * Per-hit neighbourhood. The parent resolver attaches a memoized loader
       * rather than the data, so selecting `related` on twenty hits still
       * costs the two queries it takes to read the whole neighbourhood once —
       * and selecting nothing costs none.
       */
      related: async (
        parent: {
          node?: { documentId?: string };
          _neighbourhood?: () => Promise<Neighbourhood>;
        },
        args: { limit?: number | null },
      ) => {
        const documentId = parent.node?.documentId;
        if (!parent._neighbourhood || !documentId) return [];
        const limit = Math.min(
          NEIGHBOUR_POOL,
          Math.max(0, args.limit ?? DEFAULT_RELATED_PER_HIT),
        );
        if (limit === 0) return [];
        const graph = await parent._neighbourhood();
        return (graph.byHit[documentId] ?? []).slice(0, limit);
      },

      /**
       * Edges to other hits in the same result set. Same memoized loader as
       * `related`, so selecting both is still the two queries the whole
       * search costs.
       */
      linkedHits: async (parent: {
        node?: { documentId?: string };
        _neighbourhood?: () => Promise<Neighbourhood>;
      }) => {
        const documentId = parent.node?.documentId;
        if (!parent._neighbourhood || !documentId) return [];
        const graph = await parent._neighbourhood();
        return graph.linksByHit[documentId] ?? [];
      },
    },

    KnowledgeGraphNode: {
      topics: async (parent: {
        documentId: string;
        topics?: string[];
        _driveId?: string;
      }) => {
        if (parent.topics) return parent.topics;
        if (parent._driveId) {
          const query = getQuery(subgraph, parent._driveId);
          return query.topicsForNode(parent.documentId);
        }
        return [];
      },
      // Degree fields are resolved per node on demand (one query each) so
      // the common list queries stay one round-trip; select them only when
      // you need them, as with `topics`.
      inDegree: async (parent: { documentId: string; _driveId?: string }) => {
        if (!parent._driveId) return 0;
        const query = getQuery(subgraph, parent._driveId);
        return query.knowledgeDegree(parent.documentId, "in");
      },
      outDegree: async (parent: { documentId: string; _driveId?: string }) => {
        if (!parent._driveId) return 0;
        const query = getQuery(subgraph, parent._driveId);
        return query.knowledgeDegree(parent.documentId, "out");
      },
    },

    Mutation: withDriveGuards(subgraph, {
      knowledgeGraphReindex: ((_: unknown, args: { driveId: string }) =>
        reindexDrive(subgraph, args.driveId)) as unknown as Resolver,
    }),

    Query: withDriveGuards(subgraph, {
      // --- Core graph queries ---
      //
      // NOTE: `ensureGraphDoc` is intentionally NOT called from read
      // paths. Empirically, calling it here causes subsequent reads of
      // graph_nodes/graph_edges to return 0 rows even when the data is
      // present (verified via knowledgeGraphDebug, which shows 375
      // rows in the same call sequence). Root cause not yet diagnosed,
      // but skipping ensure on reads is safe — the graph doc only
      // needs to exist if a writer (sync, mutation) needs it, and
      // reindex calls its own setup path that doesn't depend on it.

      knowledgeGraphNodes: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.allNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphEdges: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.allEdges();
      },

      knowledgeGraphStats: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.stats();
      },

      knowledgeGraphNodeByDocumentId: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const node = await query.nodeByDocumentId(args.documentId);
        return node ? { ...node, _driveId: args.driveId } : null;
      },

      knowledgeGraphOrphans: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.orphanNodes();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphConnections: async (
        _: unknown,
        args: { driveId: string; documentId: string; depth?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const connections = await query.connections(
          args.documentId,
          args.depth ?? 2,
        );
        return connections.map((c) => ({
          ...c,
          node: { ...c.node, _driveId: args.driveId },
        }));
      },

      knowledgeGraphNodesByStatus: async (
        _: unknown,
        args: { driveId: string; status: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByStatus(args.status);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphNodesByType: async (
        _: unknown,
        args: { driveId: string; documentType: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByDocumentType(args.documentType);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphBacklinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.backlinks(args.documentId);
      },

      knowledgeGraphDensity: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.density();
      },

      // --- Search queries ---

      knowledgeGraphSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number; includeArchived?: boolean | null },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.searchNodes(args.query, args.limit ?? 50, {
          includeArchived: args.includeArchived ?? false,
        });
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphTriangles: async (
        _: unknown,
        args: { driveId: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const triangles = await query.triangles(args.limit ?? 20);
        return triangles.map((t) => ({
          noteA: { ...t.a, _driveId: args.driveId },
          noteB: { ...t.b, _driveId: args.driveId },
          sharedTarget: { ...t.sharedTarget, _driveId: args.driveId },
        }));
      },

      knowledgeGraphBridges: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.bridges();
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphForwardLinks: async (
        _: unknown,
        args: { driveId: string; documentId: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.forwardLinks(args.documentId);
      },

      // --- Topic queries ---

      knowledgeGraphTopics: async (_: unknown, args: { driveId: string }) => {
        const query = getQuery(subgraph, args.driveId);
        return query.topicStats();
      },

      knowledgeGraphByTopic: async (
        _: unknown,
        args: { driveId: string; topic: string; includeArchived?: boolean | null },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByTopic(args.topic, {
          includeArchived: args.includeArchived ?? false,
        });
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRelatedByTopic: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number; includeArchived?: boolean | null },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const results = await query.relatedByTopic(
          args.documentId,
          args.limit ?? 10,
          { includeArchived: args.includeArchived ?? false },
        );
        return results.map((r) => ({
          ...r,
          node: { ...r.node, _driveId: args.driveId },
        }));
      },

      knowledgeGraphFullSearch: async (
        _: unknown,
        args: { driveId: string; query: string; limit?: number; includeArchived?: boolean | null },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.fullSearch(args.query, args.limit ?? 50, {
          includeArchived: args.includeArchived ?? false,
        });
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Provenance queries ---

      knowledgeGraphByAuthor: async (
        _: unknown,
        args: { driveId: string; author: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByAuthor(args.author);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphByOrigin: async (
        _: unknown,
        args: { driveId: string; origin: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.nodesByOrigin(args.origin);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      knowledgeGraphRecent: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.recentNodes(
          args.limit ?? 20,
          args.since ?? undefined,
        );
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Semantic search queries ---

      knowledgeGraphSimilar: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number; includeArchived?: boolean | null },
      ) => {
        const db = getDb(subgraph, args.driveId);
        const embedding = await getEmbedding(db, args.documentId);
        if (!embedding) return [];

        // Over-fetch: the source note itself and any archived neighbours
        // come back from the vector store and are filtered out here.
        const results = await searchSimilar(db, embedding, (args.limit ?? 10) * 2 + 1);
        const graphQuery = getQuery(subgraph, args.driveId);

        // One query for every candidate, not one per candidate. Ranking is
        // unchanged: `results` is already ordered by similarity and the loop
        // below still walks it in that order.
        const nodes = await graphQuery.nodesByDocumentIds(
          results
            .map((result) => result.documentId)
            .filter((documentId) => documentId !== args.documentId),
        );
        const semanticResults = [];
        for (const result of results) {
          if (result.documentId === args.documentId) continue;
          const node = nodes.get(result.documentId);
          if (node && (args.includeArchived || isCurrentNode(node))) {
            semanticResults.push({
              node: { ...node, _driveId: args.driveId },
              similarity: result.similarity,
              score: result.similarity,
              matchedBy: ["semantic"],
            });
          }
        }
        return semanticResults.slice(0, args.limit ?? 10);
      },

      knowledgeGraphSearchByEmbedding: async (
        _: unknown,
        args: {
          driveId: string;
          query: string;
          embedding: number[];
          mode: "SEMANTIC";
          limit?: number;
          includeArchived?: boolean | null;
        },
      ) => {
        return searchWithEmbedding(
          subgraph,
          args.driveId,
          args.query,
          args.embedding,
          args.mode,
          args.limit ?? 20,
          args.includeArchived ?? false,
        );
      },

      knowledgeGraphSemanticSearch: async (
        _: unknown,
        args: {
          driveId: string;
          query: string;
          mode?: "SEMANTIC" | null;
          limit?: number;
          includeArchived?: boolean | null;
        },
      ) => {
        const limit = args.limit ?? 20;
        const hits = await searchVault(
          subgraph,
          args.driveId,
          args.query,
          args.mode ?? "SEMANTIC",
          limit,
          args.includeArchived ?? false,
        );
        // Built at most once per search, and only if `related` is selected.
        let pending: Promise<Neighbourhood> | undefined;
        const loadNeighbourhood = (): Promise<Neighbourhood> => {
          pending ??= buildNeighbourhood(
            getQuery(subgraph, args.driveId),
            hits.map((hit) => ({
              documentId: String(hit.node.documentId),
              similarity: hit.similarity,
              node: hit.node,
            })),
            {
              limit: NEIGHBOUR_POOL,
              includeArchived: args.includeArchived ?? false,
            },
          );
          return pending;
        };
        return hits.map((hit) => ({
          ...hit,
          _neighbourhood: loadNeighbourhood,
        }));
      },

      knowledgeGraphMissingEmbeddings: async (
        _: unknown,
        args: { driveId: string },
      ) => {
        const graphQuery = getQuery(subgraph, args.driveId);
        return graphQuery.documentIdsWithoutEmbeddings();
      },

      // --- History queries ---

      knowledgeGraphHistory: async (
        _: unknown,
        args: { driveId: string; documentId: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.history(args.documentId, args.limit ?? 50);
      },

      knowledgeGraphActivity: async (
        _: unknown,
        args: { driveId: string; limit?: number; since?: string },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.activity(args.limit ?? 50, args.since ?? undefined);
      },

      knowledgeGraphActivityByType: async (
        _: unknown,
        args: { driveId: string; operationType: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        return query.activityByType(args.operationType, args.limit ?? 50);
      },

      knowledgeGraphStale: async (
        _: unknown,
        args: { driveId: string; since: string; limit?: number },
      ) => {
        const query = getQuery(subgraph, args.driveId);
        const nodes = await query.staleNodes(args.since, args.limit ?? 50);
        return nodes.map((n) => ({ ...n, _driveId: args.driveId }));
      },

      // --- Debug ---

      knowledgeGraphDebug: async (_: unknown, args: { driveId: string }) => {
        const namespace = GraphIndexerProcessor.getNamespace(args.driveId);
        try {
          const db = getDb(subgraph, args.driveId);
          const rawNodes = await db
            .selectFrom("graph_nodes")
            .selectAll()
            .execute();
          const rawEdges = await db
            .selectFrom("graph_edges")
            .selectAll()
            .execute();
          return {
            rawNodeCount: rawNodes.length,
            rawEdgeCount: rawEdges.length,
            rawNodes: rawNodes.map((r) => ({
              id: r.id,
              documentId: r.document_id,
              title: r.title,
              description: r.description,
              noteType: r.note_type,
              status: r.status,
              content: r.content,
              author: r.author,
              sourceOrigin: r.source_origin,
              createdAt: r.created_at,
              topics: [],
              updatedAt: r.updated_at,
              documentType: r.document_type,
              _driveId: args.driveId,
            })),
            rawEdges: rawEdges.map((r) => ({
              id: r.id,
              sourceDocumentId: r.source_document_id,
              targetDocumentId: r.target_document_id,
              linkType: r.link_type,
              targetTitle: r.target_title,
              updatedAt: r.updated_at,
            })),
            processorNamespace: namespace,
          };
        } catch (err: unknown) {
          console.warn(
            `[KnowledgeGraphSubgraph] Debug query failed for ${namespace}:`,
            err,
          );
          return {
            rawNodeCount: 0,
            rawEdgeCount: 0,
            rawNodes: [],
            rawEdges: [],
            processorNamespace: namespace,
          };
        }
      },
    } as unknown as Record<string, Resolver>),
  };
};
