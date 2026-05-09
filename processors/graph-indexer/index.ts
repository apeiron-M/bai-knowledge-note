import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "./migrations.js";
import type { DB } from "./schema.js";
import { generateEmbedding } from "./embedder.js";
import { upsertEmbedding, deleteEmbedding } from "./embedding-store.js";

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

    // Deduplicate: keep the last operation per document
    const lastByDocument = new Map<string, OperationWithContext>();

    for (const entry of operations) {
      const { operation, context } = entry;
      const documentId = context.documentId;

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

      // Only process knowledge-note and moc documents
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

        // Reconcile edges: delete old, insert new
        await this.relationalDb
          .deleteFrom("graph_edges")
          .where("source_document_id", "=", documentId)
          .execute();

        // Build edge list from links (notes) or coreIdeas + childRefs (MOCs)
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
                id: `${documentId}-ci-${idea.id ?? idea.noteRef}`,
                source_document_id: documentId,
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
              id: `${documentId}-child-${ref}`,
              source_document_id: documentId,
              target_document_id: ref,
              link_type: "CORE_IDEA",
              target_title: null,
              updated_at: now,
            });
          }
        } else {
          const links = (global.links as Array<Record<string, unknown>>) ?? [];
          for (const link of links) {
            edgeValues.push({
              id:
                (link.id as string) ??
                `${documentId}-${link.targetDocumentId as string}`,
              source_document_id: documentId,
              target_document_id: (link.targetDocumentId as string) ?? "",
              link_type: (link.linkType as string) ?? null,
              target_title: (link.targetTitle as string) ?? null,
              updated_at: now,
            });
          }
        }

        if (edgeValues.length > 0) {
          // UPSERT instead of plain INSERT — concurrent reconciles on the same
          // doc race after the DELETE above; without ON CONFLICT, the second
          // insert hits `graph_edges_pkey` and the whole reconcile errors out.
          await this.relationalDb
            .insertInto("graph_edges")
            .values(edgeValues)
            .onConflict((oc) =>
              oc.column("id").doUpdateSet({
                source_document_id: (eb) =>
                  eb.ref("excluded.source_document_id"),
                target_document_id: (eb) =>
                  eb.ref("excluded.target_document_id"),
                link_type: (eb) => eb.ref("excluded.link_type"),
                target_title: (eb) => eb.ref("excluded.target_title"),
                updated_at: (eb) => eb.ref("excluded.updated_at"),
              }),
            )
            .execute();
        }

        console.log(
          `[GraphIndexer] Reconciled ${documentId}: ${edgeValues.length} edges`,
        );

        // Fire-and-forget embedding generation (don't block operation processing)
        const text = [global.title, global.description, global.content]
          .filter(Boolean)
          .join(" ");
        if (text.length > 0) {
          generateEmbedding(text)
            .then((emb) => upsertEmbedding(documentId, emb))
            .catch((err) =>
              console.warn(
                `[GraphIndexer] Embedding failed for ${documentId}:`,
                err,
              ),
            );
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
