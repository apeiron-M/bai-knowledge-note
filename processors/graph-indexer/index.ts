import { RelationalDbProcessor } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import { up } from "./migrations.js";
import type { DB } from "./schema.js";
import type { Kysely } from "kysely";
import {
  ACTIVE_MODEL,
  deleteEmbedding,
  getStoredHash,
  sha256Hex,
  upsertEmbedding,
} from "./embedding-store.js";
import {
  DERIVED_LINK_TYPES,
  isIndexedLinkType,
} from "./link-types.js";
import { isIndexedDocumentType, projectNode } from "./project.js";
import {
  TensionAutomation,
  type TensionAutomationDeps,
} from "./automation.js";
import { DriveMembership, type DriveMembershipDeps } from "./membership.js";

/**
 * Embedding is SERVER-only. This processor also runs inside Connect's
 * in-browser reactor (that's how the browser's local graph_nodes gets
 * populated), and loading a ~30MB model there is exactly what made semantic
 * search break the Connect app. The browser instance indexes; the node
 * instance (local `ph vetra` or a deployed Switchboard) additionally embeds,
 * and browser searches reach those vectors through the subgraph.
 */
const EMBEDDING_ENABLED_DEFAULT = typeof window === "undefined";

/**
 * Optional wiring for one processor instance. Everything here has a safe
 * default so the codegen'd factory call shape keeps working.
 */
export type GraphIndexerOptions = {
  /**
   * Whether this instance embeds. Defaults to "not in a browser"; tests pass
   * `false` so `onOperations` can be driven without loading a model.
   */
  embed?: boolean;
  /**
   * Enable derived-document automation (see `automation.ts`). Needs the
   * host's reactor client and the drive id; absent → this instance only
   * reads. The factory enables it on the Switchboard host only.
   */
  automation?: TensionAutomationDeps;
  /**
   * Restrict indexing to documents that belong to one drive (see
   * `membership.ts`). Absent → every operation the filter admits is indexed,
   * whichever drive it came from — the pre-gate behaviour, kept for tests.
   */
  membership?: DriveMembershipDeps;
  /** Injectable clock (ms since epoch) for tests. */
  now?: () => number;
};

/**
 * How far in the past an operation may be stamped and still count as LIVE
 * for automation purposes. Generous, to absorb clock skew between the client
 * that stamped the action and this host; still hours short of anything a
 * history replay would present.
 */
export const AUTOMATION_LIVE_WINDOW_MS = 5 * 60_000;

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
    case "CREATE_TENSION":
      return `Tension opened: "${truncate(input.title)}"`;
    case "RESOLVE_TENSION":
      return `Tension resolved: ${truncate(input.resolution)}`;
    case "DISSOLVE_TENSION":
      return `Tension dissolved: ${truncate(input.resolution)}`;
    case "ADD_INVOLVED_REF":
      return `Tension now involves ${s(input.ref)}`;
    case "CREATE_OBSERVATION":
      return `Observation recorded (${s(input.category)}): "${truncate(input.title)}"`;
    case "PROMOTE_OBSERVATION":
      return `Observation promoted to ${s(input.promotedTo)}`;
    case "IMPLEMENT_OBSERVATION":
      return `Observation implemented`;
    case "ARCHIVE_OBSERVATION":
      return `Observation archived`;
    case "CREATE_CLAIM":
      return `Claim created: "${truncate(input.title)}"`;
    case "UPDATE_CLAIM_CONTENT":
      return `Claim content updated`;
    case "CREATE_MOC":
      return `MoC created: "${truncate(input.title)}"`;
    case "UPDATE_ORIENTATION":
      return `Orientation updated`;
    case "ADD_TENSION":
      return `Tension noted on map: ${truncate(input.description)}`;
    case "ADD_OPEN_QUESTION":
      return `Open question: ${truncate(input.question)}`;
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
  private readonly embeddingEnabled: boolean;
  private readonly automation: TensionAutomation | null;
  /** Drive-membership gate; `null` means "index everything" (tests). */
  private readonly membership: DriveMembership | null;
  /** Wall-clock ms when this instance was created — see `isLiveOperation`. */
  private readonly startedAtMs: number;

  constructor(
    namespace: string,
    filter: ConstructorParameters<typeof RelationalDbProcessor<DB>>[1],
    relationalDb: ConstructorParameters<typeof RelationalDbProcessor<DB>>[2],
    options: GraphIndexerOptions = {},
  ) {
    super(namespace, filter, relationalDb);
    this.embeddingEnabled = options.embed ?? EMBEDDING_ENABLED_DEFAULT;
    this.startedAtMs = options.now?.() ?? Date.now();
    // `IRelationalDb` is a Kysely instance with namespace helpers; the
    // automation only needs the Kysely query surface.
    this.automation = options.automation
      ? new TensionAutomation(
          relationalDb as unknown as Kysely<DB>,
          options.automation,
        )
      : null;
    this.membership = options.membership
      ? new DriveMembership({ now: options.now, ...options.membership })
      : null;
  }

  /** Exposed for tests and for the factory's log line. */
  get membershipGated(): boolean {
    return this.membership !== null;
  }

  /**
   * Does this operation concern one of our documents? Relationship actions
   * are gated on their SOURCE (the note that carries the edge), deletions on
   * the document being deleted, everything else on the document the
   * operation was applied to. Open when no gate is configured.
   */
  private async isOurs(documentId: string): Promise<boolean> {
    if (!this.membership) return true;
    return this.membership.has(documentId);
  }

  /** Exposed for tests and for the factory's log line. */
  get automationEnabled(): boolean {
    return this.automation !== null;
  }

  /**
   * True when an operation was stamped after this instance started (minus
   * a skew allowance) — i.e. it is arriving as it happens, not as replay.
   * An unparseable timestamp is treated as historical: never write on a
   * guess.
   */
  isLiveOperation(timestampUtcMs: string | undefined): boolean {
    if (!timestampUtcMs) return false;
    const t = Date.parse(timestampUtcMs);
    if (Number.isNaN(t)) return false;
    return t >= this.startedAtMs - AUTOMATION_LIVE_WINDOW_MS;
  }

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
    if (this.embeddingEnabled) {
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

    // Membership first, for the whole batch: the containment edge that
    // makes a new document "ours" travels in the same job as its initial
    // state, so the gate must have seen it before judging that state.
    if (this.membership) {
      for (const { operation, context } of operations) {
        this.membership.observe({
          documentId: context.documentId,
          actionType: operation.action.type,
          input: operation.action.input,
        });
      }
    }

    for (const entry of operations) {
      const { operation, context } = entry;
      const documentId = context.documentId;

      // Handle reactor-native relationship system actions first. These
      // fire in `document` scope on the SOURCE document of the edge and
      // are the sole source-of-truth for graph_edges now that note/moc
      // state no longer carries inline links.
      if (operation.action.type === "ADD_RELATIONSHIP") {
        const input = operation.action.input as {
          sourceId: string;
          targetId: string;
          relationshipType?: string;
        };
        if (!(await this.isOurs(input.sourceId))) continue;
        await this.applyAddRelationship(input);
        // A recorded contradiction implies an open tension. Fire and
        // forget: the write must never hold the indexing cursor, and its
        // failure is logged by the automation itself.
        //
        // LIVE operations only. A processor created with `startFrom:
        // "beginning"` — every new instance, and every instance whose
        // filter changed — is fed the whole history first, and history
        // must never cause writes: it already happened, the tensions it
        // implies are the agent's backlog, and writes during boot are
        // rolled back by the reactor while consuming ordinals. Observed
        // live: two day-old CONTRADICTS pairs replayed at boot produced 29
        // rolled-back operations, a hole in the ordinal sequence, and a
        // strict read model that refused to boot across it.
        if (
          input.relationshipType === "CONTRADICTS" &&
          this.automation &&
          this.isLiveOperation(operation.timestampUtcMs)
        ) {
          void this.automation.onContradiction(input.sourceId, input.targetId);
        }
        continue;
      }
      if (operation.action.type === "REMOVE_RELATIONSHIP") {
        const input = operation.action.input as {
          sourceId: string;
          targetId: string;
          relationshipType?: string;
        };
        if (!(await this.isOurs(input.sourceId))) continue;
        await this.applyRemoveRelationship(input);
        continue;
      }

      // Handle document/drive deletion. Two signals, either suffices:
      //  - DELETE_NODE on a drive document (the file left the tree);
      //  - DELETE_DOCUMENT, the reactor's own system action on the deleted
      //    document itself (`deleteDocuments` emits it whether or not any
      //    drive still listed the file). Without the second, a document
      //    deleted through the reactor API left a ghost row here.
      if (
        context.documentType === "powerhouse/document-drive" &&
        operation.action.type === "DELETE_NODE"
      ) {
        // Another drive removing a file says nothing about our index.
        if (this.membership && documentId !== this.membership.driveId) continue;
        const deleteInput = operation.action.input as { id: string };
        await this.deleteNode(deleteInput.id);
        lastByDocument.delete(deleteInput.id);
        continue;
      }
      if (operation.action.type === "DELETE_DOCUMENT") {
        const target =
          (operation.action.input as { documentId?: string }).documentId ??
          documentId;
        // Membership is gone by now (the reactor drops containment first),
        // so use the index itself as the answer: deleting a row we never
        // had is a no-op.
        await this.deleteNode(target);
        lastByDocument.delete(target);
        continue;
      }

      // Only indexed document types take part in state reconciliation —
      // see `project.ts` for the list and why tensions/observations are in.
      if (!isIndexedDocumentType(context.documentType)) continue;
      if (!(await this.isOurs(documentId))) continue;

      // Index operation for history tracking
      try {
        const input = operation.action.input as Record<string, unknown>;
        const signer = operation.action.context?.signer as
          | {
              user?: { address?: string };
              app?: { name?: string; key?: string };
              signatures?: Array<string | string[]>;
            }
          | undefined;
        // Keep the LAST signature, which is the one the verifier checks
        // (`createSignatureVerifier` reads `signatures[length - 1]`). The
        // reactor stores tuples; the wire carries them joined by ", ".
        // Persisting the serialized form means a reader can verify the op
        // from this projection alone, without a second reactor round-trip.
        const lastSignature = signer?.signatures?.at(-1);
        const signature =
          lastSignature === undefined
            ? null
            : Array.isArray(lastSignature)
              ? lastSignature.join(", ")
              : lastSignature;
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
            signer_key: signer?.app?.key || null,
            signature,
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
        const documentType = entry.context.documentType;
        if (!isIndexedDocumentType(documentType)) continue;

        const projected = projectNode(documentType, global);
        const { topics, derivedEdges, ...row } = projected;

        // Upsert node
        await this.relationalDb
          .insertInto("graph_nodes")
          .values({
            id: documentId,
            document_id: documentId,
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

        // Reconcile topics: delete old, insert new
        await this.relationalDb
          .deleteFrom("graph_topics")
          .where("document_id", "=", documentId)
          .execute();

        if (topics.length > 0) {
          await this.relationalDb
            .insertInto("graph_topics")
            .values(
              topics.map((name, idx) => ({
                id: `${documentId}-topic-${idx}`,
                document_id: documentId,
                name,
                updated_at: documentUpdatedAt,
              })),
            )
            .execute();
        }

        // Reconcile DERIVED edges (tension → involved notes, observation →
        // promoted note) from this document's state: delete + reinsert,
        // exactly like topics, so they track the document and never go
        // stale. Knowledge edges are untouched here — see below.
        await this.reconcileDerivedEdges(
          documentId,
          derivedEdges,
          documentUpdatedAt,
        );

        const content = row.content;

        // Edges are NOT reconciled from doc state anymore — they live in
        // the reactor's DocumentRelationship table, populated via
        // ADD_RELATIONSHIP / REMOVE_RELATIONSHIP and mirrored into
        // graph_edges by `applyAddRelationship` / `applyRemoveRelationship`.

        // Re-embed when the embeddable text changed (server only; the hash
        // gate inside embedNode makes this a no-op for topic/status/link
        // churn that doesn't touch title/description/content). Detached so
        // ~12ms of inference never delays cursor advancement, and failures
        // never error the processor — a poisoned doc would freeze the cursor.
        if (this.embeddingEnabled) {
          void this.embedNode({
            document_id: documentId,
            title: row.title,
            description: row.description,
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
    if (!isIndexedLinkType(relType)) return;
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
   * Replace this document's derived edges with the set implied by its
   * current state. Only `DERIVED_LINK_TYPES` rows with this source are
   * touched, so a manually added knowledge edge from a tension (if anyone
   * ever does that) survives.
   */
  private async reconcileDerivedEdges(
    documentId: string,
    edges: Array<{ linkType: string; targetId: string }>,
    updatedAt: string,
  ): Promise<void> {
    await this.relationalDb
      .deleteFrom("graph_edges")
      .where("source_document_id", "=", documentId)
      .where("link_type", "in", [...DERIVED_LINK_TYPES])
      .execute();
    if (edges.length === 0) return;

    const targetIds = [...new Set(edges.map((e) => e.targetId))];
    const titles = new Map<string, string | null>();
    try {
      const rows = await this.relationalDb
        .selectFrom("graph_nodes")
        .where("document_id", "in", targetIds)
        .select(["document_id", "title"])
        .execute();
      for (const r of rows) titles.set(r.document_id, r.title);
    } catch {
      // titles are a rendering convenience; the edge is the fact
    }

    const values = new Map<
      string,
      {
        id: string;
        source_document_id: string;
        target_document_id: string;
        link_type: string;
        target_title: string | null;
        updated_at: string;
      }
    >();
    for (const e of edges) {
      const id = `${documentId}-${e.targetId}-${e.linkType}`;
      values.set(id, {
        id,
        source_document_id: documentId,
        target_document_id: e.targetId,
        link_type: e.linkType,
        target_title: titles.get(e.targetId) ?? null,
        updated_at: updatedAt,
      });
    }
    await this.relationalDb
      .insertInto("graph_edges")
      .values([...values.values()])
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
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
