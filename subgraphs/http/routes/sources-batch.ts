import type { PHDocument } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite, requireUser } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import type { RawAction } from "../lib/envelope.js";
import { containAll, placements } from "../lib/placement.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { failAndRollback, rollbackDocuments } from "../lib/rollback.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { resolveVaultFolder } from "../lib/vault-folders.js";
import { assertLintClean, executeWrite } from "../lib/write.js";
import {
  addQueueTasks,
  ingestActions,
  readSourceFields,
  SOURCE_FIELDS,
} from "./sources.js";

const SOURCE_TYPE = "bai/source";
export const MAX_BATCH_SOURCES = 50;

type SourceItem = Partial<Record<(typeof SOURCE_FIELDS)[number], unknown>> & {
  /** Applied with the source's content in the same write — its original file and figures. */
  actions?: unknown;
};

interface BatchBody {
  drive?: string;
  /** A folder within `/sources`, as for `POST sources`. */
  parentFolder?: string;
  queue?: boolean;
  allowLiteralEscapes?: boolean;
  sources?: unknown;
}

interface Failure {
  /** The first source that did not land; it and every source after it were rolled back. */
  index: number;
  code: string;
  message: string;
  /** Present only when the rollback itself failed. */
  orphaned?: string[];
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * `POST sources/batch` — many sources in one request, filed into one folder.
 *
 * **Why.** `POST sources` creates, files and queues one source per request,
 * and two documents take the brunt: the drive (its node list) and the
 * pipeline queue (every task it has run). The reactor stores a document's
 * whole state with every operation, so each source rewrote both in full and
 * re-read the drive four or five times; a 900-section book slowed as it went
 * in. Here the drive is read and written once per batch, the queue once, and
 * each source's original and figures ride along in its content write instead
 * of a second request.
 *
 * **The same guarantees as `POST sources`, per source.** Every source is
 * checked and linted before anything is created (a 400 means nothing was
 * written). Creation and filing are all-or-nothing for the batch: a failure
 * there deletes what was made. Then each source gets its content in order; the
 * first one refused stops the batch, and it and every source after it — filed
 * but empty — are rolled back. The sources before it are complete and kept:
 * the answer is `207` with them and the `failure`, so a caller knows exactly
 * what landed. A queue that cannot be written after that is reported as
 * `queueError` rather than undoing complete sources.
 */
export function createIngestSourcesBatchRoute(deps: HttpRouteDeps) {
  return async function handleIngestSourcesBatch(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const user = requireUser(ctx);
      let body: BatchBody;
      try {
        body = (await request.json()) as BatchBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
      }
      rejectUnknownFields(body as unknown as Record<string, unknown>, [
        "drive",
        "parentFolder",
        "queue",
        "allowLiteralEscapes",
        "sources",
      ]);
      if (!body.drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      if (!Array.isArray(body.sources) || body.sources.length === 0) {
        throw new HttpError(400, "BAD_REQUEST", "sources must be a non-empty array");
      }
      if (body.sources.length > MAX_BATCH_SOURCES) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `at most ${MAX_BATCH_SOURCES} sources per request, got ${body.sources.length}`,
        );
      }
      const items = (body.sources as SourceItem[]).map((item, index) => {
        const at = `sources[${index}].`;
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new HttpError(400, "BAD_REQUEST", `sources[${index}] must be an object`);
        }
        rejectUnknownFields(item as Record<string, unknown>, [...SOURCE_FIELDS, "actions"]);
        if (item.actions !== undefined && !Array.isArray(item.actions)) {
          throw new HttpError(400, "BAD_REQUEST", `${at}actions must be an array`);
        }
        return {
          fields: readSourceFields(item, at),
          extra: (item.actions ?? []) as RawAction[],
        };
      });

      const driveId = await canonicalForWrite(deps, body.drive, ctx);
      // Resolve placement BEFORE creating anything, so a folder that is not
      // under /sources fails with nothing written.
      const folderId = await resolveVaultFolder(deps, driveId, SOURCE_TYPE, body.parentFolder);

      const module = await deps.reactorClient.getDocumentModelModule(SOURCE_TYPE);
      const probe = module.utils.createDocument() as PHDocument;
      const now = deps.now().toISOString();
      const queue = body.queue !== false;
      const allowLiteralEscapes = body.allowLiteralEscapes === true;
      // Lint EVERY source before anything exists: a refusal found halfway
      // through would otherwise leave half the batch behind.
      const plans = items.map(({ fields, extra }, index) => {
        const actions = [...ingestActions(fields, user.address, now, queue), ...extra] as RawAction[];
        try {
          assertLintClean(SOURCE_TYPE, probe.state, actions, { allowLiteralEscapes });
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          throw new HttpError(
            error.status,
            error.code,
            `sources[${index}].${error.message}`,
            error.details,
          );
        }
        return { fields, actions };
      });

      // 1 — create the documents bare. A parented create does its own
      // containment dispatch, which is what this route batches. Sequential on
      // purpose: the reactor runs one job at a time.
      const created: { id: string; name: string }[] = [];
      try {
        for (const { fields } of plans) {
          const draft = module.utils.createDocument() as PHDocument;
          draft.header.name = fields.title;
          const doc = await deps.reactorClient.create(draft);
          created.push({ id: doc.header.id, name: fields.title });
        }
      } catch (error) {
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CREATE_FAILED",
          `Creating the sources failed: ${message(error)}`,
        );
      }

      // 2 — file them all with ONE drive dispatch.
      try {
        await containAll(deps, driveId, folderId, SOURCE_TYPE, created, ctx);
      } catch (error) {
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CONTAINMENT_FAILED",
          `Filing the sources failed: ${message(error)}`,
        );
      }
      // A job can report success without its node landing, and a source at the
      // drive root is invisible to the pipeline: checked, not assumed.
      const placed = await placements(deps, driveId, created.map((c) => c.id));
      const misplaced = created.filter((c) => placed.get(c.id)?.parentFolder !== folderId);
      if (misplaced.length) {
        await failAndRollback(
          deps,
          created.map((c) => c.id),
          "CONTAINMENT_FAILED",
          `${misplaced.length} of ${created.length} sources were created but not placed`,
        );
      }

      // 3 — give each its content (and its original and figures), in order.
      const landed: {
        index: number;
        id: string;
        operations: { type: string; index: number; error: string | null }[];
        readBack: string;
      }[] = [];
      let failure: Failure | undefined;
      for (const [index, plan] of plans.entries()) {
        const { id } = created[index];
        try {
          const document = await deps.reactorClient.get(id);
          const write = await executeWrite(deps, {
            documentId: id,
            document,
            actions: plan.actions,
            ctx,
            wait: true,
            allowLiteralEscapes,
          });
          const ingest = write.operations.find((op) => op.type === "INGEST_SOURCE");
          if (ingest?.error) {
            failure = {
              index,
              code: "INGEST_REJECTED",
              message: `INGEST_SOURCE was rejected by the reducer: ${ingest.error}`,
            };
            break;
          }
          landed.push({ index, id, operations: write.operations, readBack: write.readBack });
        } catch (error) {
          failure = {
            index,
            code: error instanceof HttpError ? error.code : "INGEST_FAILED",
            message: `Ingesting source ${index + 1} failed: ${message(error)}`,
          };
          break;
        }
      }
      if (failure) {
        // The refused source and every one after it are filed but empty: an
        // empty source is nothing the caller asked for.
        const stranded = await rollbackDocuments(
          deps,
          created.slice(failure.index).map((c) => c.id),
        );
        if (stranded.length) failure.orphaned = stranded;
      }

      // 4 — queue every complete source with ONE queue write.
      let tasks: Map<string, { id: string; created: boolean }> | undefined;
      let queueError: string | undefined;
      if (queue && landed.length) {
        try {
          tasks = await addQueueTasks(
            deps,
            driveId,
            landed.map(({ index, id }) => ({ documentId: id, target: plans[index].fields.title })),
            ctx,
          );
        } catch (error) {
          queueError = message(error);
        }
      }

      const path = landed.length ? (placed.get(landed[0].id)?.path ?? null) : null;
      return Response.json(
        {
          drive: driveId,
          parentFolder: folderId,
          path,
          sources: landed.map(({ index, id, operations, readBack }) => ({
            index,
            id,
            name: placed.get(id)?.name ?? plans[index].fields.title,
            status: queue ? "EXTRACTING" : "INBOX",
            readBack,
            operations,
            ...(tasks?.get(id) ? { task: tasks.get(id) } : {}),
          })),
          ...(failure ? { failure } : {}),
          ...(queueError ? { queueError } : {}),
        },
        { headers: OK_CACHE, status: failure ? 207 : 201 },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}

