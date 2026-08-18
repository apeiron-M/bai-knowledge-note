/**
 * The canonical set of KNOWLEDGE relationship types — the single source of
 * truth for "is this edge part of the knowledge graph?".
 *
 * ## Why this exists
 *
 * Since the drive-override migration, edges are no longer derived from note
 * state; they come from the reactor's `ADD_RELATIONSHIP` system actions and
 * land in the `DocumentRelationship` table. But the reactor uses that same
 * mechanism for its own **containment** bookkeeping: adding a document to a
 * drive emits `ADD_RELATIONSHIP(drive, document, "child")`.
 *
 * The processor used to mirror *every* relationship type into `graph_edges`,
 * so the projection carried one `child` edge from the drive to every single
 * document. That is not a link a human ever authored, and it silently
 * corrupted every edge-derived metric:
 *
 *   - orphan detection became structurally impossible — the drive has an
 *     incoming-edge to everything, so `orphanCount` was a hard 0;
 *   - `edgeCount` / `density` were inflated by ~20% on the live vault
 *     (1,530 containment rows against 7,562 real links);
 *   - `triangles()` proposed synthesising the *drive* with a MoC;
 *   - `bridges()` saw a single component whose only articulation point was
 *     the drive;
 *   - a note's `backlinks` list showed a phantom backlink from the drive.
 *
 * Containment is not lost by excluding it: the drive tree is authoritative
 * in the drive document's own `state.global.nodes`, which is what both the
 * reindexer and the Connect editors already read for drive membership.
 *
 * ## Allowlist, deliberately
 *
 * This is an allowlist, not a `!== "child"` denylist, so any future reactor
 * bookkeeping type is excluded automatically. The cost is that a genuinely
 * new *knowledge* type must be added HERE — one place — to be indexed and
 * counted.
 *
 * ## Null handling
 *
 * `graph_edges.link_type` is nullable (`relationshipType ?? null`), and an
 * untyped relationship is treated as NOT a knowledge edge: every knowledge
 * link the vault creates carries an explicit type, so an absent type means
 * the relationship came from somewhere else. Consequently the SQL filters
 * are written as `link_type in (...)` / `not exists (...)`, both of which
 * are null-safe, rather than a `link_type <> 'child'` comparison (NULL) or
 * a `not in (subquery)` (which returns *no rows at all* in Postgres as soon
 * as the subquery yields a single NULL).
 */
export const KNOWLEDGE_LINK_TYPES = [
  "RELATES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "SUPERSEDES",
  "DERIVED_FROM",
  "CORE_IDEA",
  "CHILD_MOC",
] as const;

export type KnowledgeLinkType = (typeof KNOWLEDGE_LINK_TYPES)[number];

/**
 * Mutable copy for SQL `in (...)` bindings — Kysely's value list wants a
 * plain array, and callers must not be able to mutate the canonical tuple.
 */
export const KNOWLEDGE_LINK_TYPE_LIST: string[] = [...KNOWLEDGE_LINK_TYPES];

const KNOWLEDGE_LINK_TYPE_SET: ReadonlySet<string> = new Set<string>(
  KNOWLEDGE_LINK_TYPES,
);

/**
 * True when `linkType` is one of the canonical knowledge relationship types.
 * `null` / `undefined` / reactor bookkeeping types (`child`, ...) are false.
 */
export function isKnowledgeLinkType(
  linkType: string | null | undefined,
): linkType is KnowledgeLinkType {
  return linkType != null && KNOWLEDGE_LINK_TYPE_SET.has(linkType);
}
