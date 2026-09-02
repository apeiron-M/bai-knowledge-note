/**
 * Reindex mutation: backfill the graph index by reading every indexed
 * document in the drive (see `processors/graph-indexer/project.ts` for the
 * list) and rebuilding its projection row, topics and edges.
 */
import type { Kysely } from "kysely";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { getWritableDb } from "./db.js";
import type { DB } from "../../../processors/graph-indexer/schema.js";
import {
  INDEXED_LINK_TYPE_LIST,
  KNOWLEDGE_LINK_TYPES,
} from "../../../processors/graph-indexer/link-types.js";
import {
  isIndexedDocumentType,
  projectNode,
} from "../../../processors/graph-indexer/project.js";
import {
  collectRelationshipIds,
  type RelationshipPage,
} from "./relationship-paging.js";
import {
  documentIndexerOf,
  readIncomingMetadata,
  readOutgoingMetadata,
} from "./edge-metadata-reader.js";

// Source-of-truth for edges since the drive-override migration. ADD_LINK /
// ADD_CORE_IDEA / ADD_CHILD_MOC are gone; edges live in the reactor's
// `DocumentRelationship` table, populated via ADD_RELATIONSHIP system
// actions. We have to fan out per type because `getOutgoingRelationships`
// requires a specific `relationshipType` arg.
type RecoveredEdge = {
  id: string;
  source_document_id: string;
  target_document_id: string;
  link_type: string | null;
  target_title: string | null;
  updated_at: string;
  metadata: string | null;
};

/**
 * Drop rows that are not indexed edges — in practice the reactor's
 * drive→document `child` containment relationships, which the processor
 * mirrored into `graph_edges` before it learned to filter them out.
 *
 * A reindex is a full rebuild of the drive's projection, so it is the right
 * place to clear that debt: the analytics queries filter these rows out
 * anyway, but leaving them makes `knowledgeGraphDebug` and any direct SQL
 * misleading, and they are pure dead weight (their source is the drive, which
 * never has a `graph_nodes` row, so they dangle by construction).
 *
 * Keeps knowledge edges AND the derived `INVOLVES` / `PROMOTED_TO` rows the
 * indexer reconciles from tension/observation state — those are the
 * projection's own, not reactor bookkeeping. NULL `link_type` is pruned,
 * matching `isIndexedLinkType` — an untyped relationship is not a knowledge
 * link. Written as `is null or not in (...)` because a bare `not in` never
 * matches a NULL.
 *
 * Returns the number of rows removed.
 */
export async function pruneNonKnowledgeEdges(db: Kysely<DB>): Promise<number> {
  const result = await db
    .deleteFrom("graph_edges")
    .where((eb) =>
      eb.or([
        eb("link_type", "is", null),
        eb.not(eb("link_type", "in", INDEXED_LINK_TYPE_LIST)),
      ]),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export async function reindexDrive(
  subgraph: ISubgraph,
  driveId: string,
): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }> {
  const errors: string[] = [];
  let indexedNodes = 0;
  let indexedEdges = 0;
  // Relationship types whose outgoing read hit the upstream 100-row cap
  // for at least one document. Populated in pass 1, consumed by pass 2.
  const saturatedTypes = new Set<string>();
  // Edge ids written by pass 1, so pass 2 counts only what pass 1 could
  // not reach — a target-side read re-derives edges pass 1 already wrote.
  const writtenEdgeIds = new Set<string>();
  // Edge metadata (the articulation) the projection already held before
  // pass 1 deleted the rows. The fallback when the reactor's relationship
  // rows cannot be read from here — a reindex must never erase a reason.
  const preservedMetadata = new Map<string, string>();
  // The reactor's document indexer, when this is the in-process client.
  // It is the only place relationship metadata can be read from.
  const indexer = documentIndexerOf(subgraph.reactorClient);

  try {
    const drive = await subgraph.reactorClient.get(driveId);
    // Resolve to the drive's canonical UUID. reactorClient.get accepts either
    // slug or UUID, but the processor's per-drive namespace was created by
    // the factory using `driveHeader.id` (always UUID). If the caller passed a
    // slug, we must align here before any namespace operation, otherwise we
    // hit `relation "<ns>.graph_nodes" does not exist`.
    const canonicalDriveId =
      (drive as unknown as { header?: { id?: string }; id?: string }).header
        ?.id ??
      (drive as unknown as { id?: string }).id ??
      driveId;
    const nodes = (
      drive.state as unknown as {
        global: {
          nodes: Array<{
            kind: string;
            documentType?: string;
            id: string;
          }>;
        };
      }
    ).global.nodes;

    const noteNodes = nodes.filter(
      (n) => n.kind === "file" && isIndexedDocumentType(n.documentType),
    );

    const db = await getWritableDb(subgraph, canonicalDriveId);
    const now = new Date().toISOString();

    for (const node of noteNodes) {
      try {
        const doc = await subgraph.reactorClient.get(node.id);
        const state = doc.state as unknown as {
          global: Record<string, unknown>;
        };
        const global = state.global;

        // Mirror the processor: `updated_at` is the DOCUMENT's modification
        // time, never the indexer's wall clock. Stamping `now` here is what
        // flattened all 1,502 nodes to a single instant on every reindex,
        // which silently broke `knowledgeGraphRecent` and STALE_NOTES.
        const documentUpdatedAt =
          (doc as unknown as { header?: { lastModifiedAtUtcIso?: string } })
            .header?.lastModifiedAtUtcIso ?? now;

        // One projection for every kind, shared with the live processor
        // (processors/graph-indexer/project.ts) so reindexed and
        // live-indexed rows are identical.
        const documentType = node.documentType;
        if (!isIndexedDocumentType(documentType)) continue;
        const { topics, derivedEdges, ...row } = projectNode(
          documentType,
          global,
        );

        await db
          .insertInto("graph_nodes")
          .values({
            id: node.id,
            document_id: node.id,
            ...row,
            updated_at: documentUpdatedAt,
          })
          .onConflict((oc) =>
            oc.column("document_id").doUpdateSet({
              ...row,
              updated_at: documentUpdatedAt,
            }),
          )
          .execute();
        indexedNodes++;

        // Reconcile topics
        await db
          .deleteFrom("graph_topics")
          .where("document_id", "=", node.id)
          .execute();

        if (topics.length > 0) {
          await db
            .insertInto("graph_topics")
            .values(
              topics.map((name, idx) => ({
                id: `${node.id}-topic-${idx}`,
                document_id: node.id,
                name,
                updated_at: documentUpdatedAt,
              })),
            )
            .execute();
        }

        // Reconcile edges from the reactor's DocumentRelationship table
        // (the source of truth since the drive-override migration). Each
        // ADD_RELATIONSHIP system action writes one row there; the
        // processor's onOperations mirrors those events into graph_edges,
        // but for a backfill we need to read existing rows directly. The
        // GraphQL field requires a specific `relationshipType`, so we fan
        // out per known type.
        const existing = await db
          .selectFrom("graph_edges")
          .select(["id", "metadata"])
          .where("source_document_id", "=", node.id)
          .where("metadata", "is not", null)
          .execute();
        for (const row of existing) {
          if (row.metadata) preservedMetadata.set(row.id, row.metadata);
        }
        let freshMetadata = new Map<string, string>();
        if (indexer) {
          try {
            freshMetadata = await readOutgoingMetadata(
              indexer,
              node.id,
              KNOWLEDGE_LINK_TYPES,
            );
          } catch (err) {
            errors.push(
              `${node.id}: relationship metadata unreadable (${err instanceof Error ? err.message : String(err)}); kept existing`,
            );
          }
        }
        const metadataFor = (id: string) =>
          freshMetadata.get(id) ?? preservedMetadata.get(id) ?? null;

        await db
          .deleteFrom("graph_edges")
          .where("source_document_id", "=", node.id)
          .execute();

        const edgeValues = new Map<string, RecoveredEdge>();

        // Derived edges come from the document's own state, not from the
        // relationship table — the same reconciliation the processor does.
        for (const e of derivedEdges) {
          const id = `${node.id}-${e.targetId}-${e.linkType}`;
          edgeValues.set(id, {
            id,
            source_document_id: node.id,
            target_document_id: e.targetId,
            link_type: e.linkType,
            target_title: null,
            updated_at: documentUpdatedAt,
            metadata: null,
          });
        }

        // Fan out over exactly the knowledge types the projection indexes —
        // one definition, shared with the processor's write path and the
        // analytics queries (processors/graph-indexer/link-types.ts).
        for (const relType of KNOWLEDGE_LINK_TYPES) {
          try {
            const { ids, saturated, truncated, pages } =
              await collectRelationshipIds((paging) =>
                subgraph.reactorClient.getOutgoingRelationships(
                  node.id,
                  relType,
                  undefined,
                  paging,
                ) as unknown as Promise<RelationshipPage>,
              );
            if (truncated) {
              errors.push(
                `${node.id}/${relType}: read stopped after ${pages} pages; edges may be incomplete`,
              );
            }
            // The upstream client caps outgoing reads at 100 with no way
            // to page past it, so a saturated result means this document
            // has more edges of this type than we can see from here.
            // Record the type; a second pass re-derives it from the
            // target side, where the fan-out is small.
            if (saturated) saturatedTypes.add(relType);
            for (const targetId of ids) {
              const id = `${node.id}-${targetId}-${relType}`;
              edgeValues.set(id, {
                id,
                source_document_id: node.id,
                target_document_id: targetId,
                link_type: relType,
                target_title: null,
                updated_at: now,
                metadata: metadataFor(id),
              });
            }
          } catch {
            // Some relationship types may not be indexed for this doc —
            // ignore per-type errors and keep going.
          }
        }

        if (edgeValues.size > 0) {
          await db
            .insertInto("graph_edges")
            .values([...edgeValues.values()])
            .onConflict((oc) =>
              oc.column("id").doUpdateSet({
                link_type: (eb) => eb.ref("excluded.link_type"),
                updated_at: (eb) => eb.ref("excluded.updated_at"),
                metadata: (eb) => eb.ref("excluded.metadata"),
              }),
            )
            .execute();
          for (const id of edgeValues.keys()) writtenEdgeIds.add(id);
          indexedEdges += edgeValues.size;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${node.id}: ${msg}`);
      }
    }

    // ── Pass 2: recover edges the outgoing cap hid ──────────────────
    //
    // Only runs for relationship types actually observed to saturate, so
    // a drive with no oversized fan-out pays nothing for this. An edge
    // is the same row from either end, and the directions have very
    // different fan-out: a MoC may have 430 outgoing CORE_IDEA edges
    // while each note has at most a handful incoming.
    //
    // This must run after the loop above, because that loop deletes each
    // document's edges before rewriting them — edges added here would be
    // deleted again if a later iteration owned the same source.
    if (saturatedTypes.size > 0) {
      const indexedIds = new Set(noteNodes.map((n) => n.id));
      const recovered = new Map<string, RecoveredEdge>();

      for (const node of noteNodes) {
        // Target-side metadata for this node, one walk for all saturated
        // types; falls back to what pass 1 preserved.
        let incomingMetadata = new Map<string, string>();
        if (indexer) {
          try {
            incomingMetadata = await readIncomingMetadata(
              indexer,
              node.id,
              [...saturatedTypes],
            );
          } catch {
            // preserved metadata below still applies
          }
        }
        for (const relType of saturatedTypes) {
          try {
            const { ids, saturated } = await collectRelationshipIds(
              (paging) =>
                subgraph.reactorClient.getIncomingRelationships(
                  node.id,
                  relType,
                  undefined,
                  paging,
                ) as unknown as Promise<RelationshipPage>,
            );
            // Both endpoints over the cap is the one case this cannot
            // resolve. Report it rather than silently under-reporting.
            if (saturated) {
              errors.push(
                `${node.id}/${relType}: incoming read also saturated; some edges may be missing`,
              );
            }
            for (const sourceId of ids) {
              // Keep the edge set closed over indexed nodes, matching
              // pass 1 — an edge from a document with no graph_nodes row
              // would dangle.
              if (!indexedIds.has(sourceId)) continue;
              const id = `${sourceId}-${node.id}-${relType}`;
              recovered.set(id, {
                id,
                source_document_id: sourceId,
                target_document_id: node.id,
                link_type: relType,
                target_title: null,
                updated_at: now,
                metadata:
                  incomingMetadata.get(id) ?? preservedMetadata.get(id) ?? null,
              });
            }
          } catch {
            // Missing index for a (doc, type) pair is not an error.
          }
        }
      }

      if (recovered.size > 0) {
        const rows = [...recovered.values()];
        for (let i = 0; i < rows.length; i += 500) {
          await db
            .insertInto("graph_edges")
            .values(rows.slice(i, i + 500))
            .onConflict((oc) =>
              oc.column("id").doUpdateSet({
                link_type: (eb) => eb.ref("excluded.link_type"),
                updated_at: (eb) => eb.ref("excluded.updated_at"),
                // Pass 1 may have written this row with metadata already;
                // never replace a reason with nothing.
                metadata: (eb) =>
                  eb.fn.coalesce("excluded.metadata", "graph_edges.metadata"),
              }),
            )
            .execute();
        }
        // Pass 1 already counted everything it could see, so only the
        // rows it could not reach are new.
        for (const id of recovered.keys()) {
          if (!writtenEdgeIds.has(id)) indexedEdges += 1;
        }
        console.log(
          `[KnowledgeGraphSubgraph] Reindex pass 2 recovered edges for saturated types: ${[...saturatedTypes].join(", ")}`,
        );
      }
    }

    // ── Prune documents that have left the drive ────────────────────
    //
    // `deleteDocument` removes the document and its drive node but leaves
    // the projection's `graph_nodes` row behind, so a deleted note keeps
    // showing up — titleless — in `knowledgeGraphOrphans` forever. A
    // reindex is a full rebuild of this drive's projection, so it is the
    // right place to drop rows whose document is gone.
    //
    // Edges are pruned by endpoint — any row where a *stale* node is either
    // end. (A blanket "delete everything whose source isn't a live note"
    // would reach the same rows here, but scoping it to stale endpoints keeps
    // the delete proportional to what actually changed.) Non-knowledge rows
    // are handled separately by `pruneNonKnowledgeEdges` below.
    try {
      const liveIds = new Set(noteNodes.map((n) => n.id));
      const existing = await db
        .selectFrom("graph_nodes")
        .select("document_id")
        .execute();
      const staleIds = existing
        .map((r) => r.document_id)
        .filter((id): id is string => Boolean(id) && !liveIds.has(id));

      if (staleIds.length > 0) {
        for (let i = 0; i < staleIds.length; i += 500) {
          const batch = staleIds.slice(i, i + 500);
          await db
            .deleteFrom("graph_edges")
            .where((eb) =>
              eb.or([
                eb("source_document_id", "in", batch),
                eb("target_document_id", "in", batch),
              ]),
            )
            .execute();
          await db
            .deleteFrom("graph_nodes")
            .where("document_id", "in", batch)
            .execute();
        }
        console.log(
          `[KnowledgeGraphSubgraph] Reindex pruned ${staleIds.length} node(s) no longer in the drive`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`prune: ${msg}`);
    }

    // ── Prune non-knowledge (containment) edges ─────────────────────
    try {
      const removed = await pruneNonKnowledgeEdges(db);
      if (removed > 0) {
        console.log(
          `[KnowledgeGraphSubgraph] Reindex pruned ${removed} non-knowledge edge(s) (reactor containment)`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`prune-containment: ${msg}`);
    }

    console.log(
      `[KnowledgeGraphSubgraph] Reindex complete: ${indexedNodes} nodes, ${indexedEdges} edges, ${errors.length} errors`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Drive read failed: ${msg}`);
  }

  return { indexedNodes, indexedEdges, errors };
}
