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

    const db = await getWritableDb(subgraph, driveId);
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

        await db
          .insertInto("graph_nodes")
          .values({
            id: node.id,
            document_id: node.id,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            note_type: (global.noteType as string) ?? null,
            status: (global.status as string) ?? "DRAFT",
            content: (global.content as string) ?? null,
            author: provenance?.author ?? null,
            source_origin: provenance?.sourceOrigin ?? null,
            created_at: provenance?.createdAt ?? null,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column("document_id").doUpdateSet({
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              note_type: (global.noteType as string) ?? null,
              status: (global.status as string) ?? "DRAFT",
              content: (global.content as string) ?? null,
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

        // Reconcile edges
        await db
          .deleteFrom("graph_edges")
          .where("source_document_id", "=", node.id)
          .execute();

        const links = (global.links as Array<Record<string, unknown>>) ?? [];
        if (links.length > 0) {
          await db
            .insertInto("graph_edges")
            .values(
              links.map((link) => ({
                id:
                  (link.id as string) ??
                  `${node.id}-${link.targetDocumentId as string}`,
                source_document_id: node.id,
                target_document_id: (link.targetDocumentId as string) ?? "",
                link_type: (link.linkType as string) ?? null,
                target_title: (link.targetTitle as string) ?? null,
                updated_at: now,
              })),
            )
            .execute();
          indexedEdges += links.length;
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
