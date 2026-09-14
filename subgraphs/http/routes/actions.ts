import type { RouteContext } from "@powerhousedao/shared/processors";
import { canonicalForWrite } from "../lib/authorize.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import type { RawAction } from "../lib/envelope.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { executeWrite } from "../lib/write.js";

interface ActionsBody {
  documentId?: string;
  actions?: RawAction[];
  wait?: boolean;
  allowLiteralEscapes?: boolean;
}

export function createActionsRoute(deps: HttpRouteDeps) {
  return async function handleActions(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      let body: ActionsBody;
      try {
        body = (await request.json()) as ActionsBody;
      } catch {
        throw new HttpError(400, "BAD_REQUEST", "body must be JSON");
      }
      if (!body.documentId || typeof body.documentId !== "string") {
        throw new HttpError(400, "BAD_REQUEST", "documentId is required");
      }
      if (!Array.isArray(body.actions) || body.actions.length === 0) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          "actions must be a non-empty array",
        );
      }
      const canonicalId = await canonicalForWrite(deps, body.documentId, ctx);
      const doc = await deps.reactorClient.get(canonicalId);
      const result = await executeWrite(deps, {
        documentId: canonicalId,
        document: doc,
        actions: body.actions,
        ctx,
        wait: body.wait !== false,
        allowLiteralEscapes: body.allowLiteralEscapes,
      });
      // Branch on the async dispatch itself, not on the presence of `jobId`:
      // a synchronous write reports its job id too, so that an unconfirmed
      // read-back can be polled rather than blindly retried.
      if (result.readBack === "skipped") {
        return Response.json({ jobId: result.jobId }, { status: 202 });
      }
      return Response.json(
        {
          revision: result.revision,
          operations: result.operations,
          readBack: result.readBack,
          jobId: result.jobId,
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}