import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "./migrations.js";
import type { DB } from "./schema.js";
import {
  ACTIVE_MODEL,
  deleteEmbedding,
  getStoredHash,
  sha256Hex,
  upsertEmbedding,
} from "./embedding-store.js";
import { isKnowledgeLinkType } from "./link-types.js";

/**
 * Embedding is SERVER-only. This processor also runs inside Connect's
 * in-browser reactor (that's how the browser's local graph_nodes gets
 * populated), and loading a ~30MB model there is exactly what made semantic
 * search break the Connect app. The browser instance indexes; the node
 * instance (local `ph vetra` or a deployed Switchboard) additionally embeds,
 * and browser searches reach those vectors through the subgraph.
 */
const EMBEDDING_ENABLED = typeof window === "undefined";

/** Text a note is embedded from. Content head is capped so growing note
 * bodies stay inside the model's 512-token window; the hash gate makes any
 * future change to this recipe an incremental re-embed. */
function embeddableText(row: {
  title: string | null;
  description: string | null;
  content: string | null;
}): string {
  return [row.title, row.description, row.content?.slice(0, 1500)]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" ");
}

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

    // Self-healing backfill: embed every indexed note that has no vector for
    // the active model. Detached on purpose — registration must not block on
    // ~6s of inference — and hash-gated, so on an already-embedded drive it
    // costs one SQL round-trip. This is what makes "start the server and
    // semantic search just works" true for pre-existing documents: the
    // processor cursor has already consumed their history, so onOperations
    // alone would never see them again.
    if (EMBEDDING_ENABLED) {
      void this.backfillMissingEmbeddings().catch((err) =>
        console.warn(`[GraphIndexer] Embedding backfill failed:`, err),
      );
    }
  }

  private async backfillMissingEmbeddings(): Promise<void> {
    const missing = await this.relationalDb
      .selectFrom("graph_nodes")
      .leftJoin(
        "note_embeddings",
        "note_embeddings.document_id",
        "graph_nodes.document_id",
      )
      .where((eb) =>
        eb.or([
          eb("note_embeddings.document_id", "is", null),
          eb("note_embeddings.model", "!=", ACTIVE_MODEL),
        ]),
      )
      .select([
        "graph_nodes.document_id as document_id",
        "graph_nodes.title as title",
        "graph_nodes.description as description",
        "graph_nodes.content as content",
      ])
      .execute();
    if (missing.length === 0) return;

    console.log(
      `[GraphIndexer] Embedding backfill: ${missing.length} note(s) missing vectors`,
    );
    let done = 0;
    for (const row of missing) {
      try {
        await this.embedNode(row);
        done++;
        if (done % 50 === 0) {
          console.log(
            `[GraphIndexer] Embedding backfill: ${done}/${missing.length}`,
          );
        }
      } catch (err) {
        // Per-document isolation: one bad note must not stall the sweep.
        console.warn(
          `[GraphIndexer] Embed failed for ${row.document_id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `[GraphIndexer] Embedding backfill done: ${done}/${missing.length}`,
    );
  }

  /** Embed one node's text and upsert, skipping when hash+model are current. */
  private async embedNode(row: {
    document_id: string;
    title: string | null;
    description: string | null;
    content: string | null;
  }): Promise<void> {
    const text = embeddableText(row);
    if (!text) return;
    const hash = await sha256Hex(text);
    const stored = await getStoredHash(this.relationalDb, row.document_id);
    if (stored && stored.contentHash === hash && stored.model === ACTIVE_MODEL)
      return;
    const { generateEmbedding } = await import("./embedder.js");
    const vector = await generateEmbedding(text);
    await upsertEmbedding(this.relationalDb, row.document_id, vector, hash);
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
        // `updated_at` must be the time the DOCUMENT changed, not the time
        // the indexer happened to touch the row. Using wall-clock here made
        // every reindex stamp all nodes with one identical instant, which
        // silently destroyed `knowledgeGraphRecent` ordering and left
        // STALE_NOTES with nothing but DRAFT counts to work from. The last
        // operation for this document carries the real edit time, and
        // because a reindex replays operations it reconstructs true history
        // rather than flattening it.
        const now = new Date().toISOString();
        const documentUpdatedAt = entry.operation.timestampUtcMs ?? now;
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
            updated_at: documentUpdatedAt,
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
              updated_at: documentUpdatedAt,
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
                  updated_at: documentUpdatedAt,
                };
              }),
            )
            .execute();
        }

        // Edges are NOT reconciled from doc state anymore — they live in
        // the reactor's DocumentRelationship table, populated via
        // ADD_RELATIONSHIP / REMOVE_RELATIONSHIP and mirrored into
        // graph_edges by `applyAddRelationship` / `applyRemoveRelationship`.

        // Re-embed when the embeddable text changed (server only; the hash
        // gate inside embedNode makes this a no-op for topic/status/link
        // churn that doesn't touch title/description/content). Detached so
        // ~12ms of inference never delays cursor advancement, and failures
        // never error the processor — a poisoned doc would freeze the cursor.
        if (EMBEDDING_ENABLED) {
          void this.embedNode({
            document_id: documentId,
            title: (global.title as string) ?? null,
            description: (global.description as string) ?? null,
            content,
          }).catch((err) =>
            console.warn(
              `[GraphIndexer] Embed failed for ${documentId}:`,
              err instanceof Error ? err.message : err,
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

  /**
   * Mirror an ADD_RELATIONSHIP event into `graph_edges`. Backfills the
   * `target_title` from `graph_nodes` if the target is already indexed;
   * otherwise leaves it null (rendering falls back to the target's slug
   * until the target's own state reconciles).
   *
   * Only KNOWLEDGE relationship types are indexed. The reactor reuses
   * ADD_RELATIONSHIP for its own containment bookkeeping — adding a file to
   * a drive emits `(drive, document, "child")` — and indexing those gave the
   * drive an outgoing edge to every document in the vault, which made orphan
   * detection structurally impossible and inflated every edge-derived
   * metric. See `link-types.ts` for the full rationale; drive membership
   * still comes from the drive document's own node tree.
   */
  private async applyAddRelationship(input: {
    sourceId: string;
    targetId: string;
    relationshipType?: string;
  }): Promise<void> {
    if (!input.sourceId || !input.targetId) return;
    const relType = input.relationshipType ?? null;
    if (!isKnowledgeLinkType(relType)) return;
    const now = new Date().toISOString();
    const edgeId = `${input.sourceId}-${input.targetId}-${relType}`;

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

  /**
   * Deletes unconditionally — including for non-knowledge types, which
   * `applyAddRelationship` no longer indexes. A projection that predates that
   * change still holds `child` rows, and a REMOVE_RELATIONSHIP is a free
   * chance to drop one; deleting a row that isn't there costs nothing.
   */
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
      deleteEmbedding(this.relationalDb, documentId).catch((err) =>
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
