import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "./migrations.js";
import type { DB } from "./schema.js";
import { deleteEmbedding } from "./embedding-store.js";

function summarizeOperation(
  type: string,
  input: Record<string, unknown>,
): string {
  switch (type) {
    case "SET_TITLE":
      return `Title changed to "${truncate(input.title)}"`;
    case "SET_DESCRIPTION":
      return `Description updated`;
    case "SET_CONTENT": {
      const len = typeof input.content === "string" ? input.content.length : 0;
      return `Content updated (${len} chars)`;
    }
    case "SET_NOTE_TYPE":
      return `Type set to ${String(input.noteType)}`;
    case "SET_STATUS":
      return `Status changed to ${String(input.status)}`;
    case "ADD_LINK":
      return `Linked to "${truncate(input.targetTitle)}" (${s(input.linkType, "RELATES_TO")})`;
    case "REMOVE_LINK":
      return `Removed link ${s(input.id)}`;
    case "UPDATE_LINK_TYPE":
      return `Link type changed to ${s(input.linkType)}`;
    case "ADD_TOPIC":
      return `Added topic #${s(input.name)}`;
    case "REMOVE_TOPIC":
      return `Removed topic`;
    case "SET_PROVENANCE":
      return `Provenance set: ${s(input.author, "unknown")}, ${s(input.sourceOrigin)}`;
    case "SUBMIT_FOR_REVIEW":
      return `Submitted for review`;
    case "APPROVE_NOTE":
      return `Approved by ${s(input.actor, "unknown")}`;
    case "REJECT_NOTE":
      return `Rejected: ${truncate(input.comment)}`;
    case "ARCHIVE_NOTE":
      return `Archived`;
    case "RESTORE_NOTE":
      return `Restored from archive`;
    case "SET_METADATA_FIELD":
      return `Metadata: ${String(input.field)} = ${truncate(input.value)}`;
    default:
      return type;
  }
}

/** Safely stringify an unknown value with optional fallback */
function s(val: unknown, fallback = ""): string {
  if (val == null) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function truncate(val: unknown, max = 60): string {
  const str = s(val);
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export class GraphIndexerProcessor extends RelationalDbProcessor<DB> {
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

    // Deduplicate: keep the last GLOBAL-scope op per document for state
    // reconciliation. Document-scope ops (ADD_RELATIONSHIP / REMOVE_RELATIONSHIP)
    // are applied individually as they arrive — edges aren't a reduction
    // of doc state.
    const lastByDocument = new Map<string, OperationWithContext>();

    for (const entry of operations) {
      const { operation, context } = entry;
      const documentId = context.documentId;

      // Handle reactor-native relationship system actions first. These
      // fire in `document` scope on the SOURCE document of the edge and
      // are the sole source-of-truth for graph_edges now that note/moc
      // state no longer carries inline links.
      if (operation.action.type === "ADD_RELATIONSHIP") {
        await this.applyAddRelationship(operation.action.input as {
          sourceId: string;
          targetId: string;
          relationshipType?: string;
        });
        continue;
      }
      if (operation.action.type === "REMOVE_RELATIONSHIP") {
        await this.applyRemoveRelationship(operation.action.input as {
          sourceId: string;
          targetId: string;
          relationshipType?: string;
        });
        continue;
      }

      // Handle document/drive deletion
      if (
        context.documentType === "powerhouse/document-drive" &&
        operation.action.type === "DELETE_NODE"
      ) {
        const deleteInput = operation.action.input as { id: string };
        await this.deleteNode(deleteInput.id);
        lastByDocument.delete(deleteInput.id);
        continue;
      }

      // Only process knowledge-note and moc documents for state reconciliation
      if (
        context.documentType !== "bai/knowledge-note" &&
        context.documentType !== "bai/moc"
      )
        continue;

      // Index operation for history tracking
      try {
        const input = operation.action.input as Record<string, unknown>;
        const signer = operation.action.context?.signer as
          | {
              user?: { address?: string };
              app?: { name?: string };
            }
          | undefined;
        await this.relationalDb
          .insertInto("graph_operations")
          .values({
            id: `${documentId}-${operation.index}`,
            document_id: documentId,
            operation_type: operation.action.type,
            timestamp: operation.timestampUtcMs ?? new Date().toISOString(),
            index: operation.index,
            scope: context.scope ?? "global",
            summary: summarizeOperation(operation.action.type, input),
            input_json: JSON.stringify(input),
            signer_address: signer?.user?.address || null,
            signer_app: signer?.app?.name || null,
          })
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      } catch {
        // non-critical — don't block state reconciliation
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

        const parsed = JSON.parse(stateJson) as {
          global?: Record<string, unknown>;
        };
        const global = (parsed.global ?? parsed) as Record<string, unknown>;
        const now = new Date().toISOString();
        const isMoc = entry.context.documentType === "bai/moc";

        // Extract provenance (knowledge notes only)
        const provenance = global.provenance as
          | {
              author?: string;
              sourceOrigin?: string;
              createdAt?: string;
            }
          | undefined;

        // Map fields based on document type
        const noteType = isMoc
          ? `MOC (${s(global.tier, "TOPIC")})`
          : ((global.noteType as string) ?? null);
        const content = isMoc
          ? ((global.orientation as string) ?? null)
          : ((global.content as string) ?? null);
        const status = isMoc ? "MOC" : ((global.status as string) ?? "DRAFT");

        // Upsert node
        await this.relationalDb
          .insertInto("graph_nodes")
          .values({
            id: documentId,
            document_id: documentId,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            note_type: noteType,
            status,
            content,
            author: provenance?.author ?? null,
            source_origin: provenance?.sourceOrigin ?? null,
            created_at:
              (global.createdAt as string) ?? provenance?.createdAt ?? null,
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
              created_at:
                (global.createdAt as string) ?? provenance?.createdAt ?? null,
              updated_at: now,
            }),
          )
          .execute();

        // Reconcile topics: delete old, insert new
        await this.relationalDb
          .deleteFrom("graph_topics")
          .where("document_id", "=", documentId)
          .execute();

        const topics =
          (global.topics as Array<string | Record<string, unknown>>) ?? [];
        if (topics.length > 0) {
          await this.relationalDb
            .insertInto("graph_topics")
            .values(
              topics.map((topic, idx) => {
                const name =
                  typeof topic === "string"
                    ? topic
                    : ((topic.name as string) ?? "");
                return {
                  id: `${documentId}-topic-${idx}`,
                  document_id: documentId,
                  name,
                  updated_at: now,
                };
              }),
            )
            .execute();
        }

        // Edges are NOT reconciled from doc state anymore — they live in
        // the reactor's DocumentRelationship table, populated via
        // ADD_RELATIONSHIP / REMOVE_RELATIONSHIP and mirrored into
        // graph_edges by `applyAddRelationship` / `applyRemoveRelationship`.
      } catch (err: unknown) {
        console.error(
          `[GraphIndexer] Error reconciling document ${documentId}:`,
          err,
        );
      }
    }
  }

  /**
   * Mirror an ADD_RELATIONSHIP event into `graph_edges`. Backfills the
   * `target_title` from `graph_nodes` if the target is already indexed;
   * otherwise leaves it null (rendering falls back to the target's slug
   * until the target's own state reconciles).
   */
  private async applyAddRelationship(input: {
    sourceId: string;
    targetId: string;
    relationshipType?: string;
  }): Promise<void> {
    if (!input.sourceId || !input.targetId) return;
    const now = new Date().toISOString();
    const relType = input.relationshipType ?? null;
    const edgeId = `${input.sourceId}-${input.targetId}-${relType ?? "_"}`;

    let targetTitle: string | null = null;
    try {
      const row = await this.relationalDb
        .selectFrom("graph_nodes")
        .where("document_id", "=", input.targetId)
        .select("title")
        .executeTakeFirst();
      targetTitle = row?.title ?? null;
    } catch {
      // graph_nodes lookup is best-effort; non-fatal
    }

    await this.relationalDb
      .insertInto("graph_edges")
      .values({
        id: edgeId,
        source_document_id: input.sourceId,
        target_document_id: input.targetId,
        link_type: relType,
        target_title: targetTitle,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          link_type: (eb) => eb.ref("excluded.link_type"),
          target_title: (eb) => eb.ref("excluded.target_title"),
          updated_at: (eb) => eb.ref("excluded.updated_at"),
        }),
      )
      .execute();
  }

  private async applyRemoveRelationship(input: {
    sourceId: string;
    targetId: string;
    relationshipType?: string;
  }): Promise<void> {
    if (!input.sourceId || !input.targetId) return;
    const relType = input.relationshipType ?? null;
    const edgeId = `${input.sourceId}-${input.targetId}-${relType ?? "_"}`;
    await this.relationalDb
      .deleteFrom("graph_edges")
      .where("id", "=", edgeId)
      .execute();
  }

  async onDisconnect(): Promise<void> {
    // Intentionally no-op: preserve indexed data across restarts.
  }

  private async deleteNode(documentId: string): Promise<void> {
    try {
      await this.relationalDb
        .deleteFrom("graph_topics")
        .where("document_id", "=", documentId)
        .execute();
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
      // Also prune the doc's history rows so the projection doesn't carry
      // ghost data for deleted documents.
      await this.relationalDb
        .deleteFrom("graph_operations")
        .where("document_id", "=", documentId)
        .execute();
      deleteEmbedding(documentId).catch((err) =>
        console.warn(
          `[GraphIndexer] Embedding delete failed for ${documentId}:`,
          err,
        ),
      );
      console.log(`[GraphIndexer] Deleted node ${documentId}`);
    } catch (err: unknown) {
      console.error(`[GraphIndexer] Error deleting node ${documentId}:`, err);
    }
  }
}

export { graphIndexerFactoryBuilder } from "./factory.js";
