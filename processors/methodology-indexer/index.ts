import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "./migrations.js";
import type { MethodologyDB } from "./schema.js";

export class MethodologyIndexerProcessor extends RelationalDbProcessor<MethodologyDB> {
  static override getNamespace(driveId: string): string {
    return super.getNamespace(driveId);
  }

  override async initAndUpgrade(): Promise<void> {
    await up(this.relationalDb);
  }

  override async onOperations(
    operations: OperationWithContext[],
  ): Promise<void> {
    if (operations.length === 0) return;

    const lastByDocument = new Map<string, OperationWithContext>();

    for (const entry of operations) {
      const { operation, context } = entry;
      const documentId = context.documentId;

      // Handle deletion from drive
      if (
        context.documentType === "powerhouse/document-drive" &&
        operation.action.type === "DELETE_NODE"
      ) {
        const deleteInput = operation.action.input as { id: string };
        await this.deleteClaim(deleteInput.id);
        lastByDocument.delete(deleteInput.id);
        continue;
      }

      // Only process research-claim documents
      if (context.documentType !== "bai/research-claim") continue;

      if (context.resultingState) {
        lastByDocument.set(documentId, entry);
      }
    }

    for (const [documentId, entry] of lastByDocument) {
      try {
        const stateJson = entry.context.resultingState;
        if (!stateJson) continue;

        const parsed = JSON.parse(stateJson);
        const global = (parsed.global ?? parsed) as Record<string, unknown>;
        const now = new Date().toISOString();

        // Upsert claim
        const topics = (global.topics as string[]) ?? [];
        const methodology = (global.methodology as string[]) ?? [];

        await this.relationalDb
          .insertInto("methodology_claims")
          .values({
            id: documentId,
            document_id: documentId,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            kind: (global.kind as string) ?? null,
            topics: JSON.stringify(topics),
            methodology: JSON.stringify(methodology),
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column("document_id").doUpdateSet({
              title: (global.title as string) ?? null,
              description: (global.description as string) ?? null,
              kind: (global.kind as string) ?? null,
              topics: JSON.stringify(topics),
              methodology: JSON.stringify(methodology),
              updated_at: now,
            }),
          )
          .execute();

        // Reconcile connections
        await this.relationalDb
          .deleteFrom("methodology_connections")
          .where("source_document_id", "=", documentId)
          .execute();

        const connections =
          (global.connections as Array<Record<string, unknown>>) ?? [];
        if (connections.length > 0) {
          await this.relationalDb
            .insertInto("methodology_connections")
            .values(
              connections.map((conn) => ({
                id:
                  (conn.id as string) ??
                  `${documentId}-${conn.targetRef as string}`,
                source_document_id: documentId,
                target_ref: (conn.targetRef as string) ?? "",
                context_phrase: (conn.contextPhrase as string) ?? null,
                updated_at: now,
              })),
            )
            .execute();
        }

        console.log(
          `[MethodologyIndexer] Reconciled ${documentId}: ${connections.length} connections`,
        );
      } catch (err: unknown) {
        console.error(
          `[MethodologyIndexer] Error reconciling ${documentId}:`,
          err,
        );
      }
    }
  }

  async onDisconnect(): Promise<void> {
    try {
      await this.relationalDb
        .deleteFrom("methodology_connections")
        .execute();
      await this.relationalDb.deleteFrom("methodology_claims").execute();
      console.log(
        `[MethodologyIndexer] Cleaned up namespace: ${this.namespace}`,
      );
    } catch (err: unknown) {
      console.error(`[MethodologyIndexer] Error cleaning up:`, err);
    }
  }

  private async deleteClaim(documentId: string): Promise<void> {
    try {
      await this.relationalDb
        .deleteFrom("methodology_connections")
        .where("source_document_id", "=", documentId)
        .execute();
      await this.relationalDb
        .deleteFrom("methodology_claims")
        .where("document_id", "=", documentId)
        .execute();
      console.log(`[MethodologyIndexer] Deleted claim ${documentId}`);
    } catch (err: unknown) {
      console.error(
        `[MethodologyIndexer] Error deleting claim ${documentId}:`,
        err,
      );
    }
  }
}
