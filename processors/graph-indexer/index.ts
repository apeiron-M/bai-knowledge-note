import { RelationalDbProcessor } from "@powerhousedao/reactor-browser";
import type { OperationWithContext } from "document-model";
import { up } from "./migrations.js";
import type { DB } from "./schema.js";

/**
 * Graph Indexer Processor
 *
 * Watches bai/knowledge-note operations and maintains a relational index
 * of graph nodes (notes) and edges (links between notes).
 *
 * Uses the resultingState reconciliation pattern:
 * - Deduplicates operations per document (keeps last resulting state)
 * - Upserts node from full state
 * - Reconciles edges by deleting old + inserting new from state.links
 *
 * This keeps the graph in sync regardless of whether changes come from
 * the UI or the API.
 */
export class GraphIndexerProcessor extends RelationalDbProcessor<DB> {
  static override getNamespace(driveId: string): string {
    return super.getNamespace(driveId);
  }

  override async initAndUpgrade(): Promise<void> {
    await up(this.relationalDb);
  }

  async onOperations(operations: OperationWithContext[]): Promise<void> {
    if (operations.length === 0) return;

    // Deduplicate: keep the last operation per document
    const lastByDocument = new Map<string, OperationWithContext>();

    for (const entry of operations) {
      const { operation, context } = entry;
      const documentId = context.documentId;

      // Handle document deletion immediately
      if (operation.action.type === "DELETE_DOCUMENT") {
        await this.deleteNode(documentId);
        lastByDocument.delete(documentId);
        continue;
      }

      // Collect last state per document
      if (context.resultingState) {
        lastByDocument.set(documentId, entry);
      }
    }

    // Reconcile each changed document from its resulting state
    for (const [documentId, entry] of lastByDocument) {
      try {
        const stateJson = entry.context.resultingState;
        if (!stateJson) continue;

        const state = JSON.parse(stateJson) as {
          global: Record<string, unknown>;
        };
        const global = state.global;
        const now = new Date().toISOString();

        // Upsert node
        await this.relationalDb
          .insertInto("graph_nodes")
          .values({
            id: documentId,
            document_id: documentId,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            note_type: (global.noteType as string) ?? null,
            status: (global.status as string) ?? "DRAFT",
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column("document_id").doUpdateSet({
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              note_type: (global.noteType as string) ?? null,
              status: (global.status as string) ?? "DRAFT",
              updated_at: now,
            }),
          )
          .execute();

        // Reconcile edges: delete old, insert new
        await this.relationalDb
          .deleteFrom("graph_edges")
          .where("source_document_id", "=", documentId)
          .execute();

        const links =
          (global.links as Array<Record<string, unknown>>) ?? [];
        if (links.length > 0) {
          await this.relationalDb
            .insertInto("graph_edges")
            .values(
              links.map((link) => ({
                id:
                  (link.id as string) ??
                  `${documentId}-${link.targetDocumentId as string}`,
                source_document_id: documentId,
                target_document_id:
                  (link.targetDocumentId as string) ?? "",
                link_type: (link.linkType as string) ?? null,
                target_title: (link.targetTitle as string) ?? null,
                updated_at: now,
              })),
            )
            .execute();
        }
      } catch (err: unknown) {
        console.error(
          `[GraphIndexer] Error reconciling document ${documentId}:`,
          err,
        );
      }
    }
  }

  async onDisconnect(): Promise<void> {
    // Cleanup if needed
  }

  private async deleteNode(documentId: string): Promise<void> {
    try {
      await this.relationalDb
        .deleteFrom("graph_edges")
        .where((eb) =>
          eb.or([
            eb("source_document_id", "=", documentId),
            eb("target_document_id", "=", documentId),
          ]),
        )
        .execute();

      await this.relationalDb
        .deleteFrom("graph_nodes")
        .where("document_id", "=", documentId)
        .execute();
    } catch (err: unknown) {
      console.error(
        `[GraphIndexer] Error deleting node ${documentId}:`,
        err,
      );
    }
  }
}
