import type { PHDocument } from "document-model";
import { SourceTypeSchema } from "../../../document-models/source/v1/gen/schema/zod.js";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite, requireUser } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { findDocumentInDrive } from "../lib/drive-tree.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import {
  failAndRollback,
  readPlacement,
  rollbackDocuments,
} from "../lib/rollback.js";
import { folderPaths, resolveVaultFolder } from "../lib/vault-folders.js";
import { assertLintClean, executeWrite } from "../lib/write.js";

// Taken from the model's own zod schema rather than restated here, so the
// route cannot drift from what the reducer will actually accept.
const SOURCE_TYPES = new Set<string>(SourceTypeSchema.options);

const SOURCE_TYPE = "bai/source";

interface SourceBody {
  drive?: string;
  title?: string;
  content?: string;
  sourceType?: string;
  description?: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  method?: string;
  tool?: string;
  queue?: boolean;
  /** A folder within `/sources`; refused anywhere else. */
  parentFolder?: string;
  /** Allow literal `\n` / `\t` / `\r` in strings, as `POST actions` does. */
  allowLiteralEscapes?: boolean;
}

interface DriveNode {
  id?: string;
  name?: string;
  documentType?: string;
  parentFolder?: string | null;
}

/**
 * `POST sources` — ingest a source from its content alone.
 *
 * The caller supplies content; the API decides where it lives. A source lands
 * in `/sources`, resolved from the drive at request time. `parentFolder` may
 * name a folder WITHIN `/sources` — a book's chapters grouped under one — and
 * is refused anywhere else, so the rule that sources cannot scatter across the
 * drive survives having an option at all.
 */
export function createIngestSourceRoute(deps: HttpRouteDeps) {
  return async function handleIngestSource(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const user = requireUser(ctx);
      let body: SourceBody;
      try {
        body = (await request.json()) as SourceBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
      }
      rejectUnknownFields(body as unknown as Record<string, unknown>, [
        "drive",
        "title",
        "content",
        "sourceType",
        "description",
        "author",
        "url",
        "publishedAt",
        "method",
        "tool",
        "queue",
        "parentFolder",
        "allowLiteralEscapes",
      ]);
      if (!body.drive) {
        throw new HttpError(400, "BAD_REQUEST", "drive is required");
      }
      if (!body.title?.trim()) {
        throw new HttpError(400, "BAD_REQUEST", "title is required");
      }
      if (!body.content?.trim()) {
        throw new HttpError(400, "BAD_REQUEST", "content is required");
      }
      const sourceType = body.sourceType ?? "MANUAL_ENTRY";
      if (!SOURCE_TYPES.has(sourceType)) {
        // The reducer drops an unknown enum silently, so this must be a 400
        // rather than a source that ingests with no type.
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `sourceType must be one of ${[...SOURCE_TYPES].sort().join(", ")}`,
          [{ path: "sourceType", rule: "ENUM" }],
        );
      }

      const driveId = await canonicalForWrite(deps, body.drive, ctx);
      // Resolve placement BEFORE creating anything: a drive without /sources
      // must fail with nothing written, not leave an orphan behind.
      const folderId = await resolveVaultFolder(
        deps,
        driveId,
        SOURCE_TYPE,
        body.parentFolder,
      );

      const module = await deps.reactorClient.getDocumentModelModule(SOURCE_TYPE);
      const draft = module.utils.createDocument() as PHDocument;
      draft.header.name = body.title.trim();

      const now = deps.now().toISOString();
      const actions: { type: string; input: Record<string, unknown> }[] = [
        {
          type: "INGEST_SOURCE",
          input: {
            title: body.title.trim(),
            content: body.content,
            sourceType,
            ...(body.description ? { description: body.description } : {}),
            ...(body.author ? { author: body.author } : {}),
            ...(body.url ? { url: body.url } : {}),
            ...(body.publishedAt ? { publishedAt: body.publishedAt } : {}),
            ...(body.method ? { method: body.method } : {}),
            ...(body.tool ? { tool: body.tool } : {}),
            createdAt: now,
            createdBy: user.address,
          },
        },
      ];
      const queue = body.queue !== false;
      if (queue) {
        actions.push({
          type: "SET_SOURCE_STATUS",
          input: { status: "EXTRACTING" },
        });
      }

      // Lint what will be applied BEFORE anything exists. `executeWrite` lints
      // too, but only after the create, and a refusal there (a publishedAt that
      // is not an ISO instant, a literal \n in the content) used to leave an
      // empty source in /sources behind a 400. Linting against the draft's
      // initial state gives the same findings with nothing written.
      assertLintClean(SOURCE_TYPE, draft.state, actions, {
        allowLiteralEscapes: body.allowLiteralEscapes === true,
      });

      // `createDocumentInDrive` is create + contain as TWO reactor jobs. If it
      // throws we may already own a document, so roll back on the id we asked
      // for rather than assume nothing happened.
      let created;
      try {
        created = await deps.reactorClient.createDocumentInDrive(
          driveId,
          draft,
          folderId,
        );
      } catch (error) {
        await failAndRollback(
          deps,
          [draft.header.id],
          "CREATE_FAILED",
          `Creating the source failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error; // unreachable; failAndRollback always throws
      }
      const documentId = created.header.id;

      // Containment is the job that can silently not happen. Verify it landed
      // BEFORE ingesting content: a source at the drive root is invisible to
      // the pipeline, and returning it as a success is how orphans accumulate.
      const landed = await readPlacement(deps, driveId, documentId);
      if (landed.parentFolder !== folderId) {
        await failAndRollback(
          deps,
          [documentId],
          "CONTAINMENT_FAILED",
          `The source was created but not placed in /sources (parentFolder=${
            landed.parentFolder ?? "none"
          })`,
        );
      }

      // A source without its INGEST_SOURCE is an empty shell the caller never
      // asked for, so a failure here rolls back like a failed create — unlike a
      // later write to a document that already holds content (see rollback.ts).
      let result;
      try {
        result = await executeWrite(deps, {
          documentId,
          document: created,
          actions,
          ctx,
          wait: true,
          allowLiteralEscapes: body.allowLiteralEscapes === true,
        });
      } catch (error) {
        await rollbackOrReport(deps, documentId, error);
        throw error; // unreachable; rollbackOrReport always throws
      }
      const ingest = result.operations.find(
        (operation) => operation.type === "INGEST_SOURCE",
      );
      if (ingest?.error) {
        await failAndRollback(
          deps,
          [documentId],
          "INGEST_REJECTED",
          `INGEST_SOURCE was rejected by the reducer: ${ingest.error}`,
        );
      }

      const task = queue
        ? await addQueueTask(deps, driveId, documentId, ctx, body.title.trim())
        : undefined;

      // Report placement as READ BACK from the drive, never echoed from the
      // request: a create whose containment silently failed must not look like
      // a success.
      const placement = await verifyPlacement(deps, driveId, documentId);

      return Response.json(
        {
          id: documentId,
          parentFolder: placement.parentFolder,
          path: placement.path,
          status: queue ? "EXTRACTING" : "INBOX",
          revision: result.revision,
          operations: result.operations,
          readBack: result.readBack,
          jobId: result.jobId,
          ...(task ? { task } : {}),
        },
        { headers: OK_CACHE, status: 201 },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}

async function verifyPlacement(
  deps: HttpRouteDeps,
  driveId: string,
  documentId: string,
): Promise<{ parentFolder: string | null; path: string | null }> {
  const drive = await deps.reactorClient.get(driveId);
  const nodes =
    (drive.state as { global?: { nodes?: DriveNode[] } } | undefined)?.global
      ?.nodes ?? [];
  const node = nodes.find((candidate) => candidate.id === documentId);
  if (!node) return { parentFolder: null, path: null };
  const parentFolder = node.parentFolder ?? null;
  if (!parentFolder) return { parentFolder: null, path: null };
  for (const [path, id] of folderPaths(nodes)) {
    if (id === parentFolder) return { parentFolder, path };
  }
  return { parentFolder, path: null };
}

/**
 * Adds a `claim` task for the new source, unless one already references it.
 *
 * A duplicate task id is unrecoverable — every queue operation resolves by
 * `find(t => t.id === taskId)` and there is no REMOVE_TASK — so the id is
 * always freshly generated and the existing tasks are checked first.
 */
async function addQueueTask(
  deps: HttpRouteDeps,
  driveId: string,
  documentId: string,
  ctx: RouteContext,
  target: string,
): Promise<{ id: string; created: boolean } | undefined> {
  const queueId = await findDocumentInDrive(deps, driveId, "bai/pipeline-queue");
  if (!queueId) return undefined;
  const queueDoc = await deps.reactorClient.get(queueId);
  const tasks =
    (
      queueDoc.state as
        | { global?: { tasks?: { id: string; documentRef?: string }[] } }
        | undefined
    )?.global?.tasks ?? [];
  const existing = tasks.find((task) => task.documentRef === documentId);
  if (existing) return { id: existing.id, created: false };

  const id = deps.uuid();
  await executeWrite(deps, {
    documentId: queueId,
    document: queueDoc,
    actions: [
      {
        type: "ADD_TASK",
        input: {
          id,
          taskType: "claim",
          target,
          documentRef: documentId,
          createdAt: deps.now().toISOString(),
        },
      },
    ],
    ctx,
    wait: true,
  });
  return { id, created: true };
}

/**
 * Rolls back a source whose ingest failed, then rethrows the original error so
 * the caller sees why (a 400 lint finding, a 422 dispatch failure). Only when
 * the rollback itself fails does it answer 502 with the stranded id instead.
 */
async function rollbackOrReport(
  deps: HttpRouteDeps,
  documentId: string,
  error: unknown,
): Promise<never> {
  const stranded = await rollbackDocuments(deps, [documentId]);
  if (stranded.length) {
    throw new HttpError(
      502,
      "CREATE_FAILED",
      `Ingesting the source failed (${
        error instanceof Error ? error.message : String(error)
      }). Rollback INCOMPLETE — these documents are stranded: ${stranded.join(", ")}`,
      [{ path: "rollback", rule: "INCOMPLETE", orphaned: stranded }],
    );
  }
  throw error;
}
