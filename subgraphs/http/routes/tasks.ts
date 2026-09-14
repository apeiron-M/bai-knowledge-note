import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { findDocumentInDrive } from "../lib/drive-tree.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { rejectUnknownFields } from "../lib/validate.js";
import { executeWrite } from "../lib/write.js";

export function createClaimRoute(deps: HttpRouteDeps) {
  return async function handleClaim(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      const drive = url.searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const taskId = ctx.params.id ?? "";
      if (!taskId) throw new HttpError(400, "BAD_REQUEST", "task id is required");

      let body: { assignedTo?: string } = {};
      try {
        body = (await request.json()) as { assignedTo?: string };
      } catch {
        body = {};
      }
      rejectUnknownFields(body as Record<string, unknown>, ["assignedTo"]);

      const queueId = await findDocumentInDrive(
        deps,
        drive,
        "bai/pipeline-queue",
      );
      if (!queueId) {
        throw new HttpError(
          404,
          "NOT_FOUND",
          `No pipeline queue in drive ${drive}`,
        );
      }
      const canonicalQueueId = await canonicalForWrite(deps, queueId, ctx);
      const queue = await deps.reactorClient.get(canonicalQueueId);

      const result = await executeWrite(deps, {
        documentId: canonicalQueueId,
        document: queue,
        actions: [
          {
            type: "ASSIGN_TASK",
            input: {
              taskId,
              assignedTo: body.assignedTo ?? ctx.user?.address ?? "",
              updatedAt: deps.now().toISOString(),
            },
          },
        ],
        ctx,
        wait: true,
      });

      const failed = result.operations.find((op) => op.error);
      if (result.operations.length === 0) {
        throw new HttpError(
          503,
          "READ_BACK_INCOMPLETE",
          "The claim could not be confirmed; read the queue before retrying",
        );
      }
      if (failed?.error && /already assigned/i.test(failed.error)) {
        throw new HttpError(409, "CONFLICT", failed.error);
      }
      if (failed?.error && /task not found/i.test(failed.error)) {
        throw new HttpError(404, "NOT_FOUND", failed.error);
      }

      return Response.json(
        { taskId, assignedTo: body.assignedTo ?? ctx.user?.address ?? null },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}