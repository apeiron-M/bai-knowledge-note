/**
 * Reindex mutation: backfill the graph index by reading all bai/knowledge-note
 * and bai/moc documents in the drive.
 */
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { getWritableDb } from "./db.js";
import { generateEmbedding } from "../../../processors/graph-indexer/embedder.js";
import { upsertEmbedding } from "../../../processors/graph-indexer/embedding-store.js";

export async function reindexDrive(
  subgraph: ISubgraph,
  driveId: string,
): Promise<{ indexedNodes: number; indexedEdges: number; errors: string[] }> {
  const errors: string[] = [];
  let indexedNodes = 0;
  let indexedEdges = 0;

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
      (n) =>
        n.kind === "file" &&
        (n.documentType === "bai/knowledge-note" ||
          n.documentType === "bai/moc"),
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

        const provenance = global.provenance as
          | {
              author?: string;
              sourceOrigin?: string;
              createdAt?: string;
            }
          | undefined;

        // MoCs have `tier` (HUB/DOMAIN/TOPIC) and no `noteType` field;
        // notes have `noteType` and no `tier`. Tag the projection's
        // `note_type` accordingly so the frontend filter
        // (`noteType.startsWith("MOC (")`) sees them. This mirrors
        // the per-op processor logic in
        // processors/graph-indexer/index.ts so reindexed and
        // live-indexed rows look identical.
        const isMoc = node.documentType === "bai/moc";
        const noteType = isMoc
          ? `MOC (${(global.tier as string) ?? "TOPIC"})`
          : ((global.noteType as string) ?? null);
        const content = isMoc
          ? ((global.orientation as string) ?? null)
          : ((global.content as string) ?? null);
        const status = isMoc ? "MOC" : ((global.status as string) ?? "DRAFT");

        await db
          .insertInto("graph_nodes")
          .values({
            id: node.id,
            document_id: node.id,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            note_type: noteType,
            status,
            content,
            author: provenance?.author ?? null,
            source_origin: provenance?.sourceOrigin ?? null,
            created_at: provenance?.createdAt ?? null,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column("document_id").doUpdateSet({
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              note_type: noteType,
              status,
              content,
              author: provenance?.author ?? null,
              source_origin: provenance?.sourceOrigin ?? null,
              created_at: provenance?.createdAt ?? null,
              updated_at: now,
            }),
          )
          .execute();
        indexedNodes++;

        // Reconcile topics
        await db
          .deleteFrom("graph_topics")
          .where("document_id", "=", node.id)
          .execute();

        const topics =
          (global.topics as Array<string | Record<string, unknown>>) ?? [];
        if (topics.length > 0) {
          await db
            .insertInto("graph_topics")
            .values(
              topics.map((topic, idx) => {
                const name =
                  typeof topic === "string"
                    ? topic
                    : ((topic.name as string) ?? "");
                return {
                  id: `${node.id}-topic-${idx}`,
                  document_id: node.id,
                  name,
                  updated_at: now,
                };
              }),
            )
            .execute();
        }

        // Reconcile edges. For MoCs the edge sources are
        // global.coreIdeas (note targets) and global.childRefs (child
        // MoC targets), both keyed `linkType: "CORE_IDEA"` to match
        // the per-op processor's tagging. Notes use global.links.
        await db
          .deleteFrom("graph_edges")
          .where("source_document_id", "=", node.id)
          .execute();

        const edgeValues: Array<{
          id: string;
          source_document_id: string;
          target_document_id: string;
          link_type: string | null;
          target_title: string | null;
          updated_at: string;
        }> = [];

        if (isMoc) {
          const coreIdeas =
            (global.coreIdeas as Array<Record<string, unknown>>) ?? [];
          for (const idea of coreIdeas) {
            if (idea.noteRef) {
              edgeValues.push({
                id: `${node.id}-ci-${(idea.id as string) ?? (idea.noteRef as string)}`,
                source_document_id: node.id,
                target_document_id: idea.noteRef as string,
                link_type: "CORE_IDEA",
                target_title: null,
                updated_at: now,
              });
            }
          }
          const childRefs = (global.childRefs as string[]) ?? [];
          for (const ref of childRefs) {
            edgeValues.push({
              id: `${node.id}-child-${ref}`,
              source_document_id: node.id,
              target_document_id: ref,
              link_type: "CORE_IDEA",
              target_title: null,
              updated_at: now,
            });
          }
        } else {
          const links =
            (global.links as Array<Record<string, unknown>>) ?? [];
          for (const link of links) {
            edgeValues.push({
              id:
                (link.id as string) ??
                `${node.id}-${link.targetDocumentId as string}`,
              source_document_id: node.id,
              target_document_id: (link.targetDocumentId as string) ?? "",
              link_type: (link.linkType as string) ?? null,
              target_title: (link.targetTitle as string) ?? null,
              updated_at: now,
            });
          }
        }

        if (edgeValues.length > 0) {
          await db.insertInto("graph_edges").values(edgeValues).execute();
          indexedEdges += edgeValues.length;
        }

        // Generate embedding for semantic search
        const text = [global.title, global.description, global.content]
          .filter(Boolean)
          .join(" ");
        if (text.length > 0) {
          try {
            const emb = await generateEmbedding(text);
            await upsertEmbedding(node.id, emb);
          } catch (embErr: unknown) {
            console.warn(
              `[KnowledgeGraphSubgraph] Embedding failed for ${node.id}:`,
              embErr,
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${node.id}: ${msg}`);
      }
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
