import type { PHDocument } from "document-model";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite, requireUser } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { findDocumentInDrive } from "../lib/drive-tree.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { failAndRollback, readPlacement } from "../lib/rollback.js";
import { folderPaths, resolveVaultFolder } from "../lib/vault-folders.js";
import { executeWrite } from "../lib/write.js";

const SOURCE_TYPES = new Set([
  "ARTICLE",
  "PAPER",
  "BOOK_CHAPTER",
  "TRANSCRIPT",
  "DOCUMENTATION",
  "CONVERSATION",
  "WEB_PAGE",
  "MANUAL_ENTRY",
]);

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
  /** Not accepted — placement is the API's job. Present only to reject it. */
  parentFolder?: string;
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
 * The caller supplies content; the API decides where it lives. A source always
 * lands in `/sources`, resolved from the drive at request time, and the route
 * refuses `parentFolder` outright so no client can put one elsewhere.
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
      if (!body.drive) {
        throw new HttpError(400, "BAD_REQUEST", "drive is required");
      }
      if (!body.title?.trim()) {
        throw new HttpError(400, "BAD_REQUEST", "title is required");
      }
      if (!body.content?.trim()) {
        throw new HttpError(400, "BAD_REQUEST", "content is required");
      }
      if (body.parentFolder !== undefined) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "parentFolder is not accepted: a source is always placed in /sources",
          [{ path: "parentFolder", rule: "VAULT_LAYOUT" }],
        );
      }
      const sourceType = body.sourceType ?? "MANUAL_ENTRY";
      if (!SOURCE_TYPES.has(sourceType)) {
        // The reducer drops an unknown enum silently, so this must be a 400
        // rather than a source that ingests with no type.
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `sourceType must be one of ${[...SOURCE_TYPES].join(", ")}`,
          [{ path: "sourceType", rule: "ENUM" }],
        );
      }

      const driveId = await canonicalForWrite(deps, body.drive, ctx);
      // Resolve placement BEFORE creating anything: a drive without /sources
      // must fail with nothing written, not leave an orphan behind.
      const folderId = await resolveVaultFolder(deps, driveId, SOURCE_TYPE);

      const module = await deps.reactorClient.getDocumentModelModule(SOURCE_TYPE);
      const draft = module.utils.createDocument() as PHDocument;
      draft.header.name = body.title.trim();

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

      const result = await executeWrite(deps, {
        documentId,
        document: created,
        actions,
        ctx,
        wait: true,
      });

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
